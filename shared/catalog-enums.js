// --------------------------
// SHARED — catalog ENUM vocabulary.
// Single source of truth for the three provider-catalog enums used by BOTH
// the API server (mysql/routes/providers.js validation + error messages) and
// the admin portal (web/src/pages/catalog/constants.js → model-modal). Keep
// in sync with the MySQL ENUM columns in migrations/001_init.sql:
//   providers.primary_service_category
//   providers.auth_type
//   provider_models.category
// Pure ESM, no node_modules deps — node --test can import it directly.
// --------------------------

export const PROVIDER_CATEGORIES = [
  "ai",
  "embedding",
  "vector",
  "storage",
  "graph",
  "image",
  "speech",
  "search",
  "database",
  "email",
  "analytics",
];

export const PROVIDER_AUTH_TYPES = ["api_key", "bearer_token", "oauth2", "basic_auth", "custom"];

export const MODEL_CATEGORIES = ["chat", "embedding", "reranker", "image", "tts", "stt", "vision"];

// Knowledge base ingestion source types.
export const KB_SOURCE_TYPES = ["wordpress", "file", "url", "custom"];
