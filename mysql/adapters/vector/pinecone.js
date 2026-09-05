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

function cleanString(str = "") {
  return str.replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

export class PineconeAdapter {
  constructor(credentials, { embeddingAdapter } = {}) {
    this.providerKey = "pinecone";
    this.apiKey = credentials.apiKey;
    this.environment = credentials.environment || "us-east1-gcp";
    this.vectorIndexName = credentials.vectorIndexName;
    this.namespace = credentials.namespace || "";
    this.embeddingAdapter = embeddingAdapter || null;
    this.companyName = credentials.companyName;
    this.dimensions = credentials.dimensions || 768;

    // Pinecone host: https://<index>-<project>.svc.<env>.pinecone.io
    this.host = credentials.host || this._buildHost();
  }

  _buildHost() {
    const idx = this.vectorIndexName;
    const project = this.apiKey?.split(".")?.[1] || "unknown";
    const env = this.environment;
    return `https://${idx}-${project}.svc.${env}.pinecone.io`;
  }

  _headers() {
    return {
      "Content-Type": "application/json",
      "Api-Key": this.apiKey,
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

  // ------------------------------------------------------------------
  // 🔹 upsert — embed + upsert batches
  // ------------------------------------------------------------------
  async upsert(chunks) {
    if (!chunks.length) return;

    const batches = chunkArray(chunks, 100);

    for (const batch of batches) {
      try {
        logToFile("vector.log", `➡️ Pinecone batch of ${batch.length}`);

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
  async query(vector, topK = 10, { indexName = null } = {}) {
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
