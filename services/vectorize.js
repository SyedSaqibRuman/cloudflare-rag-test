import { generateEmbeddings } from "./cloudflare_embeddings.js";
import { logToFile } from "../utils/logger.js";
import { getCFClient } from "../client.js";
import { chunkArray } from "../utils/helpers.js";
import { resolveCreds, getConfig } from "../config/index.js";

// --------------------------
// 🔹 Embed usage logging (best-effort, non-blocking)
// --------------------------
async function logEmbedUsage(companyName, { inputTokens = 0, batchSize = 0 } = {}) {
  try {
    const { CompanyRepository, CredentialRepository, UsageRepository } = await import("../mysql/repositories.js");
    const company = await CompanyRepository.findByKey(companyName);
    if (!company) return;

    const creds = await CredentialRepository.listByCompany(company.id);
    const cfCred = creds?.find((c) => c.provider_key === "cloudflare" || c.provider_key === "cloudflare-ai");

    const { estimateCost, getPool } = await import("../mysql/services/cost.js");
    const pool = await getPool();
    let costUsd = 0;
    try {
      const costResult = await estimateCost({
        modelKey: getConfig(companyName).EMBEDDING_MODEL || "@cf/baai/bge-base-en-v1.5",
        inputTokens,
        outputTokens: 0,
        getPool,
      });
      costUsd = costResult.costUsd;
    } catch { /* pricing unavailable */ }

    await UsageRepository.log({
      companyId: company.id,
      credentialId: cfCred?.id || null,
      action: "ingest.embed",
      modelUsed: getConfig(companyName).EMBEDDING_MODEL || "@cf/baai/bge-base-en-v1.5",
      inputUnits: inputTokens || null,
      outputUnits: null,
      durationMs: null,
      costUsd: costUsd || null,
      responseStatus: 200,
      requestId: null,
    });
  } catch {
    // Best-effort — usage logging must never disrupt ingestion
  }
}

// --------------------------
// 🔹 Config
// --------------------------
const DIMENSIONS = 768;

const accountId = (companyName) => resolveCreds(companyName).CLOUDFLARE_ACCOUNT_ID;

/** Read VECTOR_INDEX from runtime config (hot-swappable). Falls back to env. */
export function getVectorIndex(companyName) {
  return getConfig(companyName).VECTOR_INDEX;
}

