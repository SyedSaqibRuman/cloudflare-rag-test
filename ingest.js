import "dotenv/config";
import { createHash } from "crypto";
import fs from "fs";
import pLimit from "p-limit";

import { fetchPage, fetchPost } from "./services/wp.js";
import { cleanContent } from "./utils/cleaner.js";
import { saveContent } from "./utils/fileWriter.js";
import { chunkMarkdown } from "./utils/chunker.js";
import { logToFile } from "./utils/logger.js";
import { chunkArray, AbortError, checkAbort, retry } from "./utils/helpers.js";

import { createBucket, uploadObject, getR2Bucket } from "./services/r2.js";
import { createVectorIndex, upsertVectors, getVectorIndex } from "./services/vectorize.js";

// --------------------------
// 🔹 Config
// --------------------------
const UPLOAD_CONCURRENCY = 5;
const MIN_CHUNK_LENGTH = 40;
const REGISTRY_BASE = "./processed";

// --------------------------
// 🔹 Registry
// --------------------------
function loadRegistry(companyName) {
  const filePath = `${REGISTRY_BASE}${companyName ? "-" + companyName : ""}.json`;
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }
  return {};
}

function saveRegistry(registry, companyName) {
  const filePath = `${REGISTRY_BASE}${companyName ? "-" + companyName : ""}.json`;
  fs.writeFileSync(filePath, JSON.stringify(registry, null, 2));
}

function isStale(registry, key, modifiedDate) {
  if (!registry[key]) return true;
  return registry[key] !== modifiedDate;
}

// --------------------------
// 🔹 Helpers
// --------------------------
function slugify(text) {
  return text
    .replace(/https?:\/\//, "")
    .replace(/[^\w]/g, "_")
    .toLowerCase();
}

function makeVectorId(pageSlug, index) {
  const hash = createHash("sha256")
    .update(pageSlug)
    .digest("hex")
    .slice(0, 48);
  return `${hash}-${index}`;
}

function enforceChunkSize(chunks, max = 1000) {
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
  }  return result;
}

// --------------------------
// 🔹 Core Processing
// signal is checked at every async boundary and loop iteration
// --------------------------
async function processContent(fetchFn, type, registry, signal, companyName) {
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

      const title = item?.title?.rendered || "Untitled";
      const slug = item?.slug || `unknown-${Date.now()}`;
      const registryKey = `${type}-${slug}`;
      const modifiedDate = item?.modified || "";

      if (!isStale(registry, registryKey, modifiedDate)) {
        console.log(`⏭️ Skipping: ${registryKey}`);
        logToFile("process.log", `⏭️ Skipped: ${registryKey}`);
        continue;
      }

      try {
        logToFile("process.log", `🔄 Processing: ${registryKey}`);

        const markdown = cleanContent(item.content.rendered);
        const rawChunks = chunkMarkdown(markdown);
        const sizedChunks = enforceChunkSize(rawChunks);

        logToFile("process.log", `🧪 Chunks → raw:${rawChunks.length}, sized:${sizedChunks.length}`);

        const cleanChunks = sizedChunks
          .filter(c => c?.content && c.content.trim().length >= MIN_CHUNK_LENGTH)
          .map(c => ({ content: c.content.trim() }));

        logToFile("process.log", `🧹 Clean chunks: ${cleanChunks.length}`);

        if (!cleanChunks.length) {
          console.log(`⚠️ No valid chunks: ${slug}`);
          logToFile("process.log", `⚠️ No valid chunks: ${slug}`);
          continue;
        }

        saveContent(`${type}-${slug}`, markdown, "md");

        const pageSlug = slugify(`${type}-${slug}`);

        const vectorChunks = cleanChunks.map((chunk, i) => {
          const r2_key = `site/${type}/${pageSlug}/chunk-${i}.json`;
          return {
            id: makeVectorId(pageSlug, i),
            text: chunk.content,
            url: item.link,
            title,
            r2_key,
            metadata: { type, slug, chunkIndex: i },
          };
        });

        console.log(`📦 ${slug}: ${vectorChunks.length} clean chunks`);
        logToFile("process.log", `📦 ${slug}: ${vectorChunks.length} chunks ready`);

        // ✋ Check before R2 upload batch
        checkAbort(signal);

        // --------------------------
        // 🔹 Upload to R2
        // --------------------------
        await Promise.all(
          vectorChunks.map((chunk) =>
            uploadLimit(() =>
              retry(() => {
                // ✋ Check inside each upload task
                checkAbort(signal);
                logToFile("upload.log", `⬆️ Uploading: ${chunk.r2_key}`);
                return uploadObject(chunk.r2_key, {
                  id: chunk.id,
                  url: chunk.url,
                  title: chunk.title,
                  content: chunk.text,
                  metadata: chunk.metadata,
                }, companyName);
              }, 3, 500, signal)
            )
          )
        );

        logToFile("upload.log", `✅ Uploaded ${vectorChunks.length} chunks`);

        // --------------------------
        // 🔹 Vectorize
        // --------------------------
        const batches = chunkArray(vectorChunks, 100);

        for (const batch of batches) {
          // ✋ Check before each vectorize batch
          checkAbort(signal);
          logToFile("vector.log", `🧠 Vectorizing batch: ${batch.length}`);
          await retry(() => upsertVectors(batch, companyName), 3, 500, signal);
        }

        logToFile("vector.log", `✅ Vectorized ${vectorChunks.length} chunks`);

        registry[registryKey] = modifiedDate;
        saveRegistry(registry, companyName);

        console.log(`✅ Processed: ${registryKey}`);
        logToFile("process.log", `✅ Completed: ${registryKey}`);

      } catch (error) {
        // Re-throw AbortError so it exits processContent and main()
        if (error instanceof AbortError) throw error;

        console.error(`❌ Error processing ${slug}:`, error.message);
        logToFile("error.log", `❌ ${slug} → ${error.message}`);
      }
    }

    currentPage++;
  }
}

// --------------------------
// 🔹 Main — accepts { signal } from the job runner
// --------------------------
export async function main({ signal, companyName } = {}) {
  try {
    console.log("🔧 Initializing...");

    const bucketName = getR2Bucket(companyName);
    if (!bucketName) throw new Error("R2_BUCKET_NAME is not configured.");

    const vectorIndex = getVectorIndex(companyName);
    if (!vectorIndex) throw new Error("VECTOR_INDEX is not configured.");

    checkAbort(signal);
    await createBucket(bucketName);

    checkAbort(signal);
    await createVectorIndex(vectorIndex, companyName);

    const registry = loadRegistry(companyName);

    console.log(`🚀 Starting ingestion for company: ${companyName || "(default)"}`);

    await processContent(fetchPost, "post", registry, signal, companyName);
    await processContent(fetchPage, "page", registry, signal, companyName);

    console.log("✅ Ingestion complete");

  } catch (error) {
    if (error instanceof AbortError || error.name === "AbortError") {
      console.log("🛑 Ingestion stopped by user.");
      logToFile("process.log", "🛑 Ingestion aborted by user");
      return; // clean exit — do not rethrow
    }
    console.error("Fatal error:", error);
    throw error;
  }
}

// main();
