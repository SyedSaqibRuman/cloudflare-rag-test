import { createHash } from "crypto";
import pLimit from "p-limit";

import { cleanContent } from "../utils/cleaner.js";
import { chunkMarkdown } from "../utils/chunker.js";
import { logToFile } from "../utils/logger.js";
import { AbortError, checkAbort, retry } from "../utils/helpers.js";

// --------------------------
// INGEST PIPELINE
// The pure run loop: fetch → transform → store → index, with the abort signal
// checked at every boundary. All I/O goes through injected adapters, so the
// whole behaviour is testable with in-memory fakes — no WordPress, R2, or
// Vectorize required.
//
// Adapter contract:
//   fetchFn(page, companyName)              → items[]  (WP REST, paginated)
//   store.ensureBucket()                    → make sure R2 bucket exists
//   store.saveContent(name, markdown)       → local content/ cache
//   store.uploadChunk(r2Key, payload)       → R2 chunk JSON
//   index.ensureIndex()                     → make sure Vectorize index exists
//   index.upsert(chunks)                    → embed + upsert (owns its batching)
//   registry.isStale(key, modifiedDate)     → skip unchanged content?
//   registry.record(key, modifiedDate)      → persist the registry entry
// --------------------------

const UPLOAD_CONCURRENCY = 5;
const MIN_CHUNK_LENGTH = 40;
const MAX_CHUNK_SIZE = 1000;

