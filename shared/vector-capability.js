// --------------------------
// SHARED — vector-capability vocabulary.
// Single source of truth for which provider_keys can actually serve KB
// vector ingestion. Mirrors the switch in mysql/adapters/vector/factory.js:
//   cloudflare (Vectorize) · pinecone · qdrant · weaviate · openai
// Storage-only providers (cloudflare_r2, aws_s3, minio, …) advertise
// buckets, NOT indexes — binding a KB's Vector Store to one makes the ingest
// job fail with "Unsupported vector provider" before it does any work.
// Used by BOTH the server (mysql/routes/kbs.js options annotation +
// mysql/services/kb-service.js save/update guard) and the admin portal
// (web/src/components/kb-modal.jsx dropdown filter + mismatch warning).
// Pure ESM, no node_modules deps — node --test can import it directly.
// --------------------------

/** Provider keys the vector adapter factory can build an ingest adapter for. */
export const VECTOR_CAPABLE_PROVIDER_KEYS = [
  "cloudflare",
  "pinecone",
  "qdrant",
  "weaviate",
  "openai",
];

/**
 * Can this provider store ingestion vectors?
 * @param {string|null} providerKey  providers.provider_key (e.g. "cloudflare_r2")
 * @returns {boolean}
 */
export function isVectorCapableProvider(providerKey) {
  return VECTOR_CAPABLE_PROVIDER_KEYS.includes(String(providerKey || ""));
}

/**
 * Partition provider_resources rows (or any objects carrying provider_key)
 * into vector-capable and incapable lists.
 * @param {Array<Object>} resources  rows with a provider_key field
 * @returns {{ capable: Array, incapable: Array }}
 */
export function splitVectorCapable(resources) {
  const capable = [];
  const incapable = [];
  for (const r of resources || []) {
    (isVectorCapableProvider(r?.provider_key) ? capable : incapable).push(r);
  }
  return { capable, incapable };
}
