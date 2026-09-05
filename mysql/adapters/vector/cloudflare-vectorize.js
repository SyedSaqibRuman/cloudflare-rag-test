// --------------------------
// CLOUDFLARE VECTOR ADAPTER
// Adapts Cloudflare Vectorize API for the ingestion pipeline.
// When an embeddingAdapter is injected, it generates embeddings through
// the adapter interface instead of hardcoding a specific AI provider.
// --------------------------

import { createVectorIndex } from "../../../services/vectorize.js";
import { chunkArray } from "../../../utils/helpers.js";
import { logToFile } from "../../../utils/logger.js";
import { getCFClient } from "../../../client.js";
import { getConfig } from "../../../config/index.js";

// --------------------------
// 🔹 Config
// --------------------------
const DEFAULT_DIMENSIONS = 768;

const accountId = (companyName) => {
  try {
    return getConfig(companyName).CLOUDFLARE_ACCOUNT_ID || "";
  } catch {
    return "";
  }
};

function cleanString(str = "") {
  return str.replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").trim();
}

export class CloudflareVectorAdapter {
  constructor(credentials, { embeddingAdapter } = {}) {
    this.providerKey = "cloudflare";
    this.accountId = credentials.accountId;
    this.apiToken = credentials.apiToken;
    this.vectorIndexName = credentials.vectorIndexName;
    this.embeddingModel = credentials.embeddingModel;
    this.companyName = credentials.companyName;
    this.dimensions = credentials.dimensions;
    this.embeddingAdapter = embeddingAdapter || null;
  }

  async ensureIndex() {
    const dims = this.dimensions || (this.companyName ? getConfig(this.companyName).EMBEDDING_DIMENSIONS : DEFAULT_DIMENSIONS) || DEFAULT_DIMENSIONS;
    await createVectorIndex(this.vectorIndexName, this.companyName, dims);
  }

  async upsert(chunks) {
    if (!chunks.length) return;

    const batches = chunkArray(chunks, 100);
    const acId = accountId(this.companyName);

    for (const batch of batches) {
      try {
        logToFile("vector.log", `➡️ Processing batch of ${batch.length}`);

        // 🔹 Generate embeddings via the injected adapter (not hardcoded generateEmbeddings)
        const texts = batch.map((c) => c.text);
        let embeddings;

        if (this.embeddingAdapter && typeof this.embeddingAdapter.embed === "function") {
          // Use the KB-resolved embedding adapter
          const results = await Promise.all(texts.map((t) => this.embeddingAdapter.embed(t)));
          embeddings = results;
        } else {
          // Fallback: legacy generateEmbeddings (Cloudflare AI only)
          const { generateEmbeddings } = await import("../../../services/cloudflare_embeddings.js");
          embeddings = await generateEmbeddings(texts, this.companyName, this.embeddingModel);
        }

        // 🔹 Validate embeddings
        if (!embeddings || embeddings.length !== batch.length) {
          throw new Error("Embedding mismatch");
        }

        const expectedDims =
          this.dimensions || (this.companyName ? getConfig(this.companyName).EMBEDDING_DIMENSIONS : null) || DEFAULT_DIMENSIONS;
        if (embeddings.some((e) => !e || e.length !== expectedDims)) {
          throw new Error("Invalid embedding detected");
        }

        // 🔹 Build NDJSON
        const lines = batch.map((chunk, i) => {
          if (!chunk.id) throw new Error("Missing chunk.id");
          if (!chunk.r2_key) throw new Error(`Missing r2_key: ${chunk.id}`);
          if (!chunk.text) throw new Error(`Missing text: ${chunk.id}`);

          return JSON.stringify({
            id: chunk.id,
            values: embeddings[i],
            metadata: {
              r2_key: cleanString(chunk.r2_key),
              url: cleanString(chunk.url || ""),
              title: cleanString(chunk.title || "").slice(0, 200),
              preview: cleanString(chunk.text).slice(0, 200),
              type: cleanString(chunk.metadata?.type || ""),
              slug: cleanString(chunk.metadata?.slug || ""),
              chunkIndex: Number(chunk.metadata?.chunkIndex ?? i),
            },
          });
        });

        const ndjson = lines.join("\n") + "\n";

        // 🔹 Upsert via SDK
        const vectorIndex = this.vectorIndexName;
        if (!vectorIndex) throw new Error("VECTOR_INDEX is not configured.");

        await getCFClient(this.companyName).vectorize.indexes.upsert(vectorIndex, {
          account_id: acId,
          "unparsable-behavior": "error",
          body: ndjson,
        });

        console.log(`✅ Upserted batch (${batch.length})`);
        logToFile("vector.log", `✅ Batch success (${batch.length})`);
      } catch (error) {
        console.error(`❌ Batch failed:`, error.message);
        logToFile("error.log", "================ UPSERT ERROR ================");
        logToFile("error.log", error.message);
        logToFile("error.log", JSON.stringify(batch[0] || {}));
        logToFile("error.log", "==============================================");
        throw error;
      }
    }
  }

  // ------------------------------------------------------------------
  // 🔹 Query — search by vector
  // ------------------------------------------------------------------
  async query(vector, topK = 10, { indexName = null } = {}) {
    const idx = indexName || this.vectorIndexName;
    if (!idx) throw new Error("VECTOR_INDEX is not configured.");
    const acId = accountId(this.companyName);

    const res = await getCFClient(this.companyName).vectorize.indexes.query(idx, {
      account_id: acId,
      topK,
      vector,
      returnMetadata: "all",
      returnValues: true,
    });

    return {
      matches: (res.matches || []).map((m) => ({
        id: m.id,
        score: m.score,
        metadata: m.metadata || {},
        values: m.values || null,
      })),
    };
  }

  // ------------------------------------------------------------------
  // 🔹 Count vectors in index
  // ------------------------------------------------------------------
  async countVectors({ indexName = null } = {}) {
    const idx = indexName || this.vectorIndexName;
    if (!idx) return null;
    try {
      const res = await getCFClient(this.companyName).vectorize.indexes.get(idx, {
        account_id: acId,
      });
      return res?.result?.vectorCount ?? null;
    } catch {
      return null;
    }
  }
}