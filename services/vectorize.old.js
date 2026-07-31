import { generateEmbeddings } from "./cloudflare_embeddings.js";
import "dotenv/config";
import { logToFile } from "../utils/logger.js";

// --------------------------
// 🔹 Config
// --------------------------
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const VECTOR_INDEX = process.env.VECTOR_INDEX;
const DIMENSIONS = 768;

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/vectorize/v2/indexes`;
const HEADERS = {
  Authorization: `Bearer ${API_TOKEN}`,
  "Content-Type": "application/json",
};

// --------------------------
// 🔹 Helpers
// --------------------------
function chunkArray(arr, size = 100) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

// --------------------------
// 🔹 Index Management
// --------------------------
export async function listVectors() {
  try {
    const res = await fetch(BASE_URL, { headers: HEADERS });
    const json = await res.json();
    return json?.result || [];
  } catch (error) {
    logToFile("error.log", `List vectors error: ${error.message}`);
    console.error("Error listing vectors:", error);
    return [];
  }
}

export async function findVector(name = VECTOR_INDEX) {
  try {
    const vectors = await listVectors();
    return vectors.find(v => v.name === name) || null;
  } catch (error) {
    logToFile("error.log", `Find vector error: ${error.message}`);
    console.error("Error finding vector:", error);
    return null;
  }
}

export async function createVectorIndex(
  name = VECTOR_INDEX,
  dimensions = DIMENSIONS
) {
  try {
    const existing = await findVector(name);

    if (existing) {
      console.log("Vector index already exists");
      return existing;
    }

    console.log("Creating Vector Index...");

    // ✅ Raw fetch — SDK doesn't support metadataIndexes
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        name,
        config: {
          dimensions,
          metric: "cosine",
        },
        // ✅ CRITICAL: declare metadata fields so they are queryable
        metadataIndexes: [
          { propertyName: "r2_key",     indexType: "string" },
          { propertyName: "title",      indexType: "string" },
          { propertyName: "url",        indexType: "string" },
          { propertyName: "type",       indexType: "string" },
          { propertyName: "slug",       indexType: "string" },
          { propertyName: "chunkIndex", indexType: "number" },
        ],
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      throw new Error(`Create index failed: ${res.status} ${JSON.stringify(json)}`);
    }

    console.log("✅ Vector index created:", JSON.stringify(json?.result, null, 2));
    return json?.result;

  } catch (error) {
    logToFile("error.log", `Create index error: ${error.message}`);
    console.error("Error creating vector index:", error);
    throw error;
  }
}

export async function deleteVectorIndex(name = VECTOR_INDEX) {
  try {
    const existing = await findVector(name);

    if (!existing) {
      return `${name} not found`;
    }

    const res = await fetch(`${BASE_URL}/${name}`, {
      method: "DELETE",
      headers: HEADERS,
    });

    const json = await res.json();

    if (!res.ok) {
      throw new Error(`Delete failed: ${res.status} ${JSON.stringify(json)}`);
    }

    console.log("🗑 Vector index deleted");
    return `${name} deleted`;

  } catch (error) {
    logToFile("error.log", `Delete index error: ${error.message}`);
    console.error("Error deleting vector index:", error);
    throw error;
  }
}

// --------------------------
// 🔹 Vector Upsert
// --------------------------
export async function upsertVectors(chunks = []) {
  if (!chunks.length) return;

  try {
    const batches = chunkArray(chunks, 100);

    for (const batch of batches) {

      logToFile("vector.log", `➡️ Processing batch of ${batch.length} chunks`);

      // --------------------------
      // 🔹 Generate embeddings
      // --------------------------
      const texts = batch.map(c => c.text);
      const embeddings = await generateEmbeddings(texts);

      // --------------------------
      // 🔹 Validation
      // --------------------------
      if (!embeddings || embeddings.length !== batch.length) {
        throw new Error("Embedding mismatch");
      }

      if (embeddings.some(e => !e || e.length !== DIMENSIONS)) {
        throw new Error("Invalid embedding detected");
      }

      // --------------------------
      // 🔹 Build NDJSON payload
      // --------------------------
      const lines = batch.map((chunk, i) => {

        if (!chunk.id)     throw new Error("Missing chunk.id");
        if (!chunk.r2_key) throw new Error(`Missing r2_key: ${chunk.id}`);
        if (!chunk.text)   throw new Error(`Missing text: ${chunk.id}`);

        return JSON.stringify({
          id: chunk.id,
          values: embeddings[i],
          metadata: {
            r2_key:     cleanString(String(chunk.r2_key)),
            url:        cleanString(String(chunk.url || "")),
            title:      cleanString(String(chunk.title || "").slice(0, 200)),
            preview:    cleanString(String(chunk.text).slice(0, 200)),
            type:       cleanString(String(chunk.metadata?.type || "")),
            slug:       cleanString(String(chunk.metadata?.slug || "")),
            chunkIndex: Number(chunk.metadata?.chunkIndex ?? i),
          },
        });
      });

      const ndjson = lines.join("\n");

      // --------------------------
      // 🔹 Upsert via raw fetch
      // --------------------------
      const res = await fetch(`${BASE_URL}/${VECTOR_INDEX}/upsert`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/x-ndjson",
        },
        body: ndjson,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Vectorize upsert failed: ${res.status} ${err}`);
      }

      const json = await res.json();
      console.log(`✅ Upserted batch (${batch.length}) → mutationId: ${json?.result?.mutationId}`);
      logToFile("vector.log", `✅ Upserted batch (${batch.length})`);
    }

  } catch (error) {
    logToFile("error.log", "================ UPSERT ERROR ================");
    logToFile("error.log", `Error: ${error.message}`);
    logToFile("error.log", `Chunk sample: ${JSON.stringify(chunks[0] || {})}`);
    logToFile("error.log", "==============================================");

    console.error("❌ Upsert error:", error);
    throw error;
  }
}

function cleanString(str = "") {
  return str
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
