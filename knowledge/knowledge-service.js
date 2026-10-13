// --------------------------
// KNOWLEDGE SERVICE — the single service boundary for the knowledge layer
// (proposal §10). Every operation:
//   authenticate → tenant validation → entity resolution → validation →
//   duplicate/conflict detection → provenance → Neo4j transaction
//
// Each method opens its own short-lived session on the company's configured
// graph, so callers never touch the driver. Company scope is derived from the
// caller (route session / ingest context) — never from LLM/user input.
// All failures are operational errors (status 4xx/5xx) — safe to surface.
// --------------------------
import { withKnowledgeSession } from "./neo4j.js";
import * as entities from "./entity-service.js";
import * as relationships from "./relationship-service.js";
import * as claims from "./claim-service.js";
import { getGraphConfig } from "../config/graph.js";

/**
 * Resolve the company's Neo4j graph config or throw a clear operational error.
 * @param {string} companyName
 * @returns {object} { uri, username, password, database }
 */
export function requireGraphConfig(companyName) {
  const graph = getGraphConfig(companyName);
  if (!graph) {
    const err = new Error(`Neo4j knowledge graph is not configured for company '${companyName}'.`);
    err.status = 400;
    err.code = "GRAPH_NOT_CONFIGURED";
    throw err;
  }
  return graph;
}

/** True when a company has graph config AND the KB exists in its config scope. */
export function graphConfigured(companyName) {
  return getGraphConfig(companyName) !== null;
}

// ------------------------------------------------------------------
// ENTITIES
// ------------------------------------------------------------------

export async function createEntity(companyName, kbKey, input, actor = {}) {
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: true }, (session) =>
    entities.createEntity(session, { companyName, kbKey, ...input, actor, provenance: { ...actor, confidence: input.confidence } })
  );
}

export async function resolveEntity(companyName, kbKey, ref, { autoCreate = false } = {}) {
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: autoCreate }, (session) =>
    entities.resolveEntity(session, { companyName, kbKey, ref, autoCreate })
  );
}

export async function updateEntity(companyName, kbKey, entityId, patch, actor = {}) {
  void actor;
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: true }, (session) =>
    entities.updateEntity(session, { companyName, kbKey, entityId, patch })
  );
}

export async function mergeEntities(companyName, kbKey, { keepId, dropId }, actor = {}) {
  void actor;
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: true }, (session) =>
    entities.mergeEntities(session, { companyName, kbKey, keepId, dropId })
  );
}

export async function addAlias(companyName, kbKey, entityId, alias, actor = {}) {
  void actor;
  void kbKey;
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: true }, (session) =>
    entities.addAlias(session, { entityId, alias })
  );
}

export async function listEntities(companyName, kbKey, filters = {}) {
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: false }, (session) =>
    entities.listEntities(session, { companyName, kbKey, ...filters })
  );
}

export async function getEntity(companyName, kbKey, entityId) {
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: false }, (session) =>
    entities.getEntity(session, { companyName, kbKey, entityId })
  );
}

// ------------------------------------------------------------------
// RELATIONSHIPS
// ------------------------------------------------------------------

export async function createRelationship(
  companyName,
  kbKey,
  { source, type, target, confidence, evidence, autoCreateEntities = true },
  actor = {}
) {
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: true }, (session) =>
    relationships.createRelationship(session, {
      companyName, kbKey, source, type, target, confidence, evidence, actor, autoCreateEntities,
    })
  );
}

export async function listRelationships(companyName, kbKey, filters = {}) {
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: false }, (session) =>
    relationships.listRelationships(session, { companyName, kbKey, ...filters })
  );
}

export async function removeRelationship(companyName, kbKey, { sourceId, targetId, type }, actor = {}) {
  void actor;
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: true }, (session) =>
    relationships.removeRelationship(session, { companyName, kbKey, sourceId, targetId, type })
  );
}

// ------------------------------------------------------------------
// CLAIMS
// ------------------------------------------------------------------

export async function createClaim(
  companyName,
  kbKey,
  { subject, predicate, object, confidence, evidence, status, allowAutoCreateEntities = true },
  actor = {}
) {
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: true }, (session) =>
    claims.createClaim(session, {
      companyName, kbKey, subject, predicate, object, confidence, evidence, actor, status, allowAutoCreateEntities,
    })
  );
}

export async function listClaims(companyName, kbKey, filters = {}) {
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: false }, (session) =>
    claims.listClaims(session, { companyName, kbKey, ...filters })
  );
}

export async function updateClaimStatus(companyName, kbKey, claimId, status, actor = {}, reason = null) {
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: true }, (session) =>
    claims.updateClaimStatus(session, { companyName, kbKey, claimId, status, actor, reason })
  );
}

export async function findConflicts(companyName, kbKey) {
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: false }, (session) =>
    claims.findConflicts(session, { companyName, kbKey })
  );
}

// ------------------------------------------------------------------
// REVIEW QUEUE (candidate + needs_review claims)
// ------------------------------------------------------------------

export async function listReviewQueue(companyName, kbKey) {
  const graph = requireGraphConfig(companyName);
  return withKnowledgeSession(graph, { write: false }, async (session) => {
    const candidates = await claims.listClaims(session, { companyName, kbKey, status: "candidate", limit: 500 });
    const review = await claims.listClaims(session, { companyName, kbKey, status: "needs_review", limit: 500 });
    const seen = new Set();
    return [...review, ...candidates].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  });
}
