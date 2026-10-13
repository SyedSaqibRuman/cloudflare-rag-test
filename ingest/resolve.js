// --------------------------
// KB ADAPTER RESOLVER
// Resolves a Knowledge Base into concrete pipeline adapters (storage, embedding,
// vector). This is the single entry point that replaces the scattered resolution
// logic previously in ingest.js — all infrastructure is resolved from the KB's
// resource bindings, never from hardcoded providers.
//
// Adapter contract (consumed by ingest/pipeline.js):
//   store.ensureBucket()                 → ensure storage exists
//   store.saveContent(name, markdown)    → optional local cache (no-op OK)
//   store.uploadChunk(r2Key, payload)    → store chunk JSON
//   index.ensureIndex()                  → ensure vector index exists
//   index.upsert(chunks)                 → embed + upsert (owns its batching)
// --------------------------

import { createStoreAdapter } from "../mysql/adapters/storage/factory.js";
import { createEmbeddingAdapter } from "../mysql/adapters/embedding/factory.js";
import { createVectorAdapter } from "../mysql/adapters/vector/factory.js";
import {
  resolveResourceConnection,
  resolveEmbeddingModel,
} from "../mysql/services/provider-connection-resolver.js";
import { decryptCredential } from "../mysql/services/credential-service.js";
import { CredentialRepository, ResourceRepository } from "../mysql/repositories.js";

// ------------------------------------------------------------------
// PUBLIC: resolveKbAdapters
// ------------------------------------------------------------------

/**
 * Resolve a Knowledge Base into concrete storage, embedding, and vector adapters.
 *
 * @param {Object} kb         KB row from KbRepository (includes resource/model join columns)
 * @param {Object} company    Company row from CompanyRepository
 * @param {string} companyName  Company key (for config fallbacks)
 * @param {Object} [opts]
 * @param {Object|null} [opts.embedStats]  EmbedFallbackStats collector handed to the
 *   vector adapter so KB-bound embedding failures are counted during ingestion
 *   (persisted on the KB row and shown on the KB detail page).
 * @returns {Promise<{ store: Object|null, embedding: Object|null, vector: Object|null }>}
 */
export async function resolveKbAdapters(kb, company, companyName, opts = {}) {
  const result = { store: null, embedding: null, vector: null };

  // 🔹 1. Storage adapter (KB's storage_resource_id → provider credential → adapter)
  if (kb.storage_resource_id) {
    try {
      const resourceRow = await ResourceRepository.findById(kb.storage_resource_id);
      if (!resourceRow) throw new Error(`Resource #${kb.storage_resource_id} not found`);
      const conn = await resolveResourceConnection(resourceRow);
      const normCreds = normalizeCredential(conn.credentials);
      result.store = createStoreAdapter(conn.providerKey, {
        ...normCreds,
        companyName,
        bucketName:
          normCreds.bucketName || kb.storage_external_id || null,
      });
    } catch (err) {
      console.warn(`⚠️ Storage adapter resolution failed: ${err.message}`);
      // Surface the reason to callers (see the vector branch below).
      result.storeError = err.message;
    }
  }

  // 🔹 2. Embedding adapter (KB's embedding_model_id → model → provider → credential → adapter)
  if (kb.embedding_model_id) {
    try {
      const modelInfo = await resolveEmbeddingModel(kb.embedding_model_id);

      // Find the company's credential for this embedding provider
      const cred = await findCredentialForProvider(
        company.id,
        modelInfo.provider.id
      );
      const decryptedCred = cred
        ? normalizeCredential(decryptCredential(cred.encrypted_credentials))
        : {};

      result.embedding = createEmbeddingAdapter(
        modelInfo.providerKey,
        decryptedCred,
        modelInfo.modelKey
      );
    } catch (err) {
      console.warn(`⚠️ Embedding adapter resolution failed: ${err.message}`);
    }
  }

  // 🔹 3. Vector adapter (KB's vector_resource_id → provider credential → adapter)
  //    The vector adapter receives the embedding adapter so it can delegate
  //    embedding generation without hardcoding a specific AI provider.
  if (kb.vector_resource_id) {
    try {
      const resourceRow = await ResourceRepository.findById(kb.vector_resource_id);
      if (!resourceRow) throw new Error(`Resource #${kb.vector_resource_id} not found`);
      const conn = await resolveResourceConnection(resourceRow);
      const normCreds = normalizeCredential(conn.credentials);
      // The resource template's config (host, dimension, metric, distance,
      // namespace…) flows into the adapter too — e.g. Pinecone serverless
      // indexes carry a per-index data-plane host in config.host that the
      // credential alone cannot provide. Resource config wins over nothing
      // (it fills gaps); explicit credential fields still take precedence.
      const resourceConfig =
        typeof resourceRow.config === "string"
          ? safeParseConfig(resourceRow.config)
          : resourceRow.config || {};
      const dims = Number(resourceConfig.dimension) || Number(resourceConfig.dimensions) || null;
      // Index/class name resolution order: explicit credential field → the KB
      // row's direct external id → the resource template's config key. Qdrant
      // templates store `collection_name`, Weaviate `class_name`, Pinecone
      // `index_name` (migration 027/004 config schemas) — without this fallback
      // the adapter gets an empty name and provider APIs reject the request
      // (e.g. Qdrant PUT /collections/ → 400 bad request).
      const configIndexName =
        resourceConfig.collection_name ||
        resourceConfig.class_name ||
        resourceConfig.index_name ||
        resourceConfig.name ||
        null;
      const vectorIndexName =
        normCreds.vectorIndexName || kb.vector_external_id || configIndexName;
      // Fail fast on a nameless vector resource: the provider APIs reject the
      // empty name much later (CF: 400 vectorize.index.invalid_name, Qdrant:
      // PUT /collections/ 400) with a cryptic message — surface the real
      // cause instead and skip the wasted ingestion work entirely.
      if (!vectorIndexName) {
        throw new Error(
          `vector index name is not set on resource '${resourceRow.resource_name}' — edit the resource on the provider page and set its index name (external id or config.index_name)`
        );
      }
      result.vector = createVectorAdapter(
        conn.providerKey,
        {
          ...resourceConfig,
          ...normCreds,
          vectorIndexName,
          embeddingModel: kb.model_key || null,
          ...(dims ? { dimensions: dims } : {}),
          companyName,
          ...(opts.embedStats ? { embedStats: opts.embedStats } : {}),
        },
        { embeddingAdapter: result.embedding }
      );
    } catch (err) {
      console.warn(`⚠️ Vector adapter resolution failed: ${err.message}`);
      // Surface the reason to callers — ingest.js includes it in the
      // KB_VECTOR_NOT_CONFIGURED guard so the KB row records WHY the run
      // exited instead of a generic "not configured".
      result.vectorError = err.message;
    }
  }

  return result;
}

