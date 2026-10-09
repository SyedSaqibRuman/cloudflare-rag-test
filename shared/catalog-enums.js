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

// Knowledge base ingestion source types — the FULL vocabulary. This mirrors the
// `knowledge_bases.source_type` ENUM, so it must keep listing every value a
// stored row can carry, including ones no longer offered in the KB wizard.
export const KB_SOURCE_TYPES = ["wordpress", "file", "url", "custom"];

// Source types withdrawn from the KB wizard and from the create/update API:
//   wordpress — unusable against sites whose Elementor / optimization stack
//               hoists each post's inline CSS in FRONT of the REST JSON
//               (maxicert.com, 2026-09-28: 913 KB of <style> blocks prepended
//               to a 15 MB response). The fetcher refuses the body rather than
//               ingest a page of CSS.
//   custom    — the generic REST feed is unfinished (no mapping editor).
//
// They are HIDDEN, not deleted: rows that already carry a withdrawn source_type
// keep ingesting unchanged (ingest/sources/index.js still resolves them), and
// the URL / Sitemap source covers the same WordPress content via
// wp-sitemap.xml. Re-enable by emptying this list — no other edit is needed.
export const KB_DISABLED_SOURCE_TYPES = ["wordpress", "custom"];

/** Source types offered in the KB wizard and accepted by the KB create/update API. */
export const KB_ENABLED_SOURCE_TYPES = KB_SOURCE_TYPES.filter(
  (type) => !KB_DISABLED_SOURCE_TYPES.includes(type)
);

/**
 * Default source_type for a KB saved without an explicit `sourceType`.
 * The first OFFERED type ("file" today) — never a withdrawn one, so a bare
 * `POST /gateway/kbs { kbKey, kbName }` still saves. Re-enabling "wordpress"
 * promotes it back to the default, restoring the previous behavior.
 */
export const KB_DEFAULT_SOURCE_TYPE = KB_ENABLED_SOURCE_TYPES[0];

/**
 * Whether a source type may be SELECTED (portal) or SAVED (API).
 * A withdrawn value still passes validation when it is the row's unchanged,
 * already-stored value — re-saving a legacy KB is a no-op, not a selection.
 * See `validateKbInput(input, { currentSourceType })` in mysql/services/kb-service.js.
 * @param {string} type
 * @returns {boolean}
 */
export function isSourceTypeEnabled(type) {
  return KB_ENABLED_SOURCE_TYPES.includes(type);
}
