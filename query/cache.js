import crypto from "crypto";

// --------------------------
// CONFIGURATION
// --------------------------
const CACHE_TTL_MS = 1000 * 60 * 60;
const CACHE_MAX_SIZE = 200;

/** @type {Map<string, { value: any, expiry: number }>} */
const cache = new Map();

export function getCacheKey(question, companyName) {
  const key = `${companyName || ""}:${question}`;
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

export function setCache(key, value) {
  if (cache.size >= CACHE_MAX_SIZE) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, expiry: Date.now() + CACHE_TTL_MS });
}
