// --------------------------
// EMBEDDING FALLBACK (ADR-012)
// One source of truth for the ingest-side embedding contract: try the KB's own
// embedding adapter first; if it is missing OR THROWS (dead provider, 404,
// quota), fall back to the company's Cloudflare embeddings — exactly what the
// query path (query/kb-retrieval.js embedQuestion) does. Without this, an
// ingest can write vectors with a fallback model on retry while the query path
// refuses to fall back → empty retrieval for a fully ingested KB.
//
// Vector space consistency note: the fallback is safe because every vector
// adapter creates its index/collection with the resource template's dimensions
// (768 = CF bge-base-en-v1.5). A KB whose bound embedding model has a different
// dimension count would fail at upsert time (dimension guard), surfacing the
// real problem instead of silently mixing vector spaces.
//
// FALLBACK VISIBILITY: every fallback event is reported through an optional
// collector (opts.onFallback) so the ingestion can persist it on the KB row
// (last_ingestion_embedding_fallbacks / _error) and the KB detail page can
// surface "your embedding model is dead" without reading server logs.
// --------------------------

/**
 * @typedef {Object} EmbedFallbackStats
 * @property {number} fallbackBatches   batches that used the CF fallback
 * @property {number} adapterBatches    batches embedded by the KB's own adapter
 * @property {string|null} lastError    most recent adapter failure message
 */

/**
 * Create a fresh stats collector object (plain counters + last error).
 * @returns {EmbedFallbackStats}
 */
export function createEmbedFallbackStats() {
  return { fallbackBatches: 0, adapterBatches: 0, lastError: null };
}

/**
 * Embed `texts` with the KB adapter, falling back to company CF embeddings on
 * adapter failure. Never propagates the adapter's error.
 * @param {Object|null} embeddingAdapter  adapter with embed(text) (may be null)
 * @param {string[]} texts
 * @param {string} companyName
 * @param {Object} [opts]
 * @param {EmbedFallbackStats|null} [opts.stats]  counters to increment (shared across batches)
 * @param {(info: { reason: "error"|"missing"|"mismatch", texts: number, error?: string }) => void} [opts.onFallback]
 * @returns {Promise<number[]|null>} one vector per text (null on total failure)
 */
export async function embedBatchWithFallback(embeddingAdapter, texts, companyName, opts = {}) {
  const { stats, onFallback } = opts;
  const report = (reason, error) => {
    if (stats) stats.fallbackBatches += 1;
    if (stats && error) stats.lastError = String(error).slice(0, 300);
    onFallback?.({ reason, texts: texts.length, ...(error ? { error: String(error) } : {}) });
  };

  if (embeddingAdapter && typeof embeddingAdapter.embed === "function") {
    try {
      const embeddings = await Promise.all(texts.map((t) => embeddingAdapter.embed(t)));
      if (Array.isArray(embeddings) && embeddings.length === texts.length) {
        if (stats) stats.adapterBatches += 1;
        return embeddings;
      }
      const msg = `KB embedding adapter returned ${embeddings?.length}/${texts.length} vectors`;
      console.warn(`⚠️ ${msg} — falling back to company CF embeddings`);
      report("mismatch", msg);
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 140);
      console.warn(`⚠️ KB embedding adapter failed (${msg}) — falling back to company CF embeddings`);
      report("error", msg);
    }
  } else {
    // No adapter bound → company CF embeddings are the PRIMARY path (not a
    // degradation); nothing to count or report.
  }
  const { generateEmbeddings } = await import("../../services/cloudflare_embeddings.js");
  return generateEmbeddings(texts, companyName);
}
