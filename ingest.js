import "dotenv/config";

import { fetchPage, fetchPost } from "./services/wp.js";
import { saveContent } from "./utils/fileWriter.js";
import { logToFile } from "./utils/logger.js";
import { AbortError } from "./utils/helpers.js";

import { createBucket, uploadObject, getR2Bucket } from "./services/r2.js";
import { createVectorIndex, upsertVectors, getVectorIndex } from "./services/vectorize.js";

import { createRegistry } from "./ingest/registry.js";
import { runIngestion } from "./ingest/pipeline.js";

import {
  CompanyRepository,
  KbRepository,
  ResourceRepository,
  ModelRepository,
  AuditRepository,
} from "./mysql/repositories.js";
import { EMBEDDING_DIMENSIONS } from "./config/schema.js";

// --------------------------
// 🔹 Main — accepts { signal, companyName, kbKey } from the job runner
// Composition root: reads the company's resource names, wires the live
// store/index adapters, and hands the pure pipeline to runIngestion.
// With kbKey the KB row (gateway) overrides index/bucket/embedding/chunk
// settings (D11/F9); without it the legacy config-only path runs with the
// same behaviour as before.
// --------------------------
export async function main({ signal, companyName, kbKey } = {}) {
  try {
    console.log("🔧 Initializing...");

    let bucketName = getR2Bucket(companyName);
    let vectorIndex = getVectorIndex(companyName);

    let r2Prefix = "site";
    let chunkOptions = {};
    let registry = createRegistry(companyName);
    let embeddingModel = null; // @cf/ catalog override (F9); null → config model
    let kbId = null;
    let company = null;

    if (kbKey) {
      company = await CompanyRepository.findByKey(companyName);
      if (!company) throw new Error(`Company '${companyName}' not found.`);

      const kb = await KbRepository.findByKey(company.id, kbKey);
      if (!kb) throw new Error(`Knowledge base '${kbKey}' not found.`);
      kbId = kb.id;

      await KbRepository.setStatus(kb.id, "indexing");

      // Resource resolution (D11): KB resource row → company config fallback.
      // Resolves BEFORE the config guards so a pinned resource can supply a
      // bucket/index that the company config lacks.
      if (kb.vector_resource_id) {
        const res = await ResourceRepository.findById(kb.vector_resource_id);
        if (res?.external_resource_id) vectorIndex = res.external_resource_id;
      }
      if (kb.storage_resource_id) {
        const res = await ResourceRepository.findById(kb.storage_resource_id);
        if (res?.external_resource_id) bucketName = res.external_resource_id;
      }

      // Embedding model (F9): only catalog models that are also @cf/ runtime
      // models (present in EMBEDDING_DIMENSIONS) can override the company
      // config; OpenAI catalog entries fall back to the config model.
      if (kb.embedding_model_id) {
        const model = await ModelRepository.findById(kb.embedding_model_id);
        if (model && EMBEDDING_DIMENSIONS[model.model_key]) embeddingModel = model.model_key;
      }

      r2Prefix = `kb/${kbKey}`;
      chunkOptions = { size: kb.chunk_size || 512 };
      registry = createRegistry(companyName, kbKey, { chunkSize: chunkOptions.size });
    }

    const dims = embeddingModel ? EMBEDDING_DIMENSIONS[embeddingModel] : undefined;

    const store = {
      ensureBucket: () => createBucket(bucketName, companyName),
      saveContent: (name, markdown) => saveContent(name, markdown, "md"),
      uploadChunk: (r2Key, payload) => uploadObject(r2Key, payload, companyName, bucketName),
    };

    const index = {
      ensureIndex: () => createVectorIndex(vectorIndex, companyName, dims),
      upsert: (chunks) =>
        upsertVectors(chunks, companyName, {
          indexName: vectorIndex,
          embeddingModel: embeddingModel || undefined,
          dimensions: dims,
        }),
    };

    try {
      // Config guards live INSIDE the try so a missing bucket/index on a KB
      // run still flips the row to "error" + audits (D12).
      if (!bucketName) {
        throw new Error(kbKey ? `R2_BUCKET_NAME is not configured for KB '${kbKey}'.` : "R2_BUCKET_NAME is not configured.");
      }
      if (!vectorIndex) {
        throw new Error(kbKey ? `VECTOR_INDEX is not configured for KB '${kbKey}'.` : "VECTOR_INDEX is not configured.");
      }

      await runIngestion({
        fetchPost,
        fetchPage,
        store,
        index,
        registry,
        signal,
        companyName,
        r2Prefix,
        chunkOptions,
      });
      if (kbId) await KbRepository.setStatus(kbId, "active");
    } catch (error) {
      // KB status flip + audit on failure (D12); abort leaves the row as-is.
      if (kbId && !(error instanceof AbortError || error.name === "AbortError")) {
        await KbRepository.setStatus(kbId, "error");
        try {
          await AuditRepository.log({
            actorType: "system",
            companyId: company.id,
            action: "kb.ingest.failed",
            entityType: "kb",
            entityId: kbId,
            afterState: { error: error.message },
            reason: "ingest failure",
          });
        } catch {
          // audit is best-effort — never mask the real ingest error
        }
      }
      throw error;
    }

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
