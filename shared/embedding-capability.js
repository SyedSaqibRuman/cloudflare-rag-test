// --------------------------
// SHARED — embedding-capability vocabulary.
// Single source of truth for which catalog embedding models can actually serve
// a KB for a given company. Mirrors the switch in
// mysql/adapters/embedding/factory.js:
//   cloudflare · openai · openrouter · nvidia · anthropic
//
// Two INDEPENDENT gates decide availability, and a model must pass both:
//
//   1. Adapter gate — the provider_key has an embedding adapter. Without one,
//      ingest/resolve.js calls createEmbeddingAdapter() and throws
//      "Unsupported embedding provider: <key>", so the KB row binds a model
//      that can never embed. Catalog providers like jina/voyage/cohere/venice
//      advertise embedding models but have no adapter here.
//   2. Credential gate — the company holds an ACTIVE credential for that
//      provider. resolveKbAdapters() looks the credential up per provider and
//      passes {} when it finds none, so the adapter would call the upstream API
//      unauthenticated and get a 401 on the first ingest.
//
// The KB wizard's Storage & Search step filters its Embedding Model dropdown
// through this so an admin can only pick something that will actually work
// (the bind-time probe would otherwise be the first place they find out).
// Mirrors shared/vector-capability.js for the vector-store dropdown.
// Pure ESM, no node_modules deps — node --test can import it directly.
// --------------------------

/** Provider keys the embedding adapter factory can build an adapter for. */
export const EMBEDDING_CAPABLE_PROVIDER_KEYS = [
  "cloudflare",
  "openai",
  "openrouter",
  "nvidia",
  "anthropic",
];

/**
 * Does this provider have an embedding adapter?
 * @param {string|null} providerKey  providers.provider_key (e.g. "jina")
 * @returns {boolean}
 */
export function isEmbeddingCapableProvider(providerKey) {
  return EMBEDDING_CAPABLE_PROVIDER_KEYS.includes(String(providerKey || ""));
}

/**
 * Split catalog embedding models into the ones this company can actually use
 * and the ones it cannot. A model is available when its provider has an
 * embedding adapter AND the company has an active credential for that provider.
 * Rows with no `provider_key` land in neither list (malformed catalog data —
 * better invisible than offered and then failing at ingest).
 *
 * @param {Array<Object>} models  provider_models rows with provider_key
 * @param {{credentialProviderKeys?: Iterable<string>}} [opts]
 * @returns {{ available: Array<Object>, unavailable: Array<Object> }}
 */
export function partitionEmbeddingModels(models, opts = {}) {
  const keys = opts?.credentialProviderKeys;
  const hasCredential = (providerKey) => {
    if (!keys) return false;
    if (typeof keys.has === "function") return keys.has(providerKey);
    return Array.isArray(keys) && keys.includes(providerKey);
  };

  const available = [];
  const unavailable = [];
  for (const model of models || []) {
    const providerKey = model?.provider_key;
    if (!providerKey) continue;
    if (isEmbeddingCapableProvider(providerKey) && hasCredential(providerKey)) available.push(model);
    else unavailable.push(model);
  }
  return { available, unavailable };
}
