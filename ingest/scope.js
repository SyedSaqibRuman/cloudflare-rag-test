// --------------------------
// INGEST SCOPE HELPERS
// Pure helpers for resolving an ingestion scope and capping URL discovery by
// the KB's saved document limit.
//
// 2026-09-29 regression: KB 'maxicert-web-auto' saved scope "limit" docLimit 3
// ingested 288 docs — the portal Ingest button sent { scope: "all" } (its
// default) and the URL adapter discovered ~288 sitemap targets (default
// maxUrls 1000) that were all ingested because scope "all" maps to
// docLimit null downstream. Two defenses live here:
//   1. capMaxUrls: saved docLimit intersects the URL-discovery cap so a
//      limit-3 KB never fetches a 288-page sitemap just to trim it later.
//   2. resolveEffectiveScope: centralizes the request-scope precedence so the
//      "request scope wins over saved scope" rule is explicit and testable.
// --------------------------

/**
 * Intersect a cap on URL discovery with the KB's saved document limit.
 *
 * @param {number|undefined} maxUrls   Explicit source_config.maxUrls (undefined = no explicit cap)
 * @param {{ scope?: string, limit?: number|undefined }|null} savedScope  Parsed saved scope (source_config)
 * @returns {number|undefined} The effective discovery cap (undefined = adapter default 1000)
 */
export function capMaxUrls(maxUrls, savedScope) {
  const explicit = Number.isFinite(Number(maxUrls)) && Number(maxUrls) > 0 ? Number(maxUrls) : undefined;
  const docLimit =
    savedScope?.scope === "limit" && Number.isFinite(Number(savedScope.limit)) && Number(savedScope.limit) > 0
      ? Number(savedScope.limit)
      : undefined;
  if (explicit != null && docLimit != null) return Math.min(explicit, docLimit);
  return explicit ?? docLimit;
}

/**
 * Effective ingestion scope for a run. The explicit API-request scope wins
 * (it is a deliberate per-run override); otherwise the KB's saved
 * source_config scope applies; otherwise legacy maxPages; otherwise "all".
 *
 * @param {{ scope?: string, limit?: number|undefined, items?: Array }|null|undefined} requestScope
 * @param {{ scope?: string, limit?: number|undefined, items?: Array }|null} savedScope
 * @param {number|undefined} maxPages  Legacy API-page limit
 * @returns {{ scope: string, limit?: number|undefined, items?: Array }}
 */
export function resolveEffectiveScope(requestScope, savedScope, maxPages) {
  return requestScope || savedScope || (maxPages ? { scope: "limit", limit: maxPages } : { scope: "all" });
}
