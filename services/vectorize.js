import { generateEmbeddings } from "./cloudflare_embeddings.js";
import { logToFile } from "../utils/logger.js";
import { getCFClient } from "../client.js";
import { chunkArray } from "../utils/helpers.js";
import { env } from "../env.js";
import { getConfig } from "../config/index.js";

// --------------------------
// 🔹 Config
// --------------------------
const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
const DIMENSIONS = 768;

/** Read VECTOR_INDEX from runtime config (hot-swappable). Falls back to env. */
export function getVectorIndex(companyName) {
  return getConfig(companyName).VECTOR_INDEX;
}

// 🔹 Use shared Cloudflare client from client.js
const client = getCFClient();

// --------------------------
// 🔹 Helpers
// --------------------------
function cleanString(str = "") {
  return str
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --------------------------
// 🔹 Index Management (via Cloudflare SDK)
// --------------------------
export async function listVectors() {
  try {
    const res = await client.vectorize.indexes.list({
      account_id: ACCOUNT_ID,
    });
    return res?.result || [];
  } catch (error) {
    logToFile("error.log", `List vectors error: ${error.message}`);
    console.error("Error listing vectors:", error);
    return [];
  }
}

export async function findVector(name) {
  const vectors = await listVectors();
  return vectors.find((v) => v.name === name) || null;
}

export async function createVectorIndex(
  name,
  companyName,
  dimensions
) {
  // Use company's configured dimensions if not explicitly provided
  const dims = dimensions || (companyName ? getConfig(companyName).EMBEDDING_DIMENSIONS : DIMENSIONS) || DIMENSIONS;
  const existing = await findVector(name);
  if (existing) {
    console.log("Vector index already exists");
    return existing;
  }

  console.log("Creating Vector Index...");

  try {
    const res = await client.vectorize.indexes.create({
      account_id: ACCOUNT_ID,
      name,
      config: {
        dimensions: dims,
        metric: "cosine",
      },
      metadataIndexes: [
        { propertyName: "r2_key", indexType: "string" },
        { propertyName: "title", indexType: "string" },
        { propertyName: "url", indexType: "string" },
        { propertyName: "type", indexType: "string" },
        { propertyName: "slug", indexType: "string" },
        { propertyName: "chunkIndex", indexType: "number" },
      ],
    });

    console.log("✅ Vector index created");
    return res.result;
  } catch (error) {
    logToFile("error.log", `Create index failed: ${error.message}`);
    throw new Error(`Create index failed: ${error.message}`);
  }
}

export async function deleteVectorIndex(name) {
  const existing = await findVector(name);
  if (!existing) return `${name} not found`;

  try {
    await client.vectorize.indexes.delete(name, {
      account_id: ACCOUNT_ID,
    });

    console.log("🗑 Vector index deleted");
    return `${name} deleted`;
  } catch (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }
}

// --------------------------
// 🔹 Vector Upsert
// --------------------------
export async function upsertVectors(chunks = [], companyName) {
  if (!chunks.length) return;

  const batches = chunkArray(chunks, 100);

  for (const batch of batches) {
    try {
      logToFile("vector.log", `➡️ Processing batch of ${batch.length}`);

      // --------------------------
      // 🔹 Generate embeddings
      // --------------------------
      const texts = batch.map((c) => c.text);
      const embeddings = await generateEmbeddings(texts, companyName);

      // --------------------------
      // 🔹 Validate embeddings
      // --------------------------
      if (!embeddings || embeddings.length !== batch.length) {
        throw new Error("Embedding mismatch");
      }

      const expectedDims = (companyName ? getConfig(companyName).EMBEDDING_DIMENSIONS : null) || DIMENSIONS;
      if (embeddings.some((e) => !e || e.length !== expectedDims)) {
        throw new Error("Invalid embedding detected");
      }

      // --------------------------
      // 🔹 Build NDJSON
      // --------------------------
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

      // --------------------------
      // 🔹 Upsert via SDK
      // --------------------------
      const vectorIndex = getVectorIndex(companyName);
      if (!vectorIndex) throw new Error("VECTOR_INDEX is not configured.");

      const res = await client.vectorize.indexes.upsert(vectorIndex, {
        account_id: ACCOUNT_ID,
        "unparsable-behavior": "error",
        body: ndjson,
      });

      console.log(`✅ Upserted batch (${batch.length})`);
      logToFile("vector.log", `✅ Batch success (${batch.length})`);
    } catch (error) {
      console.error("❌ Batch failed:", error.message);

      logToFile("error.log", "================ UPSERT ERROR ================");
      logToFile("error.log", error.message);
      logToFile("error.log", JSON.stringify(batch[0] || {}));
      logToFile("error.log", "==============================================");

      throw error; // fail fast
    }
  }
}

// --------------------------
// 🔹 Vector Query
// --------------------------
export async function vectorQuery(vector, topK, companyName) {
  try {
    const vectorIndex = getVectorIndex(companyName);
    if (!vectorIndex) throw new Error("VECTOR_INDEX is not configured.");

    const res = await client.vectorize.indexes.query(vectorIndex, {
      account_id: ACCOUNT_ID,
      topK: topK,
      vector: vector,
      returnMetadata: "all",
      returnValues: true,
    });

    return res;
  } catch (e) {
    logToFile("error.log", `Vector Query Error: ${e.message || e}`);
    console.error("❌ Vector Query Error:", e.message || e);
    return { matches: [] }; // 🔹 Return empty matches instead of undefined
  }
}

// --------------------------
// 🔹 Get Vectors by ID
// --------------------------
export async function getVectorByID(ids, companyName) {
  try {
    const vectorIndex = getVectorIndex(companyName);
    if (!vectorIndex) throw new Error("VECTOR_INDEX is not configured.");

    const res = await client.vectorize.indexes.getByIds(vectorIndex, {
      account_id: ACCOUNT_ID,
      ids,
    });

    return res;
  } catch (err) {
    console.error("Failed to fetch vectors:", err);
    logToFile("error.log", err);

    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
