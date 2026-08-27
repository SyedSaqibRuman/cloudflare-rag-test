import crypto from "crypto";

// --------------------------
// CONFIGURATION
// --------------------------
const CACHE_TTL_MS = 1000 * 60 * 60;
const CACHE_MAX_SIZE = 200;

/** @type {Map<string, { value: any, expiry: number, company?: string }>} */
const cache = new Map();

export function getCacheKey(question, companyName, assistantKey = "") {
  // The assistant scopes the answer persona (system prompt / model / KBs), so
  // switching assistants must not serve stale cached answers.
  const key = `${companyName || ""}:${assistantKey || ""}:${question}`;
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
