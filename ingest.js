import "dotenv/config";

import { fetchPage, fetchPost } from "./services/wp.js";
import { saveContent } from "./utils/fileWriter.js";
import { logToFile } from "./utils/logger.js";
import { AbortError } from "./utils/helpers.js";

import { createBucket, uploadObject, getR2Bucket } from "./services/r2.js";
import { createVectorIndex, upsertVectors, getVectorIndex } from "./services/vectorize.js";

import { createRegistry } from "./ingest/registry.js";
import { runIngestion } from "./ingest/pipeline.js";

// --------------------------
// 🔹 Main — accepts { signal } from the job runner
// Composition root: reads the company's resource names, wires the live
// store/index adapters, and hands the pure pipeline to runIngestion.
// --------------------------
export async function main({ signal, companyName } = {}) {
  try {
    console.log("🔧 Initializing...");

    const bucketName = getR2Bucket(companyName);
    if (!bucketName) throw new Error("R2_BUCKET_NAME is not configured.");

    const vectorIndex = getVectorIndex(companyName);
    if (!vectorIndex) throw new Error("VECTOR_INDEX is not configured.");

    const store = {
      ensureBucket: () => createBucket(bucketName, companyName),
      saveContent: (name, markdown) => saveContent(name, markdown, "md"),
      uploadChunk: (r2Key, payload) => uploadObject(r2Key, payload, companyName),
    };

    const index = {
      ensureIndex: () => createVectorIndex(vectorIndex, companyName),
      upsert: (chunks) => upsertVectors(chunks, companyName),
    };

    await runIngestion({
      fetchPost,
      fetchPage,
      store,
      index,
      registry: createRegistry(companyName),
      signal,
      companyName,
    });

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
