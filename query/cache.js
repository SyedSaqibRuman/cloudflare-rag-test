import crypto from "crypto";

// --------------------------
// CONFIGURATION
// --------------------------
const CACHE_TTL_MS = 1000 * 60 * 60;
const CACHE_MAX_SIZE = 200;

/** @type {Map<string, { value: any, expiry: number, company?: string }>} */
const cache = new Map();

/**
 * Generate a cache key that includes the full retrieval binding fingerprint.
 *
 * ADR-012 Phase 1: Cache key isolation.
 * The key must encode every factor that can change the answer without
 * changing the question text:
 *   - companyName (tenant isolation)
 *   - assistantKey (persona + model + KB binding)
 *   - embeddingModel (different models = different vector spaces)
 *   - vectorIndex (different indexes = different retrieval results)
 *   - storageBucket (different buckets = different chunk source text)
 *   - llmModel (different LLMs = different answers)
 *   - question (the rewritten search query)
 *
 * When any of these changes, the cache key changes and stale answers
 * from incompatible vector spaces, chunk stores, or LLM models are never served.
 *
 * @param {string} question — the rewritten search query
 * @param {string} companyName
 * @param {string} [assistantKey=""]
 * @param {object} [binding={}] — retrieval binding fingerprint
 * @param {string} [binding.embeddingModel=""] — e.g. "@cf/baai/bge-base-en-v1.5"
 * @param {string} [binding.vectorIndex=""] — e.g. "popularcert-index"
 * @param {string} [binding.storageBucket=""] — chunk bucket the assistant's KB reads (empty → company config)
 * @param {string} [binding.llmModel=""] — e.g. "@cf/meta/llama-3.1-8b-instruct-fp8"
 * @returns {string} — MD5 hex digest
 */
export function getCacheKey(question, companyName, assistantKey = "", binding = {}) {
  const parts = [
    companyName || "",
    assistantKey || "",
    binding.embeddingModel || "",
    binding.vectorIndex || "",
    binding.storageBucket || "",
    binding.llmModel || "",
    question,
  ];
  const key = parts.join(":");
  return crypto.createHash("md5").update(key).digest("hex");
}

export function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

export function setCache(key, value, companyName) {
  if (cache.size >= CACHE_MAX_SIZE) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, expiry: Date.now() + CACHE_TTL_MS, company: companyName });
}

/**
 * Drop every cached answer belonging to one company (used by the Ask Console's
 * conversation reset). Returns the number of entries removed. Entries from
 * before the company tag existed (set without a companyName) are left alone.
 */
export function clearCompanyCache(companyName) {
  let removed = 0;
  for (const [key, item] of cache) {
    if (item.company === companyName) {
      cache.delete(key);
      removed += 1;
    }
  }
  return removed;
}
