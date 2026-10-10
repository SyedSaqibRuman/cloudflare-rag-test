// --------------------------
// INGEST SCOPE RESOLUTION
// The Ingest button must respect a KB's SAVED scope (source_config.scope /
// docLimit / selectedPages) unless the user explicitly picks a different one
// via the scope popover. The wizard stores scope at creation time; a blanket
// { type: "all" } default ignored it and made a "limit 3" KB ingest its whole
// site (2026-09-29, maxicert-web-auto: saved docLimit 3, ingested 288 docs).
//
// Pure ESM — node --test friendly, no React imports.
// --------------------------

/** Parse JSON or return null. */
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Default ingest scope for a KB row, derived from its saved source_config:
 *   { scope: "limit", docLimit: N }   → { type: "limit", limit: N }
 *   { scope: "selected", … }          → { type: "selected" }
 *   { scope: "all" } / no config      → { type: "all" }
 *
 * Legacy KBs without source_config default to "all" (their historical
 * behavior); a limit scope with an unusable docLimit falls back to 100 so a
 * corrupt value can never sweep a whole site in.
 *
 * @param {Object|null} kb  KB row (source_config may be an object or a JSON string)
 * @returns {{ type: "all"|"limit"|"selected", limit: number|null }}
 */
export function defaultIngestScope(kb) {
  if (!kb) return { type: "all", limit: null };
  const raw = typeof kb.source_config === "string" ? safeParse(kb.source_config) : kb.source_config;
  if (!raw || typeof raw !== "object") return { type: "all", limit: null };
  if (raw.scope === "limit") {
    const limit = Number(raw.docLimit);
    return { type: "limit", limit: Number.isFinite(limit) && limit > 0 ? limit : 100 };
  }
  if (raw.scope === "selected") return { type: "selected", limit: null };
  return { type: "all", limit: null };
}
