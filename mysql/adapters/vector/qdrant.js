// --------------------------
// QDRANT VECTOR ADAPTER
// Adapts Qdrant's REST API for the dual-mode ingestion + query pipeline.
// Uses raw fetch (no SDK dependency) — consistent with the project's lean
// supply chain policy (ADR-012 §4).
//
// Credentials required: apiKey (optional), host (e.g. "https://xyz.cloud.qdrant.io:6333")
// Qdrant collection name is passed as vectorIndexName.
// --------------------------

import { chunkArray } from "../../../utils/helpers.js";
import { logToFile } from "../../../utils/logger.js";

function cleanString(str = "") {
  return str.replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

export class QdrantAdapter {
  constructor(credentials, { embeddingAdapter } = {}) {
    this.providerKey = "qdrant";
    this.host = credentials.host || "http://localhost:6333";
    this.apiKey = credentials.apiKey || "";
    this.collectionName = credentials.vectorIndexName;
    this.embeddingAdapter = embeddingAdapter || null;
    this.companyName = credentials.companyName;
    this.dimensions = credentials.dimensions || 768;
  }

  _headers() {
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers["api-key"] = this.apiKey;
    }
    return headers;
  }

  // ------------------------------------------------------------------
  // 🔹 ensureIndex — create collection if it doesn't exist
  // ------------------------------------------------------------------
  async ensureIndex() {
    try {
      // Check if collection exists
      const res = await fetch(`${this.host}/collections/${this.collectionName}`, {
        method: "GET",
        headers: this._headers(),
      });

      if (res.ok) {
        console.log(`📌 Qdrant: collection '${this.collectionName}' already exists`);
        return;
      }

      // Create collection
      const createRes = await fetch(`${this.host}/collections/${this.collectionName}`, {
        method: "PUT",
        headers: this._headers(),
        body: JSON.stringify({
          vectors: {
            size: this.dimensions,
            distance: "Cosine",
          },
        }),
      });

      if (!createRes.ok) {
        const msg = await createRes.text().catch(() => "");
        throw new Error(`Qdrant create collection failed (${createRes.status}): ${msg.slice(0, 200)}`);
      }

      console.log(`✅ Qdrant: created collection '${this.collectionName}' with ${this.dimensions} dimensions`);
    } catch (error) {
      console.error(`❌ Qdrant ensureIndex failed:`, error.message);
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // 🔹 upsert — embed + upsert batches
  // ------------------------------------------------------------------
  async upsert(chunks) {
    if (!chunks.length) return;

    const batches = chunkArray(chunks, 100);

    for (const batch of batches) {
      try {
        logToFile("vector.log", `➡️ Qdrant batch of ${batch.length}`);

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

        // Build Qdrant points
        const points = batch.map((chunk, i) => {
          if (!chunk.id) throw new Error("Missing chunk.id");
          return {
            id: chunk.id,
            vector: embeddings[i],
            payload: {
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
        const url = `${this.host}/collections/${this.collectionName}/points`;
        const body = { points };

        const res = await fetch(url, {
          method: "PUT",
          headers: this._headers(),
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          throw new Error(`Qdrant upsert failed (${res.status}): ${msg.slice(0, 200)}`);
        }

        console.log(`✅ Qdrant upserted batch (${batch.length})`);
        logToFile("vector.log", `✅ Qdrant batch success (${batch.length})`);
      } catch (error) {
        console.error("❌ Qdrant batch failed:", error.message);
        logToFile("error.log", `Qdrant upsert error: ${error.message}`);
        throw error;
      }
    }
  }

  // ------------------------------------------------------------------
  // 🔹 query — search by vector
  // ------------------------------------------------------------------
  async query(vector, topK = 10, { indexName = null } = {}) {
    const collection = indexName || this.collectionName;
    if (!collection) throw new Error("Qdrant collection name is not configured.");

    const url = `${this.host}/collections/${collection}/points/search`;

    const body = {
      vector,
      limit: topK,
      with_payload: true,
      with_vector: false,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`Qdrant query failed (${res.status}): ${msg.slice(0, 200)}`);
    }

    const json = await res.json();

    return {
      matches: (json.result || []).map((m) => ({
        id: m.id,
        score: m.score,
        metadata: m.payload || {},
        values: null,
      })),
    };
  }

  // ------------------------------------------------------------------
  // 🔹 countVectors — best-effort vector count
  // ------------------------------------------------------------------
  async countVectors() {
    try {
      const url = `${this.host}/collections/${this.collectionName}`;
      const res = await fetch(url, {
        method: "GET",
        headers: this._headers(),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.result?.points_count ?? null;
    } catch {
      return null;
    }
  }
}
