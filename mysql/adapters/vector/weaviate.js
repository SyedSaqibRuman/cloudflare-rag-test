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

function cleanString(str = "") {
  return str.replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

export class WeaviateAdapter {
  constructor(credentials, { embeddingAdapter } = {}) {
    this.providerKey = "weaviate";
    this.host = credentials.host || "http://localhost:8080";
    this.apiKey = credentials.apiKey || "";
    this.className = credentials.vectorIndexName;
    this.embeddingAdapter = embeddingAdapter || null;
    this.companyName = credentials.companyName;
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
      const classDef = {
        class: this.className,
        vectorizer: this.vectorizer,
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

      const createRes = await fetch(`${this.host}/v1/schema`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(classDef),
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

  // ------------------------------------------------------------------
  // 🔹 upsert — embed + batch upsert via /v1/batch/objects
  // ------------------------------------------------------------------
  async upsert(chunks) {
    if (!chunks.length) return;

    const batches = chunkArray(chunks, 100);

    for (const batch of batches) {
      try {
        logToFile("vector.log", `➡️ Weaviate batch of ${batch.length}`);

        // Generate embeddings
        const texts = batch.map((c) => c.text);
        let embeddings;

        if (this.embeddingAdapter && typeof this.embeddingAdapter.embed === "function") {
          embeddings = await Promise.all(texts.map((t) => this.embeddingAdapter.embed(t)));
        } else {
          const { generateEmbeddings } = await import("../../../services/cloudflare_embeddings.js");
          embeddings = await generateEmbeddings(texts, this.companyName);
        }

        if (!embeddings || embeddings.length !== batch.length) {
          throw new Error("Embedding mismatch");
        }

        // Build Weaviate objects
        const objects = batch.map((chunk, i) => {
          if (!chunk.id) throw new Error("Missing chunk.id");
          return {
            class: this.className,
            id: chunk.id,
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
