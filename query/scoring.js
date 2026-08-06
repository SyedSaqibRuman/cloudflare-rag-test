// --------------------------
// SCORING & DEDUPLICATION
// --------------------------

/**
 * Keyword overlap score between a query and a text.
 * Returns a value between 0 and 3: each query term contributes up to 3
 * (its frequency in the text, capped), averaged over the query terms.
 */
export function keywordScore(query, text = "") {
  const qTerms = query.toLowerCase().split(/\W+/).filter(Boolean);
  const tTerms = text.toLowerCase().split(/\W+/).filter(Boolean);
  if (!qTerms.length || !tTerms.length) return 0;
  const freq = {};
  for (const t of tTerms) freq[t] = (freq[t] || 0) + 1;
  return qTerms.reduce((s, t) => s + Math.min(freq[t] || 0, 3), 0) / qTerms.length;
}

/**
 * Hybrid score combining vector similarity (85%) and keyword overlap (15%).
 * Clamped to [0, 1] so downstream thresholds (which assume a 0–1 score) hold
 * even when the keyword component pushes past 1.
 */
export function hybridScore(match, question) {
  const text = `${match.metadata?.title || ""} ${match.metadata?.preview || ""}`;
  const raw = 0.85 * (match.score || 0) + 0.15 * keywordScore(question, text);
  return Math.min(1, Math.max(0, raw));
}

/**
 * Deduplicate matches by post_id, url, r2_key, or id.
 * Keeps the match with the highest hybrid score.
 * Precondition: each match must carry .hybrid — retrieveContext sets it
 * before calling this (sort by hybrid first, then dedupe).
 */
export function dedupeMatches(matches) {
  const map = new Map();
  for (const m of matches) {
    const key = m.metadata?.post_id || m.metadata?.url || m.metadata?.r2_key || m.id;
    if (!key) continue;
    if (!map.has(key) || m.hybrid > map.get(key).hybrid) map.set(key, m);
  }
  return [...map.values()];
}
