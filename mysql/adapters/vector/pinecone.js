// --------------------------
// PINECONE VECTOR ADAPTER
// Adapts Pinecone's REST API for the dual-mode ingestion + query pipeline.
// Uses raw fetch (no SDK dependency) — consistent with the project's lean
// supply chain policy (ADR-012 §4).
//
// Credentials required: apiKey, environment (e.g. "us-east1-gcp")
// Pinecone index name is passed as vectorIndexName.
// --------------------------

import { chunkArray } from "../../../utils/helpers.js";
import { logToFile } from "../../../utils/logger.js";
import { embedBatchWithFallback } from "../embed-fallback.js";

function cleanString(str = "") {
  return str.replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

/** Control-plane base URL — index CRUD lives here, NOT on the data-plane host. */
const CONTROL_PLANE = "https://api.pinecone.io";

/** Provider error text for a failed REST call ({ message } or { error }). */
async function errorText(res) {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text);
    return body?.message || body?.error?.message || body?.error || text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

export class PineconeAdapter {
  constructor(credentials, { embeddingAdapter } = {}) {
    this.providerKey = "pinecone";
    // api_key (auth-schema field) → apiKey (camelCase, per adapter convention);
    // normalizeCredential in ingest/resolve.js now does this too, so both
    // shapes are accepted here.
    this.apiKey = credentials.apiKey || credentials.api_key || "";
    this.environment = credentials.environment || "";
    this.vectorIndexName = credentials.vectorIndexName || "";
    this.namespace = credentials.namespace || "";
    this.embeddingAdapter = embeddingAdapter || null;
    this.companyName = credentials.companyName;
    // Optional EmbedFallbackStats collector — set by ingestion so KB-bound
    // embedding failures are visible on the KB detail page (not just logs).
    this.embedStats = credentials.embedStats || null;
    this.dimensions = credentials.dimensions || 768;

    // Serverless indexes have per-index hosts — prefer the explicit host
    // credential, then derive the legacy pod-based URL when possible.
    // Pinecone's control plane returns hosts WITHOUT a scheme
    // ("<index>-<id>.svc.aped-….pinecone.io") — fetch() rejects those, so
    // normalize to https:// here (caught live: "Failed to parse URL").
    this.host = this._normalizeHost(credentials.host || this._buildHost());
  }

  _normalizeHost(host) {
    if (!host) return "";
    const trimmed = String(host).trim().replace(/\/+$/, "");
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  _buildHost() {
    if (!this.vectorIndexName) return "";
    // Legacy host: https://<index>-<project>.svc.<env>.pinecone.io — the
    // project segment is only derivable from old-style "<key>.<project>.<env>"
    // keys. Modern pcsk_… serverless keys carry no project segment, so callers
    // must provide the explicit `host` credential for them.
    const idx = this.vectorIndexName;
    const project = this.apiKey?.split(".")?.[1];
    if (!project || !this.environment) return "";
    return `https://${idx}-${project}.svc.${this.environment}.pinecone.io`;
  }

  _headers() {
    return {
      "Content-Type": "application/json",
      "Api-Key": this.apiKey,
      // Required on all data-plane calls since 2024-07 (date-based versioning).
      "X-Pinecone-API-Version": "2025-01",
    };
  }

  // ------------------------------------------------------------------
  // 🔹 ensureIndex — create index if it doesn't exist
  // ------------------------------------------------------------------
  async ensureIndex() {
    // Pinecone indexes are typically pre-created via console or API.
    // This is a no-op for now — Pinecone auto-creates on first upsert
    // for serverless, or requires explicit creation for pod-based.
    console.log(`📌 Pinecone: ensureIndex('${this.vectorIndexName}') — assumed pre-created`);
  }

  /** Normalize a control-plane index object for the portal's resource rows. */
  _indexRow(idx = {}) {
    const ready = idx.status?.ready;
    return {
      id: idx.name,
      name: idx.name,
      dimensions: idx.dimension ?? null,
      metric: idx.metric ?? null,
      // The list API carries no vector count (that's a data-plane call per
      // index) — the portal shows "—" instead of fanning out N requests.
      vectorCount: null,
      host: idx.host ?? null,
      // "ready" / "initializing" / "terminating" — the card renders this as a badge.
      status: ready === true ? "ready" : ready === false ? "initializing" : idx.status?.state || null,
      createdAt: idx.created_at ?? null,
    };
  }

  // ------------------------------------------------------------------
  // 🔹 listIndexes — live index list (control plane; works with pcsk_ keys
  // that carry no data-plane host, same call the provider Test probe uses)
  // ------------------------------------------------------------------
  async listIndexes() {
    if (!this.apiKey) throw new Error("Pinecone API key is not configured.");
    const res = await fetch(`${CONTROL_PLANE}/indexes`, { headers: this._headers() });
    if (!res.ok) throw new Error(`Pinecone list indexes failed (${res.status}): ${await errorText(res)}`);
    const json = await res.json().catch(() => null);
    return (json?.indexes || []).map((idx) => this._indexRow(idx));
  }

  // ------------------------------------------------------------------
  //  createIndex — create a serverless index (control plane)
  // @param {{ name, dimensions?, metric?, cloud?, region? }} input
  // ------------------------------------------------------------------
  async createIndex({ name, dimensions, metric, cloud, region } = {}) {
    if (!this.apiKey) throw new Error("Pinecone API key is not configured.");
    if (!name) throw new Error("Pinecone index name is required.");
    const res = await fetch(`${CONTROL_PLANE}/indexes`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify({
        name,
        dimension: Number(dimensions) || this.dimensions || 768,
        metric: metric || "cosine",
        spec: { serverless: { cloud: cloud || "aws", region: region || "us-east-1" } },
      }),
    });
    if (!res.ok) throw new Error(`Pinecone create index failed (${res.status}): ${await errorText(res)}`);
    const json = await res.json().catch(() => null);
    return this._indexRow(json || { name });
  }

  // ------------------------------------------------------------------
  // 🔹 deleteIndex — delete an index (control plane; irreversible)
  // ------------------------------------------------------------------
  async deleteIndex(name) {
    if (!this.apiKey) throw new Error("Pinecone API key is not configured.");
    if (!name) throw new Error("Pinecone index name is required.");
    const res = await fetch(`${CONTROL_PLANE}/indexes/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: this._headers(),
    });
    if (!res.ok) throw new Error(`Pinecone delete index failed (${res.status}): ${await errorText(res)}`);
    return true;
  }

  // ------------------------------------------------------------------
  // 🔹 upsert — embed + upsert batches
  // ------------------------------------------------------------------
  async upsert(chunks) {
    if (!chunks.length) return;
    if (!this.host) {
      throw new Error(
        "Pinecone host is not configured — set the 'host' credential (data-plane URL) for serverless keys."
      );
    }
    if (!this.apiKey) {
      throw new Error("Pinecone API key is missing — set the 'api_key' credential.");
    }

    const batches = chunkArray(chunks, 100);

    for (const batch of batches) {
      try {
        logToFile("vector.log", `➡️ Pinecone batch of ${batch.length}`);

        // Generate embeddings
        const texts = batch.map((c) => c.text);
        // KB adapter → CF fallback on failure (shared contract with the query
        // path — query/kb-retrieval.js embedQuestion).
        const embeddings = await embedBatchWithFallback(this.embeddingAdapter, texts, this.companyName,
          { stats: this.embedStats });

        if (!embeddings || embeddings.length !== batch.length) {
          throw new Error("Embedding mismatch");
        }

        // Build Pinecone vectors
        const vectors = batch.map((chunk, i) => {
          if (!chunk.id) throw new Error("Missing chunk.id");
          return {
            id: chunk.id,
            values: embeddings[i],
            metadata: {
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

        // Upsert via REST API
        const url = `${this.host}/vectors/upsert`;
        const body = { vectors, namespace: this.namespace || undefined };

        const res = await fetch(url, {
          method: "POST",
          headers: this._headers(),
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          throw new Error(`Pinecone upsert failed (${res.status}): ${msg.slice(0, 200)}`);
        }

        console.log(`✅ Pinecone upserted batch (${batch.length})`);
        logToFile("vector.log", `✅ Pinecone batch success (${batch.length})`);
      } catch (error) {
        console.error("❌ Pinecone batch failed:", error.message);
        logToFile("error.log", `Pinecone upsert error: ${error.message}`);
        throw error;
      }
    }
  }

  // ------------------------------------------------------------------
  // 🔹 query — search by vector
  // ------------------------------------------------------------------
  async query(vector, topK = 10, { indexName: _indexName = null } = {}) {
    if (!this.host) {
      throw new Error(
        "Pinecone host is not configured — set the 'host' credential (data-plane URL) for serverless keys."
      );
    }
    const url = `${this.host}/query`;

    const body = {
      vector,
      topK,
      includeMetadata: true,
      includeValues: true,
      namespace: this.namespace || undefined,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`Pinecone query failed (${res.status}): ${msg.slice(0, 200)}`);
    }

    const json = await res.json();

    return {
      matches: (json.matches || []).map((m) => ({
        id: m.id,
        score: m.score,
        metadata: m.metadata || {},
        values: m.values || null,
      })),
    };
  }

  // ------------------------------------------------------------------
  // 🔹 countVectors — best-effort vector count
  // ------------------------------------------------------------------
  async countVectors() {
    try {
      const url = `${this.host}/describe_index_stats`;
      const res = await fetch(url, {
        method: "GET",
        headers: this._headers(),
      });
      if (!res.ok) return null;
      const json = await res.json();
      const ns = json.namespaces?.[this.namespace || ""];
      return ns?.vectorCount ?? json.totalVectorCount ?? null;
    } catch {
      return null;
    }
  }
}
