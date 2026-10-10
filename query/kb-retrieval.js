// --------------------------
// KB-DRIVEN QUERY RETRIEVAL (ADR-012 Phase 2)
// When the resolved vector index is NOT the company's Cloudflare index, resolve
// the owning KB's bindings (same resolution as ingestion — ingest/resolve.js)
// and query the KB's own vector adapter (Pinecone/Qdrant/Weaviate) with the
// KB's own embedding adapter. Chunks still come from R2 under the company's
// credentials (vendor-payload content doctrine, ADR-012 §3).
//
// Best-effort by design: any failure (no MySQL, unresolvable binding, adapter
// error) returns null so the caller falls back to the CF fast-path with empty
// matches — never an ask error.
//
// Lazy-imports mysql/repositories.js so query/ tests keep loading with zero
// node_modules (same pattern as query/assistant.js).
// --------------------------

/**
 * Vector providers the CF path (services/vectorize.js) cannot search.
 * Includes openai: its hosted Vector Stores are text-search based (no manual
 * embeddings) — OpenAIVectorStoreAdapter ignores the embedded vector and
 * searches with the raw question via opts.queryText.
 */
const NON_CF_VECTOR_PROVIDERS = new Set(["pinecone", "qdrant", "weaviate", "openai"]);

export function isNonCfVectorProvider(providerKey) {
  return NON_CF_VECTOR_PROVIDERS.has(String(providerKey || ""));
}

/**
 * Resolve the KB (and its provider key) that owns `vectorIndexName` for a
 * company, by matching the KB's bound vector resource external id.
 * @returns {Promise<null | { kb: object, providerKey: string }>}
 */
/**
 * Does this KB own `vectorIndexName`? Matched against the BOUND RESOURCE's
 * external id first (the canonical wizard path: KB → vector_resource_id →
 * resource.external_resource_id), then the resource's config-stored index
 * name (Qdrant `collection_name` / Weaviate `class_name` / Pinecone
 * `index_name` — how register-existing templates name their target), then
 * the legacy direct external id on the KB row. Returns "resource" | "config"
 * | "kb" | null (match origin, for tests/logs).
 */
export function vectorIndexMatchesKb(kb, resource, vectorIndexName) {
  if (!vectorIndexName) return null;
  const name = String(vectorIndexName);
  const resourceExt = resource?.external_resource_id || "";
  if (resourceExt && resourceExt === name) return "resource";
  const cfg = resource?.config;
  const configName =
    (typeof cfg === "object" && cfg && !Array.isArray(cfg)
      ? cfg.collection_name || cfg.class_name || cfg.index_name || cfg.name
      : null) || null;
  if (configName && String(configName) === name) return "config";
  if ((kb?.vector_external_id || "") === name) return "kb";
  return null;
}

/**
 * The index/class name a KB's bound vector resource points at — same
 * resolution order the ingest resolver uses (external id → config key). Used
 * by the query path to hand the adapter the right collection when the KB has
 * no direct `vector_external_id`.
 */
export function kbVectorIndexName(kb, resource) {
  if (kb?.vector_external_id) return kb.vector_external_id;
  const cfg = resource?.config;
  if (typeof cfg === "object" && cfg && !Array.isArray(cfg)) {
    return cfg.collection_name || cfg.class_name || cfg.index_name || cfg.name || null;
  }
  return null;
}

async function findKbByVectorIndex(companyName, vectorIndexName) {
  if (!vectorIndexName) return null;
  try {
    const { CompanyRepository, KbRepository, ResourceRepository } = await import("../mysql/repositories.js");
    const company = await CompanyRepository.findByKey(companyName);
    if (!company) return null;
    // Prefer the KB whose BOUND RESOURCE owns this index name (the canonical
    // wizard path: KB → vector_resource_id → resource.external_resource_id),
    // then fall back to a legacy direct external-id binding on the KB row.
    const kbs = await KbRepository.listByCompany(company.id);
    for (const kb of kbs || []) {
      if (!kb.vector_resource_id) continue;
      const resource = await ResourceRepository.findById(kb.vector_resource_id);
      if (vectorIndexMatchesKb(kb, resource, vectorIndexName) === "resource" ||
          vectorIndexMatchesKb(kb, resource, vectorIndexName) === "config") {
        const providerKey = resource?.provider_key || (await resourceProviderKey(kb.vector_resource_id));
        return providerKey ? { kb, providerKey, resource } : null;
      }
    }
    for (const kb of kbs || []) {
      if (vectorIndexMatchesKb(kb, null, vectorIndexName) === "kb") {
        if (!kb.vector_resource_id) continue;
        const resource = await ResourceRepository.findById(kb.vector_resource_id);
        const providerKey = await resourceProviderKey(kb.vector_resource_id);
        return providerKey ? { kb, providerKey, resource } : null;
      }
    }
  } catch {
    return null; // best-effort
  }
  return null;
}

async function resourceProviderKey(resourceId) {
  try {
    const { ResourceRepository } = await import("../mysql/repositories.js");
    const resource = await ResourceRepository.findById(resourceId);
    return resource?.provider_key || null;
  } catch {
    return null;
  }
}

/**
 * Embed the question for a KB-bound query. Prefers the KB's own embedding
 * adapter; a KB without an embedding model binding falls back to the
 * company's Cloudflare embeddings — same parity as the ingest vector
 * adapters' upsert fallback. Best-effort: null on any failure (caller
 * falls back to the CF path).
 */
