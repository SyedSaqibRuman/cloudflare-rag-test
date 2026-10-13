// --------------------------
// KB HEALTH — stale-index detection
// Flags knowledge bases whose last successful ingest PREDATES the
// `created_on` of their bound Vectorize index. That combination means the
// index was deleted and recreated (or replaced) after the KB was last
// ingested — every vector that run wrote is gone, and because the registry
// still lists the documents as "processed", a re-ingest silently skips them
// (the exact failure mode of the 2026-09-29 max-test-index recreation).
//
// Pure module: the caller injects what Cloudflare knows (index createdOn per
// name) and what the DB knows (KB rows with last_ingestion_at). No I/O here —
// routes assemble the inputs; tests feed synthetic ones.
// --------------------------

/** Naive `YYYY-MM-DD HH:MM:SS[.f]` shape — no TZ marker at all. */
const NAIVE_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

/**
 * Normalize a date-ish value to epoch millis. MySQL DATETIME arrives as a
 * naive string ("2026-09-29 07:11:41") because the pool uses dateStrings —
 * that shape parses BROWSER-LOCAL per spec, so it is rewritten to explicit
 * UTC (the pool connects with timezone: "Z"); ISO strings and Date objects
 * carry their own offset and parse as themselves. Returns null for anything
 * unparseable.
 * @param {string|number|Date|null|undefined} value
 * @returns {number|null}
 */
export function toEpochMs(value) {
  if (value == null) return null;
  let d;
  if (value instanceof Date) d = value;
  else if (typeof value === "string" && NAIVE_DATETIME_RE.test(value.trim())) {
    d = new Date(`${value.trim().replace(" ", "T")}Z`);
  } else d = new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Evaluate one KB against its bound index's creation time.
 *
 * A KB is flagged (`staleIndex: true`) only when we have PROOF of loss:
 *   - the KB has ingested at least once (lastIngestionAt set), and
 *   - the index exists (indexCreatedOn set — a missing index is reported as
 *     `indexMissing`, a different problem than a wipe), and
 *   - the KB's last ingest predates the index's creation.
 *
 * Anything we can't prove stays healthy: no last ingest (never ran — "Ready"
 * state, nothing to lose), no index created_on (live CF list unavailable or
 * unknown index — the check must not guess), or an ingest AFTER the recreate.
 *
 * Shared-index subtlety: several KBs can bind one index by NAME — each KB is
 * compared against the same created_on for that name, so one recreation
 * flags every KB that ingested into the shared index before it.
 *
 * @param {{
 *   kbKey: string,
 *   vectorIndexName: string|null,
 *   lastIngestionAt: string|Date|null,
 *   documentsProcessed?: number|null,
 * }} kb
 * @param {Map<string, number|string>|Object|null} indexCreatedOnByName  index
 *   name → created_on (epoch ms, ISO string, or naive MySQL datetime string —
 *   anything toEpochMs accepts; one entry per live index name)
 * @returns {{
 *   kbKey: string,
 *   vectorIndexName: string|null,
 *   indexCreatedOn: string|null,
 *   lastIngestionAt: string|null,
 *   staleIndex: boolean,
 *   indexMissing: boolean,
 *   checkable: boolean,
 *   reason: string,
 * }}
 */
export function evaluateKbIndexHealth(kb, indexCreatedOnByName = null) {
  const byName =
    indexCreatedOnByName instanceof Map
      ? indexCreatedOnByName
      : indexCreatedOnByName
        ? new Map(Object.entries(indexCreatedOnByName))
        : null;

  const lastIngestionMs = toEpochMs(kb.lastIngestionAt);
  const name = kb.vectorIndexName || null;

  // Map values may be epoch ms, ISO strings, or naive MySQL datetime strings
  // (route assembles from CF `created_on` RFC3339 or pool dateStrings rows) —
  // normalize everything through toEpochMs before comparing.
  const createdOnMs = byName && name ? (byName.has(name) ? toEpochMs(byName.get(name)) : null) : null;
  const checkable = lastIngestionMs != null && createdOnMs != null;
  const staleIndex = checkable && lastIngestionMs < createdOnMs;
  const indexMissing = Boolean(name) && byName != null && byName.size > 0 && !byName.has(name);

  const createdOnIso = createdOnMs != null ? new Date(createdOnMs).toISOString() : null;
  let reason;
  if (staleIndex) {
    const docs = Number(kb.documentsProcessed);
    const loss = Number.isFinite(docs) && docs > 0 ? `Its ${docs} processed document(s) were likely lost` : "Vectors from that run are gone";
    reason =
      `Last ingest (${new Date(lastIngestionMs).toISOString()}) predates the recreation of vector index '${name}' ` +
      `(${createdOnIso}). ${loss} — re-ingest the KB (a full re-ingest is required; the registry still lists the old documents as processed).`;
  } else if (!lastIngestionMs) {
    reason = "No completed ingest yet — nothing to lose.";
  } else if (indexMissing) {
    // MUST precede the createdOnMs branch: a name absent from the live list
    // also has no created_on, and the missing-index reason is the useful one.
    reason = `Vector index '${name}' is not in the live account index list.`;
  } else if (createdOnMs == null) {
    reason = name
      ? `No created_on known for vector index '${name}' — cannot check.`
      : "No vector index bound — cannot check.";
  } else {
    reason = "Last ingest postdates the index creation — healthy.";
  }

  return {
    kbKey: kb.kbKey,
    vectorIndexName: name,
    indexCreatedOn: createdOnIso,
    lastIngestionAt: lastIngestionMs != null ? new Date(lastIngestionMs).toISOString() : null,
    staleIndex,
    indexMissing,
    checkable,
    reason,
  };
}

/**
 * Evaluate a whole company's KB list.
 * @param {Array<Object>} kbs            rows shaped like evaluateKbIndexHealth input
 * @param {Map<string, number>|Object|null} indexCreatedOnByName
 * @returns {{ healthy: Array<Object>, flagged: Array<Object>, uncheckable: Array<Object> }}
 */
export function assessKbIndexHealth(kbs, indexCreatedOnByName = null) {
  const results = (kbs || []).map((kb) => evaluateKbIndexHealth(kb, indexCreatedOnByName));
  return {
    healthy: results.filter((r) => !r.staleIndex && r.checkable),
    flagged: results.filter((r) => r.staleIndex),
    uncheckable: results.filter((r) => !r.checkable && !r.staleIndex),
  };
}
