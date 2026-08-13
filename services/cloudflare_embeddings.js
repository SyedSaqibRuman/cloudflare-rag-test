import pLimit from "p-limit";
import { logToFile } from "../utils/logger.js";
import { chunkArray, sleep } from "../utils/helpers.js";
import { getConfig } from "../config/index.js";
import { fetchCloudflareAI } from "./cloudflare_ai.js";

/** Read embedding model from runtime config (supports hot-swap). */
function getEmbeddingModel(companyName) {
  return getConfig(companyName).EMBEDDING_MODEL || "@cf/baai/bge-base-en-v1.5";
}

// 🔥 Tunable settings
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;
const BATCH_SIZE = 4;              // 🔥 key improvement
const CONCURRENCY = 2;             // 🔥 prevents bursts

const limit = pLimit(CONCURRENCY);

// --------------------------
// 🔥 Batch Embedding Request
// --------------------------
async function fetchEmbeddingBatch(texts, attempt = 0, companyName, model) {
  try {
    const resolvedModel = model || getEmbeddingModel(companyName);
    const res = await fetchCloudflareAI(companyName, resolvedModel, { text: texts }); // 🔥 batch input

    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries`);
      }

      const retryAfter = res.headers.get("Retry-After");
      const delay = retryAfter
        ? parseInt(retryAfter) * 1000
        : BASE_DELAY_MS * 2 ** attempt + Math.random() * 300;

      console.warn(`⚠️ 429 Rate limited — retrying in ${delay}ms`);
      await sleep(delay);

      return fetchEmbeddingBatch(texts, attempt + 1, companyName, model);
    }

    if (!res.ok) {
      throw new Error(`Embedding API error: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();

    if (!json.success || !json.result?.data) {
      throw new Error(`Invalid embedding response`);
    }

    return json.result.data;

  } catch (err) {
    if (attempt >= MAX_RETRIES) throw err;

    const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 300;
    console.warn(`⚠️ Retry due to error: ${err.message}, waiting ${delay}ms`);

    await sleep(delay);
    return fetchEmbeddingBatch(texts, attempt + 1, companyName, model);
  }
}

// --------------------------
// 🔥 MAIN FUNCTION
// --------------------------
export async function generateEmbeddings(texts = [], companyName, model = null) {
  if (!texts.length) return [];

  const batches = chunkArray(texts, BATCH_SIZE);

  // 🔥 Pre-allocate results array
  const results = new Array(texts.length);

  await Promise.all(
    batches.map((batch, batchIndex) =>
      limit(async () => {
        try {
          const embeddings = await fetchEmbeddingBatch(batch, 0, companyName, model);

          embeddings.forEach((emb, i) => {
            const globalIndex = batchIndex * BATCH_SIZE + i;
            results[globalIndex] = emb;
          });

        } catch (err) {
          logToFile("error.log", `Batch failed: ${err.message}`);
          console.error("Batch embedding failed:", err.message);

          // preserve alignment
          batch.forEach((_, i) => {
            const globalIndex = batchIndex * BATCH_SIZE + i;
            results[globalIndex] = null;
          });
        }
      })
    )
  );

  return results;
}