export async function embedQuestion(embedding, question, companyName) {
  try {
    if (embedding && typeof embedding.embed === "function") {
      return await embedding.embed(question);
    }
  } catch (err) {
    // The KB's embedding adapter is broken/unreachable (e.g. NVIDIA's
    // /v1/embeddings 404ing). Don't give up — the vectors in the store may
    // have been written with the same CF fallback the ingest vector adapters
    // use on embed failure. Fall through to the company CF embeddings so the
    // question is embedded with the SAME model the store was populated with.
    console.warn(`⚠️ KB embedding adapter failed (${err.message?.slice(0, 120)}) — falling back to company CF embeddings`);
  }
  try {
    const { generateEmbeddings } = await import("../services/cloudflare_embeddings.js");
    const vectors = await generateEmbeddings([question], companyName);
    return vectors?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the KB's ingestion adapters (same resolution as ingest) for the
 * query path. Returns null on any failure.
 */
async function resolveKbAdapters(kb, companyName) {
  try {
    const { CompanyRepository } = await import("../mysql/repositories.js");
    const company = await CompanyRepository.findByKey(companyName);
    if (!company) return null;
    const { resolveKbAdapters } = await import("../ingest/resolve.js");
    return await resolveKbAdapters(kb, company, companyName);
  } catch {
    return null;
  }
}

/**
 * Query-path retrieval against a non-CF vector store.
 *
 * Pipeline parity with query/retrieval.js retrieveContext: same scoring,
 * dedupe, and context assembly — only the vector query + embedding generation
 * are provider-swapped. `rerankMatches` still runs (CF RERANKING_MODEL — the
 * reranker is company-level infrastructure, not KB-level).
 *
 * @param {string} question
 * @param {string} companyName
 * @param {object} kbInfo  { kb, providerKey } from findKbByVectorIndex
 * @param {object} adapters { store, embedding, vector } from resolveKbAdapters
 * @param {number} vectorLimit
 * @returns {Promise<null | { context: string|null, matches: Array }>} null → caller falls back
 */
async function retrieveViaKbAdapters(question, companyName, kbInfo, adapters, vectorLimit) {
  const { hybridScore, dedupeMatches } = await import("./scoring.js");
  const { rerankMatches } = await import("./reranker.js");
  const { buildContext } = await import("./context.js");
  const { getChunk } = await import("../services/r2.js");

  const { kb, providerKey, resource } = kbInfo;
  const { embedding, vector } = adapters;
  if (!vector) return null;
  if (!isNonCfVectorProvider(providerKey)) return null;
  if (typeof vector.query !== "function") return null;

  console.log(`🔎 KB-driven retrieval: '${kb.kb_key || kb.name || "?"}' → ${providerKey}`);

  // OpenAI Vector Stores search by TEXT (no manual embeddings) — skip the
  // embedding step and hand the raw question to the adapter via opts.queryText.
  // Every other provider embeds the question and queries by vector.
  const isTextSearch = typeof vector.queryTextSearch === "function" || providerKey === "openai";
  let queryVector = null;
  if (!isTextSearch) {
    queryVector = await embedQuestion(embedding, question, companyName);
    if (!Array.isArray(queryVector) || !queryVector.length) return null;
  }  const res = await vector.query(queryVector, vectorLimit, {
    indexName: kbVectorIndexName(kb, resource),
    // Text-search providers (OpenAI) take the raw question here.
    queryText: question,
  });
  let matches = res?.matches || [];
  if (!matches.length) return { context: null, matches: [] };

  matches.sort((a, b) => b.score - a.score);
  const topScore = matches[0].score || 0;

  // Same thresholds as the CF path (SCORE_THRESHOLD / ABSOLUTE_MIN_SCORE).
  matches = matches.filter(
    (m) => (m.score || 0) >= topScore * 0.75 && (m.score || 0) >= 0.5
  );
  if (!matches.length) return { context: null, matches: [] };

  matches = matches.map((m) => ({ ...m, hybrid: hybridScore(m, question) }));
  matches.sort((a, b) => b.hybrid - a.hybrid);
  matches = dedupeMatches(matches);
  matches = await rerankMatches(matches.slice(0, 10), question, companyName);
  matches = matches.slice(0, 5);

  // Chunks always come from the company's R2 (content doctrine, ADR-012 §3).
  // KB-bound stores read from the KB's own bucket (kb.storage_external_id);
  // legacy/CF runs fall back to the company config bucket (getChunk default).
  const chunkBucket = kb?.storage_external_id || undefined;
  const chunks = await Promise.all(matches.map((m) => getChunk(m.metadata?.r2_key, companyName, chunkBucket)));
  return { context: buildContext(chunks), matches };
}

/**
 * Public entry: run the full retrieval for an ask. If the target index belongs
 * to a non-CF vector provider, retrieve through the KB's adapters; otherwise
 * return null (caller uses the CF fast-path unchanged).
 *
 * @param {string} question
 * @param {string} companyName
 * @param {string|null} vectorIndexName  resolved index (assistant KB → config)
 * @param {number} [vectorLimit=10]
 * @returns {Promise<null | { context: string|null, matches: Array }>}
 *   null = "not a non-CF target (or failed)" → caller falls back to CF.
 */
export async function retrieveNonCfContext(question, companyName, vectorIndexName, vectorLimit = 10) {
  if (!vectorIndexName || !companyName) return null;
  if (typeof vectorIndexName !== "string") return null;
  try {
    const kbInfo = await findKbByVectorIndex(companyName, vectorIndexName);
    if (!kbInfo || !isNonCfVectorProvider(kbInfo.providerKey)) return null;
    const adapters = await resolveKbAdapters(kbInfo.kb, companyName);
    if (!adapters) return null;
    return await retrieveViaKbAdapters(question, companyName, kbInfo, adapters, vectorLimit);
  } catch (err) {
    console.warn(`⚠️ Non-CF retrieval failed (falling back to CF path): ${err.message}`);
    return null;
  }
}
