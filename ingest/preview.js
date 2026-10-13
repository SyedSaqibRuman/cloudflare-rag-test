// --------------------------
// INGESTED DOCUMENT PREVIEW (pure helpers)
// Ingestion stores each document's chunks in object storage as
//   <r2Prefix>/<type>/<pageSlug>/chunk-N.json
// where payload = { id, url, title, content, metadata: { type, slug, chunkIndex } }.
// These helpers derive those keys from a registry key (e.g. "post-my-post")
// and assemble fetched chunks back into one readable document — no I/O here,
// the route owns storage access so tests can exercise this without R2.
// --------------------------

/** Mirror of pipeline.js slugify — kept in sync via unit test. */
export function slugify(text) {
  return String(text)
    .replace(/https?:\/\//, "")
    .replace(/[^\w]/g, "_")
    .toLowerCase();
}

/**
 * Object-storage prefix for one ingested document's chunk files.
 * Matches pipeline.js exactly: r2_key = `${r2Prefix}/${type}/${pageSlug}/chunk-${i}.json`
 * where pageSlug = slugify(`${type}-${slug}`) and registryKey = `${type}-${slug}`.
 * @param {string} r2Prefix  "kb/<kbKey>" (KB mode) or "site" (legacy mode)
 * @param {string} registryKey  registry key as stored by the pipeline, "type-slug"
 * @returns {string} list prefix, e.g. "kb/docs/post/my_post-thing" — ends just
 *   before "/chunk-N.json".
 */
export function documentChunkPrefix(r2Prefix, registryKey) {
  const idx = registryKey.indexOf("-");
  const type = idx > 0 ? registryKey.slice(0, idx) : "unknown";
  const pageSlug = slugify(registryKey);
  return `${r2Prefix}/${type}/${pageSlug}`;
}

/** Hard cap so a pathological document can't produce a multi-MB response. */
const MAX_PREVIEW_CHARS = 60000;
const MAX_CHUNKS = 200;

/**
 * Assemble fetched chunk payloads into one preview document.
 * Sorts by metadata.chunkIndex (fallback: the N in chunk-N.json via index order),
 * concatenates `content`, and reports the source title + url.
 * @param {Array<{content?: string, title?: string, url?: string, metadata?: object}>} chunks
 * @returns {{ title: string, url: string|null, content: string, chunkCount: number, truncated: boolean }}
 */
export function assembleDocumentPreview(chunks) {
  const sorted = [...(chunks || [])].sort(
    (a, b) => (a?.metadata?.chunkIndex ?? 0) - (b?.metadata?.chunkIndex ?? 0)
  );
  const first = sorted.find((c) => c?.title) || sorted[0] || {};
  let content = "";
  let used = 0;
  for (const chunk of sorted) {
    if (used >= MAX_CHUNKS) break;
    const text = chunk?.content ? String(chunk.content) : "";
    if (!text.trim()) continue; // whitespace-only chunks render as nothing
    const separator = content ? "\n\n" : "";
    if (content.length + separator.length + text.length > MAX_PREVIEW_CHARS) {
      content += separator + text.slice(0, Math.max(0, MAX_PREVIEW_CHARS - content.length));
      break;
    }
    content += separator + text;
    used += 1;
  }
  return {
    title: first.title || "Untitled",
    url: first.url || null,
    content,
    chunkCount: sorted.length,
    truncated: content.length >= MAX_PREVIEW_CHARS || used >= MAX_CHUNKS,
  };
}
