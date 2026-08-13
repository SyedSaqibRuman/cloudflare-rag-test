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
      metadata: { type, slug, chunkIndex: i },
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
export async function processContent({ fetchFn, type, store, index, registry, signal, companyName, r2Prefix, chunkOptions }) {
  const uploadLimit = pLimit(UPLOAD_CONCURRENCY);
  let currentPage = 1;

  while (true) {
    // ✋ Check before each page fetch
    checkAbort(signal);

    console.log(`Fetching ${type} page ${currentPage}...`);
    logToFile("process.log", `📄 Fetching ${type} page ${currentPage}`);

    const items = await fetchFn(currentPage, companyName);

    if (!items || items.length === 0) {
      console.log(`Done fetching all ${type}.`);
      logToFile("process.log", `✅ Completed fetching ${type}`);
      break;
    }

    for (const item of items) {
      // ✋ Check before each item
      checkAbort(signal);

      const { registryKey, modifiedDate, markdown, rawChunks, sizedChunks, cleanChunks, vectorChunks } = transformItem(item, type, {
        r2Prefix,
        chunkSize: chunkOptions?.size ?? MAX_CHUNK_SIZE,
      });

      if (!registry.isStale(registryKey, modifiedDate)) {
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

        // ✋ Check before writing content + R2 upload batch
        checkAbort(signal);

        store.saveContent(registryKey, markdown);

        console.log(`📦 ${registryKey}: ${vectorChunks.length} clean chunks`);
        logToFile("process.log", `📦 ${registryKey}: ${vectorChunks.length} chunks ready`);

        // --------------------------
        // 🔹 Store stage: R2 upload
        // --------------------------
        await Promise.all(
          vectorChunks.map((chunk) =>
            uploadLimit(() =>
              retry(() => {
                // ✋ Check inside each upload task
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

        // --------------------------
        // 🔹 Index stage: embed + upsert (vectorize owns internal batching)
        // --------------------------
        logToFile("vector.log", `🧠 Vectorizing: ${vectorChunks.length} chunks`);
        await retry(() => index.upsert(vectorChunks), 3, 500, signal);
        logToFile("vector.log", `✅ Vectorized ${vectorChunks.length} chunks`);

        // ✋ Check before recording progress
        checkAbort(signal);
        registry.record(registryKey, modifiedDate);

        console.log(`✅ Processed: ${registryKey}`);
        logToFile("process.log", `✅ Completed: ${registryKey}`);
      } catch (error) {
        // Re-throw AbortError so it exits processContent and the run.
        if (error instanceof AbortError) throw error;

        console.error(`❌ Error processing ${registryKey}:`, error.message);
        logToFile("error.log", `❌ ${registryKey} → ${error.message}`);
      }
    }

    currentPage++;
  }
}

/**
 * Full ingestion run: ensure bucket + index exist, then process posts and
 * pages against one registry. All I/O is adapter-mediated.
 */
export async function runIngestion({ fetchPost, fetchPage, store, index, registry, signal, companyName, r2Prefix = "site", chunkOptions = {} }) {
  checkAbort(signal);
  await store.ensureBucket();

  checkAbort(signal);
  await index.ensureIndex();

  console.log(`🚀 Starting ingestion for company: ${companyName || "(default)"}`);

  await processContent({ fetchFn: fetchPost, type: "post", store, index, registry, signal, companyName, r2Prefix, chunkOptions });
  await processContent({ fetchFn: fetchPage, type: "page", store, index, registry, signal, companyName, r2Prefix, chunkOptions });

  console.log("✅ Ingestion complete");
}
