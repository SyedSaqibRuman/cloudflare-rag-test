// --------------------------
// KB SERVICE
// Validation + transactional writes for tenant knowledge bases
// (knowledge_bases). Validation is pure and DB-free; all SQL lives in the
// repositories (D5). Writers throw errors carrying a `status` so the router
// can map them to 4xx. Mirrors catalog-service.js (F4 pattern).
// --------------------------
import {
  ModelRepository,
  ResourceRepository,
  KbRepository,
  AuditRepository,
} from "../repositories.js";

import { KB_SOURCE_TYPES } from "../../shared/catalog-enums.js";

export const KB_KEY_RE = /^[a-z0-9-]+$/;
export const SOURCE_TYPES = KB_SOURCE_TYPES;

// Backward-compatible HttpError — extends AppError so the error handler
// middleware recognizes it and the test suite's `instanceof HttpError` checks pass.
import { AppError } from "../../shared/errors.js";

export class HttpError extends AppError {
  constructor(status, message) {
    super(message, status);
  }
}

// ------------------------------------------------------------------
// KB VALIDATION (pure, DB-free)
// ------------------------------------------------------------------

function isPosInt(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * Validate KB input. Normalizes defaults for optional fields.
 * @param {Object} input
 * @returns {{ ok: boolean, value?: Object, errors?: Object<string,string> }}
 */
/**
 * Normalize webhook events to a JSON-safe format.
 * Accepts: comma-separated string, JSON array, or null.
 * Returns: JSON array string (for JSON column) or null.
 */
function normalizeWebhookEvents(value) {
  if (!value) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "string") {
    const events = value.split(",").map((e) => e.trim()).filter(Boolean);
    return events.length > 0 ? JSON.stringify(events) : null;
  }
  return null;
}

