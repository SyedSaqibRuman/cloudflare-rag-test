import pLimit from "p-limit";
import { logToFile } from "../utils/logger.js";
import { chunkArray, sleep } from "../utils/helpers.js";
import { env } from "../env.js";
import { getConfig } from "../config/index.js";

const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = env.CLOUDFLARE_API_TOKEN;

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
async function fetchEmbeddingBatch(texts, attempt = 0, companyName) {
  try {
    const model = getEmbeddingModel(companyName);
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: texts }), // 🔥 batch input
      }
    );

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

      return fetchEmbeddingBatch(texts, attempt + 1, companyName);
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
    return fetchEmbeddingBatch(texts, attempt + 1, companyName);
  }
}

// --------------------------
// 🔥 MAIN FUNCTION
// --------------------------
export async function generateEmbeddings(texts = [], companyName) {
  if (!texts.length) return [];

  const batches = chunkArray(texts, BATCH_SIZE);

  // 🔥 Pre-allocate results array
  const results = new Array(texts.length);

  await Promise.all(
    batches.map((batch, batchIndex) =>
      limit(async () => {
        try {
          const embeddings = await fetchEmbeddingBatch(batch, 0, companyName);

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