// --------------------------
// TRANSFORM STAGE (pure)
// --------------------------
function slugify(text) {
  return text
    .replace(/https?:\/\//, "")
    .replace(/[^\w]/g, "_")
    .toLowerCase();
}

function makeVectorId(r2Prefix, pageSlug, index) {
  const hash = createHash("sha256")
    .update(`${r2Prefix}/${pageSlug}`) // F14: r2Prefix keeps KB vector ids unique
    .digest("hex")
    .slice(0, 48);
  return `${hash}-${index}`;
}

function enforceChunkSize(chunks, max = MAX_CHUNK_SIZE) {
  const result = [];
  for (const chunk of chunks) {
    if (!chunk?.content) continue;
    if (chunk.content.length <= max) {
      result.push(chunk);
    } else {
      const parts = chunk.content.split("\n\n");
      let buffer = "";
      for (const part of parts) {
        if ((buffer + part).length > max) {
          if (buffer.trim()) result.push({ content: buffer.trim() });
          buffer = part;
        } else {
          buffer += "\n\n" + part;
        }
      }
      if (buffer.trim()) result.push({ content: buffer.trim() });
    }
  }
  return result;
}

export function transformItem(item, type, { r2Prefix = "site", chunkSize = MAX_CHUNK_SIZE } = {}) {
  const title = item?.title?.rendered || "Untitled";
  const slug = item?.slug || `unknown-${Date.now()}`;
  const registryKey = `${type}-${slug}`;
  const modifiedDate = item?.modified || "";

  const markdown = cleanContent(item.content.rendered);
  const rawChunks = chunkMarkdown(markdown);
  const sizedChunks = enforceChunkSize(rawChunks, chunkSize);

  const cleanChunks = sizedChunks
    .filter((c) => c?.content && c.content.trim().length >= MIN_CHUNK_LENGTH)
    .map((c) => ({ content: c.content.trim() }));

  const pageSlug = slugify(`${type}-${slug}`);

  const vectorChunks = cleanChunks.map((chunk, i) => {
    const r2_key = `${r2Prefix}/${type}/${pageSlug}/chunk-${i}.json`;
    return {
      id: makeVectorId(r2Prefix, pageSlug, i),
      text: chunk.content,
      url: item.link,
      title,
      r2_key,
      metadata: {
        type,
        slug,
        chunkIndex: i,
        // Web-source provenance (§25). Only set by the url/website adapter; the
        // citation URL above is always present, these make the origin explicit.
        ...(item._sourceType ? { sourceType: item._sourceType } : {}),
        ...(item._websiteUrl ? { websiteUrl: item._websiteUrl } : {}),
        ...(item._lastModified ? { lastModified: item._lastModified } : {}),
      },
    };
  });

  return {
    registryKey,
    modifiedDate,
    markdown,
    rawChunks: rawChunks.length,
    sizedChunks: sizedChunks.length,
    cleanChunks,
    vectorChunks,
  };
}

// --------------------------
// PIPELINE STAGES
// --------------------------

/**
 * Process a batch of pre-fetched items (shared logic between paginated
 * processContent and the selected-scope processItems). Extracted once
 * to eliminate the near-clone duplication.
 */
async function processItemBatch({ items, type, store, index, registry, signal, r2Prefix, chunkOptions, stats, reportProgress, graphAdapter = null }) {
  const uploadLimit = pLimit(UPLOAD_CONCURRENCY);
  // Graph sub-phase reporter — handed to the adapter so the ingest-progress
  // endpoint can show live extraction detail ("graph: extracting 3/10")
  // instead of a silent 20-minute "processing" stall.
  const graphProgress = graphAdapter
    ? (subPhase, detail) => reportProgress?.("processing", { subPhase, detail })
    : null;

  for (const item of items) {
    checkAbort(signal);

    const { registryKey, modifiedDate, markdown, rawChunks, sizedChunks, cleanChunks, vectorChunks } = transformItem(item, type, {
      r2Prefix,
      chunkSize: chunkOptions?.size ?? MAX_CHUNK_SIZE,
    });

    if (!registry.isStale(registryKey, modifiedDate)) {
      stats.skipped++;
      console.log(`⏭️ Skipping: ${registryKey}`);
      logToFile("process.log", `⏭️ Skipped: ${registryKey}`);
      continue;
    }

    try {
      logToFile("process.log", `🔄 Processing: ${registryKey}`);
      logToFile("process.log", `🧪 Chunks → raw:${rawChunks}, sized:${sizedChunks}`);

      if (!cleanChunks.length) {
        console.log(`⚠️ No valid chunks: ${registryKey}`);
        logToFile("process.log", `⚠️ No valid chunks: ${registryKey}`);
        continue;
      }

      checkAbort(signal);
      store.saveContent(registryKey, markdown);

      console.log(`📦 ${registryKey}: ${vectorChunks.length} clean chunks`);
      logToFile("process.log", `📦 ${registryKey}: ${vectorChunks.length} chunks ready`);

      // 🔹 Store stage: R2 upload
      await Promise.all(
        vectorChunks.map((chunk) =>
          uploadLimit(() =>
            retry(() => {
              checkAbort(signal);
              logToFile("upload.log", `⬆️ Uploading: ${chunk.r2_key}`);
              return store.uploadChunk(chunk.r2_key, {
                id: chunk.id,
                url: chunk.url,
                title: chunk.title,
                content: chunk.text,
                metadata: chunk.metadata,
              });
            }, 3, 500, signal)
          )
        )
      );

      logToFile("upload.log", `✅ Uploaded ${vectorChunks.length} chunks`);

      // 🔹 Index stage: embed + upsert
      logToFile("vector.log", `🧠 Vectorizing: ${vectorChunks.length} chunks`);
      await retry(() => index.upsert(vectorChunks), 3, 500, signal);
      logToFile("vector.log", `✅ Vectorized ${vectorChunks.length} chunks`);

      // 🔹 Graph extraction stage (optional, best-effort)
      if (graphAdapter) {
        try {
          checkAbort(signal);
          await retry(() => graphAdapter.extractFromChunks(vectorChunks, signal, graphProgress), 2, 1000, signal);
        } catch (err) {
          if (err.name === "AbortError") throw err;
          logToFile("error.log", `🕸️ Graph extraction failed for ${registryKey}: ${err.message}`);
          // Best-effort — never block ingestion
        }
      }

      checkAbort(signal);
      registry.record(registryKey, modifiedDate);

      stats.processed++;
      stats.chunks += vectorChunks.length;
      reportProgress?.("processing");
      console.log(`✅ Processed: ${registryKey}`);
      logToFile("process.log", `✅ Completed: ${registryKey}`);
    } catch (error) {
      if (error instanceof AbortError) throw error;
      console.error(`❌ Error processing ${registryKey}:`, error.message);
      logToFile("error.log", `❌ ${registryKey} → ${error.message}`);
    }
  }
}

export async function processContent({ fetchFn, type, store, index, registry, signal, companyName, r2Prefix, chunkOptions, maxPages, docLimit, stats = { processed: 0, skipped: 0, chunks: 0, discovered: 0 }, reportProgress, graphAdapter }) {
  let currentPage = 1;

  while (true) {
    // 🛑 Enforce API page limit (legacy compatibility)
    if (maxPages && currentPage > maxPages) {
      console.log(`🛑 Reached max pages limit (${maxPages}) for ${type}`);
      logToFile("process.log", `🛑 Stopped at max pages limit (${maxPages}) for ${type}`);
      break;
    }

    // 🛑 Enforce document-level limit (scope.limit)
    if (docLimit != null && stats.processed + stats.skipped >= docLimit) {
      console.log(`🛑 Reached document limit (${docLimit}) for ${type}`);
      logToFile("process.log", `🛑 Stopped at document limit (${docLimit}) for ${type}`);
      break;
    }

    checkAbort(signal);

    console.log(`Fetching ${type} page ${currentPage}...`);
    logToFile("process.log", `📄 Fetching ${type} page ${currentPage}`);

    let items = await fetchFn(currentPage, companyName);

    if (!items || items.length === 0) {
      console.log(`Done fetching all ${type}.`);
      logToFile("process.log", `✅ Completed fetching ${type}`);
      break;
    }

    // Track total discovered documents for the progress bar.
    stats.discovered += items.length;
    reportProgress?.("fetching");

    // Trim items to the remaining docLimit so we don't process more than
    // requested.  This is critical for URL/sitemap sources that return all
    // items on page 1 — without this, the limit check at the top of the
    // next loop iteration would be too late.
    if (docLimit != null) {
      const remaining = docLimit - stats.processed - stats.skipped;
      if (remaining <= 0) {
        logToFile("process.log", `🛑 Reached document limit (${docLimit}) — trimming batch`);
        break;
      }
      if (items.length > remaining) {
        logToFile("process.log", `✂️ Trimmed batch from ${items.length} to ${remaining} documents (limit: ${docLimit})`);
        items = items.slice(0, remaining);
      }
    }

    await processItemBatch({ items, type, store, index, registry, signal, r2Prefix, chunkOptions, stats, reportProgress, graphAdapter });

    currentPage++;
  }
}

/**
 * Full ingestion run: ensure bucket + index exist, then process content.
 * All I/O is adapter-mediated.
 *
 * Ingestion scope (optional):
 *   { scope: "all" }                                — paginate all posts + pages
 *   { scope: "limit", limit: 100 }                   — paginate up to N API pages
 *   { scope: "selected", items: [{type,id}, ...] }   — fetch only specific items
 *   { contentTypes: ["post","page"] }                — filter content types (default: both)
 *
 * When scope is omitted or { scope: "all" }, behavior is unchanged from
 * the pre-scope version (process all posts, then all pages).
 */
export async function runIngestion({
  fetchPost,
  fetchPage,
  fetchWpByIds,
  store,
  index,
  registry,
  signal,
  companyName,
  r2Prefix = "site",
  chunkOptions = {},
  scope = {},
  setProgress,
  graphAdapter = null,
}) {
  checkAbort(signal);
  await store.ensureBucket();

  checkAbort(signal);
  await index.ensureIndex();

  const contentTypes = scope.contentTypes || ["post", "page"];
  const mode = scope.scope || "all";

  // Ingestion statistics — tracked across all content types and returned
  // to the caller for audit logging and the KB status endpoint.
  const stats = { processed: 0, skipped: 0, chunks: 0, discovered: 0 };
  // reportProgress(phase, sub) — `sub` ({subPhase, detail}) is optional live
  // detail for the current phase; omitted by all existing callers.
  const reportProgress = (phase, sub) => setProgress?.({ ...stats, phase, ...(sub ? { sub } : {}) });
  reportProgress("fetching");

  console.log(`🚀 Starting ingestion for company: ${companyName || "(default)"} [mode=${mode}]`);

  // 🔹 Selected scope: fetch only the specific WP items by type + ID
  if (mode === "selected" && scope.items?.length) {
    for (const ct of contentTypes) {
      const ctPlural = ct === "post" ? "posts" : "pages";
      const typeItems = scope.items.filter((i) => i.type === ctPlural || i.type === ct);
      if (typeItems.length === 0) continue;

      const ids = typeItems.map((i) => i.id);
      stats.discovered += ids.length;
      console.log(`📋 Selected scope: fetching ${ids.length} ${ctPlural} by ID`);

      if (!fetchWpByIds) {
        throw new Error("fetchWpByIds adapter required for selected scope");
      }

      const items = await fetchWpByIds(ctPlural, ids, companyName);
      if (!items || items.length === 0) {
        console.log(`⚠️ No items found for ${ctPlural} IDs`);
        continue;
      }

      // Process all selected items as a single batch (no pagination)
      await processItemBatch({
        items,
        type: ctPlural,
        store,
        index,
        registry,
        signal,
        r2Prefix,
        chunkOptions,
        stats,
        reportProgress,
        graphAdapter,
      });
    }
  } else {
    // 🔹 All / Limit scope: paginate through posts and pages
    // scope.limit limits documents (not API pages) — ambiguous API-page
    // limits are a legacy compat mechanism only (maxPages).
    const docLimit = mode === "limit" ? (scope.limit || null) : null;

    if (contentTypes.includes("post")) {
      await processContent({
        fetchFn: fetchPost,
        type: "post",
        store,
        index,
        registry,
        signal,
        companyName,
        r2Prefix,
        chunkOptions,
        docLimit,
        stats,
        reportProgress,
        graphAdapter,
      });
    }

    if (contentTypes.includes("page")) {
      await processContent({
        fetchFn: fetchPage,
        type: "page",
        store,
        index,
        registry,
        signal,
        companyName,
        r2Prefix,
        chunkOptions,
        docLimit,
        stats,
        reportProgress,
        graphAdapter,
      });
    }
  }

  reportProgress("done");
  console.log(`✅ Ingestion complete — processed: ${stats.processed}, skipped: ${stats.skipped}, chunks: ${stats.chunks}`);
  return stats;
}


