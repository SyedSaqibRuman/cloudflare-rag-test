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
