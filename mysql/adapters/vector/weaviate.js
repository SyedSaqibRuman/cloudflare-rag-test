// --------------------------
// WEAVIATE VECTOR ADAPTER
// Adapts Weaviate's REST API for the dual-mode ingestion + query pipeline.
// Uses raw fetch (no SDK dependency) — consistent with the project's lean
// supply chain policy (ADR-012 §4).
//
// Credentials required: apiKey, host (e.g. "https://xyz.weaviate.cloud")
// Weaviate class name is passed as vectorIndexName.
// --------------------------

import { chunkArray } from "../../../utils/helpers.js";
import { logToFile } from "../../../utils/logger.js";
import { embedBatchWithFallback } from "../embed-fallback.js";
import { normalizeVectorId } from "./vector-ids.js";

function cleanString(str = "") {
  return str.replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

/** Provider error text for a failed REST call (Weaviate: { error: [{ message }] }). */
async function errorText(res) {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text);
    const first = Array.isArray(body?.error) ? body.error[0] : body?.error;
    return first?.message || first || text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

export class WeaviateAdapter {
  constructor(credentials, { embeddingAdapter } = {}) {
    this.providerKey = "weaviate";
    // api_key (auth-schema field) → apiKey (camelCase, per adapter convention);
    // normalizeCredential in ingest/resolve.js does this too — both accepted.
    this.host = credentials.host || "http://localhost:8080";
    this.apiKey = credentials.apiKey || credentials.api_key || "";
    this.className = credentials.vectorIndexName || "";
    this.embeddingAdapter = embeddingAdapter || null;
    this.companyName = credentials.companyName;
    // Optional EmbedFallbackStats collector — set by ingestion so KB-bound
    // embedding failures are visible on the KB detail page (not just logs).
    this.embedStats = credentials.embedStats || null;
    this.dimensions = credentials.dimensions || 768;
    this.vectorizer = credentials.vectorizer || "none"; // "none" = we provide vectors
  }

  _headers() {
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  // ------------------------------------------------------------------
  // 🔹 ensureIndex — create class if it doesn't exist
  // ------------------------------------------------------------------
  async ensureIndex() {
    try {
      // Check if class exists by fetching schema
      const schemaRes = await fetch(`${this.host}/v1/schema`, {
        method: "GET",
        headers: this._headers(),
      });
      if (!schemaRes.ok) throw new Error(`Weaviate schema fetch failed (${schemaRes.status})`);
      const schema = await schemaRes.json();
      const existing = (schema.classes || []).find((c) => c.class === this.className);

      if (existing) {
        console.log(`📌 Weaviate: class '${this.className}' already exists`);
        return;
      }

      // Create class
      const createRes = await fetch(`${this.host}/v1/schema`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(this._classDefinition(this.className, this.vectorizer)),
      });

      if (!createRes.ok) {
        const msg = await createRes.text().catch(() => "");
        throw new Error(`Weaviate create class failed (${createRes.status}): ${msg.slice(0, 200)}`);
      }

      console.log(`✅ Weaviate: created class '${this.className}'`);
    } catch (error) {
      console.error(`❌ Weaviate ensureIndex failed:`, error.message);
      throw error;
    }
  }

  /**
   * Class definition shared by ensureIndex (KB auto-create) and createIndex
   * (live portal card) so both create identical property schemas.
   * @param {string} className
   * @param {string} [vectorizer="none"]  "none" = the pipeline supplies vectors
   */
  _classDefinition(className, vectorizer = "none") {
    return {
      class: className,
      vectorizer: vectorizer || "none",
      properties: [
        { name: "r2_key", dataType: ["text"] },
        { name: "url", dataType: ["text"] },
        { name: "title", dataType: ["text"] },
        { name: "preview", dataType: ["text"] },
        { name: "type", dataType: ["text"] },
        { name: "slug", dataType: ["text"] },
        { name: "chunkIndex", dataType: ["int"] },
      ],
    };
  }

  // ------------------------------------------------------------------
  // 🔹 listIndexes — live class list for the portal's vector card
  // (one schema call; per-class object counts would need an Aggregate per
  // class, so vectorCount stays null and the card renders "—")
  // ------------------------------------------------------------------
  async listIndexes() {
    const res = await fetch(`${this.host}/v1/schema`, { headers: this._headers() });
    if (!res.ok) throw new Error(`Weaviate schema fetch failed (${res.status}): ${await errorText(res)}`);
    const schema = await res.json().catch(() => null);
    return (schema?.classes || []).map((c) => ({
      id: c.class,
      name: c.class,
      dimensions: null,
      metric: c.vectorIndexConfig?.distance ?? null,
      vectorizer: c.vectorizer ?? null,
      vectorCount: null,
      createdAt: null,
    }));
  }

  // ------------------------------------------------------------------
  // 🔹 createIndex — create a class (live portal card; ensureIndex covers
  // KB-driven auto-creation). Weaviate infers dimensions from the first
  // vector, so only the vectorizer is configurable here.
  // @param {{ name, vectorizer? }} input
  // ------------------------------------------------------------------
  async createIndex({ name, vectorizer } = {}) {
    if (!name) throw new Error("Weaviate class name is required.");
    const res = await fetch(`${this.host}/v1/schema`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(this._classDefinition(name, vectorizer || this.vectorizer)),
    });
    if (!res.ok) {
      throw new Error(`Weaviate create class failed (${res.status}): ${await errorText(res)}`);
    }
    return {
      id: name,
      name,
      dimensions: null,
      metric: null,
      vectorizer: vectorizer || this.vectorizer,
      vectorCount: 0,
      createdAt: null,
    };
  }

  // ------------------------------------------------------------------
  // 🔹 deleteIndex — drop a class and everything in it
  // ------------------------------------------------------------------
  async deleteIndex(name) {
    if (!name) throw new Error("Weaviate class name is required.");
    const res = await fetch(`${this.host}/v1/schema/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: this._headers(),
    });
    if (!res.ok) {
      throw new Error(`Weaviate delete class failed (${res.status}): ${await errorText(res)}`);
    }
    return true;
  }

  // ------------------------------------------------------------------
  // 🔹 upsert — embed + batch upsert via /v1/batch/objects
  // ------------------------------------------------------------------
  async upsert(chunks) {
    if (!chunks.length) return;
    if (!this.className) {
      throw new Error(
        "Weaviate class is not configured — bind a vector index resource to the KB."
      );
    }

    const batches = chunkArray(chunks, 100);

    for (const batch of batches) {
      try {
        logToFile("vector.log", `➡️ Weaviate batch of ${batch.length}`);

        // Generate embeddings
        const texts = batch.map((c) => c.text);
        // KB adapter → CF fallback on failure (shared contract with the query
        // path — query/kb-retrieval.js embedQuestion).
        const embeddings = await embedBatchWithFallback(this.embeddingAdapter, texts, this.companyName,
          { stats: this.embedStats });

        if (!embeddings || embeddings.length !== batch.length) {
          throw new Error("Embedding mismatch");
        }

        // Build Weaviate objects — ids MUST be UUIDs, so the pipeline's
        // `<48hex>-<n>` id is derived into a deterministic UUID (same id →
        // same object on re-ingestion).
        const objects = batch.map((chunk, i) => {
          if (!chunk.id) throw new Error("Missing chunk.id");
          return {
            class: this.className,
            id: normalizeVectorId(chunk.id, "weaviate"),
            vector: embeddings[i],
            properties: {
              r2_key: cleanString(chunk.r2_key || ""),
              url: cleanString(chunk.url || ""),
              title: cleanString(chunk.title || "").slice(0, 200),
              preview: cleanString(chunk.text).slice(0, 200),
              type: cleanString(chunk.metadata?.type || ""),
              slug: cleanString(chunk.metadata?.slug || ""),
              chunkIndex: Number(chunk.metadata?.chunkIndex ?? i),
            },
          };
        });

        // Batch upsert via REST API
        const url = `${this.host}/v1/batch/objects`;
        const res = await fetch(url, {
          method: "POST",
          headers: this._headers(),
          body: JSON.stringify({ objects }),
        });

        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          throw new Error(`Weaviate upsert failed (${res.status}): ${msg.slice(0, 200)}`);
        }

        console.log(`✅ Weaviate upserted batch (${batch.length})`);
        logToFile("vector.log", `✅ Weaviate batch success (${batch.length})`);
      } catch (error) {
        console.error("❌ Weaviate batch failed:", error.message);
        logToFile("error.log", `Weaviate upsert error: ${error.message}`);
        throw error;
      }
    }
  }

  // ------------------------------------------------------------------
  // 🔹 query — nearVector search
  // ------------------------------------------------------------------
  async query(vector, topK = 10, { indexName = null } = {}) {
    const className = indexName || this.className;
    if (!className) throw new Error("Weaviate class name is not configured.");

    // Weaviate GraphQL nearVector query
    const gql = `{
      Get {
        ${className}(
          nearVector: { vector: [${vector.join(",")}] }
          limit: ${topK}
        ) {
          _additional { id distance }
          r2_key
          url
          title
          preview
          type
          slug
          chunkIndex
        }
      }
    }`;

    const url = `${this.host}/v1/graphql`;
    const res = await fetch(url, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify({ query: gql }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`Weaviate query failed (${res.status}): ${msg.slice(0, 200)}`);
    }

    const json = await res.json();
    const results = json?.data?.Get?.[className] || [];

    return {
      matches: results.map((r) => {
        const { _additional, ...rest } = r;
        return {
          id: _additional?.id || "",
          score: _additional?.distance != null ? 1 - _additional.distance : 0, // cosine distance → similarity
          metadata: rest,
          values: null,
        };
      }),
    };
  }

  // ------------------------------------------------------------------
  // 🔹 countVectors — best-effort object count
  // ------------------------------------------------------------------
  async countVectors() {
    try {
      const gql = `{
        Aggregate {
          ${this.className} {
            meta { count }
          }
        }
      }`;
      const res = await fetch(`${this.host}/v1/graphql`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ query: gql }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.data?.Aggregate?.[this.className]?.[0]?.meta?.count ?? null;
    } catch {
      return null;
    }
  }
}
