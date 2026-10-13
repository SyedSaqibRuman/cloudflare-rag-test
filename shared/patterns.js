// --------------------------
// SHARED — validation regexes shared by the API server and the admin portal.
// Single source of truth so the portal's form validation can never drift from
// the server's route validation. Pure ESM, no node_modules deps.
// --------------------------

// Model keys mirror the config-layer contract (config/validation.js allows the
// same charset) so catalog values are always settable as company config values.
// Vendor-prefixed IDs like @cf/baai/bge-base-en-v1.5 or xai/grok-4.6 carry @/:
// and letters/digits of either case — e.g. @cf/moondream/moondream3.1-9B-A2B.
export const MODEL_KEY_RE = /^[a-zA-Z0-9@][a-zA-Z0-9._:@/-]*$/;

// Cloudflare resource names (vector indexes, R2 buckets, D1 databases, KV
// namespaces): lowercase letters, digits, hyphens, underscores, 3-63 chars.
export const RESOURCE_NAME_RE = /^[a-z0-9_-]{3,63}$/;

// Vector-store resource names, per provider — each vendor enforces its OWN
// charset, so the portal/server can't reuse RESOURCE_NAME_RE:
//   pinecone — index name: lowercase letters/digits/hyphens, 1-45 chars,
//              must start and end alphanumeric (Pinecone rejects otherwise)
//   qdrant   — collection name: letters/digits/underscores/hyphens/dots
//   weaviate — class name: MUST start with an uppercase letter; letters,
//              digits, underscores only (Weaviate 422s lowercase classes)
// Keys match the gateway provider_key values in mysql/routes/vector-resources.js.
export const VECTOR_RESOURCE_NAME_RES = {
  pinecone: /^[a-z0-9](?:[a-z0-9-]{0,43}[a-z0-9])?$/,
  qdrant: /^[A-Za-z0-9][A-Za-z0-9_.-]{1,62}$/,
  weaviate: /^[A-Z][A-Za-z0-9_]{2,62}$/,
};