// ------------------------------------------------------------------
// PUBLIC: resolveLegacyAdapters
// ------------------------------------------------------------------

/**
 * Create default Cloudflare adapters for the legacy (no-KB) ingestion path.
 * Uses company-level config values — kept for backward compatibility.
 *
 * @param {string} companyName
 * @param {Object} config  Company config (from getConfig)
 * @returns {{ store: Object, embedding: Object, vector: Object }}
 */
export function resolveLegacyAdapters(companyName, config) {
  const bucketName = config.R2_BUCKET_NAME;
  const vectorIndex = config.VECTOR_INDEX;
  const embeddingModel = config.EMBEDDING_MODEL || "@cf/baai/bge-base-en-v1.5";
  const dims = config.EMBEDDING_DIMENSIONS;

  const store = createStoreAdapter("cloudflare", {
    accountId: config.CLOUDFLARE_ACCOUNT_ID || "",
    apiToken: config.CLOUDFLARE_API_TOKEN || "",
    bucketName,
    companyName,
  });

  const embedding = createEmbeddingAdapter("cloudflare", {
    accountId: config.CLOUDFLARE_ACCOUNT_ID || "",
    apiToken: config.CLOUDFLARE_API_TOKEN || "",
  }, embeddingModel);

  const vector = createVectorAdapter(
    "cloudflare",
    {
      accountId: config.CLOUDFLARE_ACCOUNT_ID || "",
      apiToken: config.CLOUDFLARE_API_TOKEN || "",
      vectorIndexName: vectorIndex,
      embeddingModel,
      companyName,
      dimensions: dims,
    },
    { embeddingAdapter: embedding }
  );

  return { store, embedding, vector };
}

// ------------------------------------------------------------------
// HELPER: normalizeCredential
// ------------------------------------------------------------------

/**
 * Normalize snake_case credential fields to camelCase.
 * Gateway credentials store fields as `api_token`, `account_id`, etc.
 * but adapters expect `apiToken`, `accountId`, etc.
 * @param {Object} cred
 * @returns {Object}
 */
export function normalizeCredential(cred) {
  if (!cred || typeof cred !== "object") return cred || {};
  // snake_case (auth-schema field_name) → camelCase (adapter constructor keys).
  // Non-CF vector adapters (Pinecone/Qdrant/Weaviate) read apiKey/host — the
  // wizard stores api_key/host — remap here so neither side has to know.
  const map = {
    api_token: "apiToken",
    account_id: "accountId",
    access_key_id: "accessKeyId",
    secret_access_key: "secretAccessKey",
    api_key: "apiKey",
  };
  const out = {};
  for (const [k, v] of Object.entries(cred)) {
    out[map[k] || k] = v;
  }
  return out;
}

/** Parse a resource config JSON string; returns {} on parse failure. */
function safeParseConfig(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------
// HELPER: findCredentialForProvider
// ------------------------------------------------------------------

/**
 * Find the first active credential for a specific provider within a company.
 * Used by the embedding adapter resolver when the model is bound to a provider
 * but the KB doesn't have a direct resource credential for embedding.
 *
 * @param {number} companyId
 * @param {number} providerId
 * @returns {Promise<Object|null>}
 */
async function findCredentialForProvider(companyId, providerId) {
  const creds = await CredentialRepository.listByCompany(companyId, {
    includeStored: true,
    includeInactive: false,
  });
  return creds.find((c) => c.provider_id === providerId) || null;
}