// --------------------------
// 🔹 Helpers
// --------------------------
function cleanString(str = "") {
  return str
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --------------------------
// 🔹 Index Management (via Cloudflare SDK)
// --------------------------
export async function listVectors(companyName) {
  try {
    const res = await getCFClient(companyName).vectorize.indexes.list({
      account_id: accountId(companyName),
    });
    return res?.result || [];
  } catch (error) {
    logToFile("error.log", `List vectors error: ${error.message}`);
    console.error("Error listing vectors:", error);
    return [];
  }
}

export async function findVector(name, companyName) {
  const vectors = await listVectors(companyName);
  return vectors.find((v) => v.name === name) || null;
}

export async function createVectorIndex(
  name,
  companyName,
  dimensions
) {
  // Use company's configured dimensions if not explicitly provided
  const dims = dimensions || (companyName ? getConfig(companyName).EMBEDDING_DIMENSIONS : DIMENSIONS) || DIMENSIONS;
  const existing = await findVector(name, companyName);
  if (existing) {
    console.log("Vector index already exists");
    return existing;
  }

  console.log("Creating Vector Index...");

  try {
    const res = await getCFClient(companyName).vectorize.indexes.create({
      account_id: accountId(companyName),
      name,
      config: {
        dimensions: dims,
        metric: "cosine",
      },
      metadataIndexes: [
        { propertyName: "r2_key", indexType: "string" },
        { propertyName: "title", indexType: "string" },
        { propertyName: "url", indexType: "string" },
        { propertyName: "type", indexType: "string" },
        { propertyName: "slug", indexType: "string" },
        { propertyName: "chunkIndex", indexType: "number" },
      ],
    });

    console.log("✅ Vector index created");
    return res.result;
  } catch (error) {
    logToFile("error.log", `Create index failed: ${error.message}`);
    throw new Error(`Create index failed: ${error.message}`);
  }
}

export async function deleteVectorIndex(name, companyName) {
  const existing = await findVector(name, companyName);
  if (!existing) return `${name} not found`;

  try {
    await getCFClient(companyName).vectorize.indexes.delete(name, {
      account_id: accountId(companyName),
    });

    console.log("🗑 Vector index deleted");
    return `${name} deleted`;
  } catch (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }
}

// --------------------------
// 🔹 Vector Upsert
// --------------------------
export async function upsertVectors(
  chunks = [],
  companyName,
  { indexName = getVectorIndex(companyName), embeddingModel = null, dimensions = null } = {}
) {
  if (!chunks.length) return;

  const batches = chunkArray(chunks, 100);

  for (const batch of batches) {
    try {
      logToFile("vector.log", `➡️ Processing batch of ${batch.length}`);

      // --------------------------
      // 🔹 Generate embeddings
      // --------------------------
      const texts = batch.map((c) => c.text);
      const embeddings = await generateEmbeddings(texts, companyName, embeddingModel);

      // --------------------------
      // 🔹 Validate embeddings
      // --------------------------
      if (!embeddings || embeddings.length !== batch.length) {
        throw new Error("Embedding mismatch");
      }

      const expectedDims =
        dimensions || (companyName ? getConfig(companyName).EMBEDDING_DIMENSIONS : null) || DIMENSIONS;
      if (embeddings.some((e) => !e || e.length !== expectedDims)) {
        throw new Error("Invalid embedding detected");
      }

      // --------------------------
      // 🔹 Build NDJSON
      // --------------------------
      const lines = batch.map((chunk, i) => {
        if (!chunk.id) throw new Error("Missing chunk.id");
        if (!chunk.r2_key) throw new Error(`Missing r2_key: ${chunk.id}`);
        if (!chunk.text) throw new Error(`Missing text: ${chunk.id}`);

        return JSON.stringify({
          id: chunk.id,
          values: embeddings[i],
          metadata: {
            r2_key: cleanString(chunk.r2_key),
            url: cleanString(chunk.url || ""),
            title: cleanString(chunk.title || "").slice(0, 200),
            preview: cleanString(chunk.text).slice(0, 200),
            type: cleanString(chunk.metadata?.type || ""),
            slug: cleanString(chunk.metadata?.slug || ""),
            chunkIndex: Number(chunk.metadata?.chunkIndex ?? i),
          },
        });
      });

      const ndjson = lines.join("\n") + "\n";

      // --------------------------
      // 🔹 Log usage for embedding batch (best-effort)
      // --------------------------
      logEmbedUsage(companyName, { inputTokens: texts.join(" ").length, batchSize: batch.length }).catch(() => {});

      // --------------------------
      // 🔹 Upsert via SDK
      // --------------------------
      const vectorIndex = indexName;
      if (!vectorIndex) throw new Error("VECTOR_INDEX is not configured.");

      await getCFClient(companyName).vectorize.indexes.upsert(vectorIndex, {
        account_id: accountId(companyName),
        "unparsable-behavior": "error",
        body: ndjson,
      });

      console.log(`✅ Upserted batch (${batch.length})`);
      logToFile("vector.log", `✅ Batch success (${batch.length})`);
    } catch (error) {
      console.error("❌ Batch failed:", error.message);

      logToFile("error.log", "================ UPSERT ERROR ================");
      logToFile("error.log", error.message);
      logToFile("error.log", JSON.stringify(batch[0] || {}));
      logToFile("error.log", "==============================================");

      throw error; // fail fast
    }
  }
}

// --------------------------
// 🔹 Vector Query
// --------------------------
export async function vectorQuery(vector, topK, companyName, { indexName = null } = {}) {
  try {
    const vectorIndex = indexName || getVectorIndex(companyName);
    if (!vectorIndex) throw new Error("VECTOR_INDEX is not configured.");

    const res = await getCFClient(companyName).vectorize.indexes.query(vectorIndex, {
      account_id: accountId(companyName),
      topK: topK,
      vector: vector,
      returnMetadata: "all",
      returnValues: true,
    });

    return res;
  } catch (e) {
    logToFile("error.log", `Vector Query Error: ${e.message || e}`);
    console.error("❌ Vector Query Error:", e.message || e);
    return { matches: [] }; // 🔹 Return empty matches instead of undefined
  }
}

// --------------------------
// 🔹 Get Vectors by ID
// --------------------------
export async function getVectorByID(ids, companyName) {
  try {
    const vectorIndex = getVectorIndex(companyName);
    if (!vectorIndex) throw new Error("VECTOR_INDEX is not configured.");

    const res = await getCFClient(companyName).vectorize.indexes.getByIds(vectorIndex, {
      account_id: accountId(companyName),
      ids,
    });

    return res;
  } catch (err) {
    console.error("Failed to fetch vectors:", err);
    logToFile("error.log", err);

    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// --------------------------
// 🔹 Vector Count (best-effort)
// --------------------------
/**
 * Vector count for an index, or null on any failure — KB /status treats it
 * as best-effort (F12). The caller passes the resolved index name (KB
 * resource override or config fallback).
 */
export async function countVectors(indexName, companyName) {
  if (!indexName) return null;
  try {
    const res = await getCFClient(companyName).vectorize.indexes.get(indexName, {
      account_id: accountId(companyName),
    });
    return res?.result?.vectorCount ?? null;
  } catch (err) {
    logToFile("error.log", `Vector count error: ${err.message}`);
    console.error("Vector count error:", err.message);
    return null;
  }
}