export function validateKbInput(input = {}) {
  const errors = {};

  if (!input.kbKey?.trim()) {
    errors.kbKey = "kbKey is required.";
  } else if (!KB_KEY_RE.test(input.kbKey)) {
    errors.kbKey = "kbKey must match /^[a-z0-9-]+$/.";
  } else if (input.kbKey.length < 3 || input.kbKey.length > 63) {
    errors.kbKey = "kbKey must be 3-63 characters.";
  }

  if (!input.kbName?.trim()) {
    errors.kbName = "kbName is required.";
  } else if (input.kbName.trim().length > 200) {
    errors.kbName = "kbName must be at most 200 characters.";
  }

  if (input.description !== undefined && input.description !== null && input.description.length > 65535) {
    errors.description = "description must be at most 65535 characters.";
  }

  for (const field of ["vectorResourceId", "storageResourceId", "graphResourceId", "embeddingModelId"]) {
    const v = input[field];
    if (v !== undefined && v !== null && v !== "" && !isPosInt(Number(v))) {
      errors[field] = `${field} must be a positive integer when set.`;
    }
  }

  const chunkSize = input.chunkSize ?? 512;
  if (input.chunkSize !== undefined && input.chunkSize !== null && !Number.isInteger(Number(input.chunkSize))) {
    errors.chunkSize = "chunkSize must be an integer.";
  } else if (Number(chunkSize) < 1 || Number(chunkSize) > 10000) {
    errors.chunkSize = "chunkSize must be 1-10000.";
  }

  const chunkOverlap = input.chunkOverlap ?? 50;
  if (input.chunkOverlap !== undefined && input.chunkOverlap !== null && !Number.isInteger(Number(input.chunkOverlap))) {
    errors.chunkOverlap = "chunkOverlap must be an integer.";
  } else if (Number(chunkOverlap) < 0 || Number(chunkOverlap) >= Number(chunkSize)) {
    errors.chunkOverlap = "chunkOverlap must be 0..(chunkSize-1).";
  }

  const retrievalTopK = input.retrievalTopK ?? 10;
  if (input.retrievalTopK !== undefined && input.retrievalTopK !== null && !Number.isInteger(Number(input.retrievalTopK))) {
    errors.retrievalTopK = "retrievalTopK must be an integer.";
  } else if (Number(retrievalTopK) < 1 || Number(retrievalTopK) > 100) {
    errors.retrievalTopK = "retrievalTopK must be 1-100.";
  }

  const threshold = input.retrievalScoreThreshold ?? 0.7;
  if (input.retrievalScoreThreshold !== undefined && input.retrievalScoreThreshold !== null) {
    const n = Number(threshold);
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) {
      errors.retrievalScoreThreshold = "retrievalScoreThreshold must be a number 0-1.";
    }
  }

  const sourceType = input.sourceType ?? "wordpress";
  if (sourceType && !SOURCE_TYPES.includes(sourceType)) {
    errors.sourceType = `sourceType must be one of: ${SOURCE_TYPES.join(", ")}.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      kbKey: input.kbKey.trim(),
      kbName: input.kbName.trim(),
      description: input.description?.trim() || null,
      vectorResourceId: input.vectorResourceId ? Number(input.vectorResourceId) : null,
      graphResourceId: input.graphResourceId ? Number(input.graphResourceId) : null,
      storageResourceId: input.storageResourceId ? Number(input.storageResourceId) : null,
      embeddingModelId: input.embeddingModelId ? Number(input.embeddingModelId) : null,
      chunkSize: Number(chunkSize),
      chunkOverlap: Number(chunkOverlap),
      retrievalTopK: Number(retrievalTopK),
      retrievalScoreThreshold: Number(threshold),
      enableGraphRag: Boolean(input.enableGraphRag),
      enableHybridSearch: input.enableHybridSearch !== false,
      sourceType: sourceType || "wordpress",
      sourceConfig: input.sourceConfig || null,
      webhookUrl: input.webhookUrl || null,
      webhookSecret: input.webhookSecret || null,
      webhookEvents: normalizeWebhookEvents(input.webhookEvents),
      isActive: input.isActive !== false,
    },
  };
}

// ------------------------------------------------------------------
// RESOURCE OWNERSHIP CHECK (shared by saveKb / updateKb)
// ------------------------------------------------------------------

/**
 * Verify a resource id resolves to a row owned by this company.
 * @returns {Promise<null | { error: string }>} null when every id checks out.
 */
async function checkResourceOwnership(companyId, value) {
  for (const [field, resourceId] of [
    ["vectorResourceId", value.vectorResourceId],
    ["storageResourceId", value.storageResourceId],
  ]) {
    if (!resourceId) continue;
    const resource = await ResourceRepository.findById(resourceId);
    if (!resource) return { error: `Unknown ${field} '${resourceId}'.` };
    if (Number(resource.company_id) !== Number(companyId)) {
      return { error: `${field} '${resourceId}' does not belong to this company.` };
    }
  }
  return null;
}

/** Snapshot the embedding provider key for the row (denormalized column). */
async function resolveEmbeddingProvider(embeddingModelId) {
  if (!embeddingModelId) return null;
  const model = await ModelRepository.findById(embeddingModelId);
  if (!model) throw new HttpError(404, `Unknown embeddingModelId '${embeddingModelId}'.`);
  return model.provider_key;
}

// ------------------------------------------------------------------
// KB WRITERS
// ------------------------------------------------------------------

/**
 * Create a KB for a company. Enforces the uk_company_kb uniqueness key and
 * the company's max_knowledge_bases capacity gate, then persists + audits.
 * @param {Object} company  CompanyRepository row (from requireGatewayCompany)
 * @param {Object} input
 * @param {Object} [actor]  actorType/actorId/actorIp for the audit trail
 * @returns {Promise<{kbId: number, kbKey: string}>}
 */
export async function saveKb(company, input, actor = {}) {
  const check = validateKbInput(input);
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const value = check.value;

  if (await KbRepository.findByKey(company.id, value.kbKey)) {
    throw new HttpError(409, `Knowledge base '${value.kbKey}' already exists.`);
  }

  const count = (await KbRepository.listByCompany(company.id)).length;
  if (company.max_knowledge_bases != null && count >= Number(company.max_knowledge_bases)) {
    throw new HttpError(409, `Company KB limit reached (${company.max_knowledge_bases}).`);
  }

  const ownershipError = await checkResourceOwnership(company.id, value);
  if (ownershipError) throw new HttpError(400, ownershipError.error);

  const embeddingModelProvider = await resolveEmbeddingProvider(value.embeddingModelId);

  const kbId = await KbRepository.create(company.id, { ...value, embeddingModelProvider });
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "kb.created",
    entityType: "kb",
    entityId: kbId,
    afterState: { kb_key: value.kbKey },
    reason: actor.reason ?? "admin action",
  });
  return { kbId, kbKey: value.kbKey };
}

/**
 * Update a KB (kbKey is not editable — it is the route identity). Re-validates
 * merged input, re-checks resource ownership, persists + audits before/after.
 * @param {Object} company
 * @param {string} kbKey
 * @param {Object} input
 * @param {Object} [actor]
 * @returns {Promise<{kbId: number, kbKey: string}>}
 */
export async function updateKb(company, kbKey, input, actor = {}) {
  const existing = await KbRepository.findByKey(company.id, kbKey);
  if (!existing) throw new HttpError(404, `Knowledge base '${kbKey}' not found.`);

  const merged = {
    ...existing,
    kbName: existing.kb_name,
    description: existing.description,
    vectorResourceId: existing.vector_resource_id,
    storageResourceId: existing.storage_resource_id,
    embeddingModelId: existing.embedding_model_id,
    chunkSize: existing.chunk_size,
    chunkOverlap: existing.chunk_overlap,
    retrievalTopK: existing.retrieval_top_k,
    retrievalScoreThreshold: Number(existing.retrieval_score_threshold),
    enableGraphRag: Boolean(existing.enable_graph_rag),
    enableHybridSearch: Boolean(existing.enable_hybrid_search),
    sourceType: existing.source_type || "wordpress",
    sourceConfig: existing.source_config ?? null,
    webhookUrl: existing.webhook_url ?? null,
    webhookSecret: existing.webhook_secret ?? null,
    webhookEvents: existing.webhook_events ?? null,
    isActive: Boolean(existing.is_active),
    ...input,
  };
  merged.kbKey = existing.kb_key; // never editable

  const check = validateKbInput(merged);
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const value = check.value;
  const ownershipError = await checkResourceOwnership(company.id, value);
  if (ownershipError) throw new HttpError(400, ownershipError.error);

  const embeddingModelProvider = await resolveEmbeddingProvider(value.embeddingModelId);

  await KbRepository.update(existing.id, { ...value, embeddingModelProvider });
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "kb.updated",
    entityType: "kb",
    entityId: existing.id,
    beforeState: { kb_key: existing.kb_key, status: existing.status },
    // Secrets are never persisted into audit logs — record presence only.
    afterState: {
      kb_key: value.kbKey,
      ...value,
      webhookSecret: value.webhookSecret ? "[set]" : null,
    },
    reason: actor.reason ?? "admin action",
  });
  return { kbId: existing.id, kbKey: existing.kb_key };
}

/**
 * Hard-delete a KB (D10) + audit.
 * @param {Object} company
 * @param {string} kbKey
 * @param {Object} [actor]
 * @returns {Promise<void>}
 */
export async function removeKb(company, kbKey, actor = {}) {
  const existing = await KbRepository.findByKey(company.id, kbKey);
  if (!existing) throw new HttpError(404, `Knowledge base '${kbKey}' not found.`);

  await KbRepository.remove(existing.id);
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "kb.deleted",
    entityType: "kb",
    entityId: existing.id,
    afterState: { kb_key: existing.kb_key },
    reason: actor.reason ?? "admin action",
  });
}

// Neo4j I/O caps — same budget as ingest/graph-extract.js so a stalled graph
// can never hang an admin request.
const GRAPH_DELETE_QUERY_TIMEOUT_MS = 20_000;
const GRAPH_DELETE_CLOSE_TIMEOUT_MS = 10_000;

/**
 * Resolve a promise or reject after `ms` — graph I/O must never hang a request.
 * The losing promise keeps settling in the background; its rejection is
 * handled by Promise.race, so no unhandled rejections.
 */
function withGraphTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Delete a KB's entities + relationships from the Neo4j knowledge graph.
 * Uses the SAME graph connection the ingest pipeline resolves
 * (getGraphConfig → company NEO4J_* config), so the button always cleans
 * exactly what ingestion wrote. Best-effort like the rest of the graph
 * pipeline: an unreachable graph returns `graphReachable: false` instead of
 * failing the request, and the KB row itself is never touched.
 *
 * @param {Object} company
 * @param {string} kbKey
 * @returns {Promise<{ configured: boolean, graphReachable: boolean, nodesDeleted: number, relationshipsDeleted: number }>}
 */
export async function clearKbGraph(company, kbKey) {
  // Resolve the same connection ingest uses.
  const { getGraphConfig } = await import("../../query/graph.js");
  const graph = getGraphConfig(company.company_key);
  if (!graph) {
    return { configured: false, graphReachable: false, nodesDeleted: 0, relationshipsDeleted: 0 };
  }

  let nodesDeleted = 0;
  let relationshipsDeleted = 0;
  let reachable = false;

  try {
    const neo4j = await import("neo4j-driver");
    const driver = neo4j.default.driver(
      graph.uri,
      neo4j.default.auth.basic(graph.username, graph.password),
      { connectionTimeout: 10_000, disableLosslessIntegers: true }
    );
    try {
      const session = driver.session({
        database: graph.database || "neo4j",
        defaultAccessMode: neo4j.default.session.WRITE,
      });
      try {
        // Count first (for the message + audit), then delete.
        const countRes = await withGraphTimeout(
          session.run(
            "MATCH (e:Entity) WHERE e.kb_key = $kbKey " +
            "OPTIONAL MATCH (e)-[r]-(neighbor) " +
            "RETURN count(DISTINCT e) AS nodes, count(DISTINCT r) AS rels",
            { kbKey }
          ),
          GRAPH_DELETE_QUERY_TIMEOUT_MS,
          "Neo4j graph count"
        );
        const row = countRes.records[0];
        nodesDeleted = row ? Number(row.get("nodes")) : 0;
        relationshipsDeleted = row ? Number(row.get("rels")) : 0;
        reachable = true;

        if (nodesDeleted > 0) {
          await withGraphTimeout(
            session.run(
              "MATCH (e:Entity) WHERE e.kb_key = $kbKey DETACH DELETE e",
              { kbKey }
            ),
            GRAPH_DELETE_QUERY_TIMEOUT_MS,
            "Neo4j graph delete"
          );
        }
      } finally {
        await withGraphTimeout(session.close(), GRAPH_DELETE_CLOSE_TIMEOUT_MS, "Neo4j session.close").catch(() => {});
      }
    } finally {
      await withGraphTimeout(driver.close(), GRAPH_DELETE_CLOSE_TIMEOUT_MS, "Neo4j driver.close").catch(() => {});
    }
  } catch {
    // Unreachable/timeout — report honestly; the KB row is untouched.
    reachable = false;
  }

  return { configured: true, graphReachable: reachable, nodesDeleted, relationshipsDeleted };
}
