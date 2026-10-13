// --------------------------
// CLAIM SERVICE — first-class claim lifecycle (proposal §9, §14, §24).
// A claim is a subject → predicate → object triple with confidence,
// evidence (document/chunk provenance) and a lifecycle status:
//   candidate → accepted | rejected | conflicting | needs_review | deprecated
// Claims are stored as (:Claim) nodes wired to their (:Entity) endpoints via
// fixed internal edge types (SUBJECT_OF / OBJECT_OF) so GraphRAG can traverse
// claim → entity and cite evidence back to chunks.
// --------------------------
import { ENTITY_LABEL, normalizeRelationshipType, SINGULAR_RELATIONSHIP_TYPES } from "./graph-schema.js";
import { buildProvenance, evidenceRefs } from "./provenance.js";
import { runQuery } from "./neo4j.js";
import { resolveEntity } from "./entity-service.js";
import {
  validateClaim,
  assessClaimLifecycle,
  resolveWriteStatus,
  CLAIM_STATUSES,
} from "./validation.js";

export const CLAIM_LABEL = "Claim";

function claimId(companyName, kbKey, subjectId, predicate, objectId) {
  const scope = `${companyName}:${kbKey}:${subjectId}:${predicate}:${objectId}`;
  let hash = 0xcbf29ce484222325n;
  for (const ch of scope) {
    hash ^= BigInt(ch.charCodeAt(0));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `claim_${hash.toString(36)}`;
}

/**
 * Create a claim. Flow: validate → resolve/auto-create entities → derive
 * status from confidence + actor policy → conflict/duplicate detection →
 * persist the claim node wired to its entities.
 *
 * @param {object} session
 * @param {object} opts
 * @param {string} opts.companyName
 * @param {string} opts.kbKey
 * @param {object|string} opts.subject    { id } | { name } | string
 * @param {string} opts.predicate         allowlisted relationship type
 * @param {object|string} opts.object
 * @param {number} [opts.confidence]
 * @param {Array}  [opts.evidence]
 * @param {object} [opts.actor]           { type, id }
 * @param {string} [opts.status]          explicit lifecycle status
 * @param {boolean} [opts.allowAutoCreateEntities]
 * @returns {Promise<{ id: string, status: string, commit: boolean, reason,
 *   duplicateOf: object|null, conflictsWith: object|null, subjectId, predicate, objectId }>}
 */
export async function createClaim(
  session,
  { companyName, kbKey, subject, predicate, object, confidence = 0.8, evidence = [], actor = {}, status = null, allowAutoCreateEntities = false }
) {
  const check = validateClaim({
    subject,
    predicate,
    object,
    confidence,
    evidence,
    status,
    allowAutoCreateEntities,
  });
  if (!check.ok) {
    const err = new Error(`Claim validation failed: ${JSON.stringify(check.errors)}`);
    err.status = 400;
    err.code = "CLAIM_VALIDATION";
    throw err;
  }
  const value = check.value;

  const subjectEntity = await resolveEntity(session, {
    companyName, kbKey, ref: value.subject, autoCreate: value.allowAutoCreateEntities,
  });
  const objectEntity = await resolveEntity(session, {
    companyName, kbKey, ref: value.object, autoCreate: value.allowAutoCreateEntities,
  });
  if (subjectEntity.id === objectEntity.id) {
    const err = new Error("A claim cannot have the same subject and object.");
    err.status = 400;
    throw err;
  }

  const predicateType = normalizeRelationshipType(value.predicate);
  const id = claimId(companyName, kbKey, subjectEntity.id, predicateType, objectEntity.id);

  // Existing claim with the identical triple?
  const existingRes = await runQuery(
    session,
    `MATCH (c:${CLAIM_LABEL} {id: $id})
     RETURN c.status AS status, c.confidence AS confidence, c.created_at AS createdAt`,
    { id }
  );
  if (existingRes.records[0]) {
    const row = existingRes.records[0];
    return {
      id,
      status: row.get("status"),
      commit: false,
      created: false,
      reason: "Identical claim already exists.",
      duplicateOf: { status: row.get("status"), confidence: row.get("confidence"), createdAt: row.get("createdAt") },
      conflictsWith: null,
      subjectId: subjectEntity.id,
      predicate: predicateType,
      objectId: objectEntity.id,
    };
  }

  // Conflict check against accepted/candidate claims with same
  // subject+predicate. Only SINGLE-VALUED predicates (SUPERSEDES, OWNED_BY)
  // can genuinely conflict on a different object — for multi-valued ones
  // (USES, PROVIDES, …) a different object is a separate parallel fact, so
  // the only "same statement" case is the identical triple already caught by
  // the claim-id lookup above.
  let existingClaims = [];
  let lifecycle;
  if (SINGULAR_RELATIONSHIP_TYPES.has(predicateType)) {
    const existingClaimsRes = await runQuery(
      session,
      `MATCH (s:${ENTITY_LABEL} {id: $subjectId})-[:SUBJECT_OF]->(c:${CLAIM_LABEL})-[:OBJECT_OF]->(o:${ENTITY_LABEL})
       WHERE c.kb_key = $kb AND c.predicate = $predicate AND o.id <> $objectId
         AND c.status IN ['accepted', 'candidate', 'conflicting']
       RETURN c.id AS id, c.status AS status, c.confidence AS confidence,
              o.id AS objectId, o.name AS objectName, c.created_at AS createdAt
       ORDER BY c.created_at DESC LIMIT 5`,
      { subjectId: subjectEntity.id, kb: kbKey, predicate: predicateType, objectId: objectEntity.id }
    );
    existingClaims = existingClaimsRes.records.map((r) => ({
      id: String(r.get("id")),
      status: r.get("status"),
      confidence: r.get("confidence") ?? null,
      objectId: String(r.get("objectId")),
      objectName: r.get("objectName"),
      createdAt: r.get("createdAt") ?? null,
    }));
    lifecycle = assessClaimLifecycle(
      existingClaims[0] || null,
      { subjectId: subjectEntity.id, predicate: predicateType, objectId: objectEntity.id, confidence: value.confidence }
    );
  } else {
    lifecycle = assessClaimLifecycle(null, {
      subjectId: subjectEntity.id,
      predicate: predicateType,
      objectId: objectEntity.id,
      confidence: value.confidence,
    });
  }

  const policy = resolveWriteStatus({
    confidence: value.confidence,
    requestedStatus: status,
    actor,
  });
  let claimStatus;
  if (lifecycle.status === "duplicate") {
    claimStatus = existingClaims[0].status;
  } else if (lifecycle.status === "conflicting") {
    claimStatus = "conflicting";
  } else {
    claimStatus = lifecycle.status === "rejected" ? "rejected" : policy.status;
  }

  const prov = buildProvenance({ companyName, kbKey, actor, confidence: value.confidence, evidence });
  const refs = evidenceRefs(prov.evidence);
  const createdBy = prov.created_by || null;

  // If this claim conflicts, demote the previously accepted claim to
  // "conflicting" too — never silently overwrite one with the other.
  if (lifecycle.conflictsWith?.demoteExisting && existingClaims[0]?.status === "accepted") {
    await runQuery(
      session,
      `MATCH (c:${CLAIM_LABEL} {id: $existingId}) SET c.status = 'conflicting', c.updated_at = datetime()`,
      { existingId: existingClaims[0].id }
    );
  }

  await runQuery(
    session,
    `MATCH (s:${ENTITY_LABEL} {id: $subjectId}), (o:${ENTITY_LABEL} {id: $objectId})
     MERGE (c:${CLAIM_LABEL} {id: $id})
     ON CREATE SET
       c.company = $company,
       c.kb_key = $kb,
       c.predicate = $predicate,
       c.status = $status,
       c.confidence = $confidence,
       c.evidence = $evidence,
       c.created_by = $createdBy,
       c.created_at = datetime()
     SET c.updated_at = datetime()
     WITH c, s, o
     MERGE (s)-[:SUBJECT_OF]->(c)
     MERGE (c)-[:OBJECT_OF]->(o)`,
    {
      id,
      company: companyName,
      kb: kbKey,
      predicate: predicateType,
      status: claimStatus,
      confidence: prov.confidence,
      evidence: refs,
      createdBy,
      subjectId: subjectEntity.id,
      objectId: objectEntity.id,
    }
  );

  return {
    id,
    status: claimStatus,
    commit: claimStatus === "accepted",
    created: true,
    reason: lifecycle.reason || policy.reason,
    duplicateOf: null,
    conflictsWith: lifecycle.conflictsWith ? { id: lifecycle.conflictsWith.id, ...existingClaims[0] } : null,
    subjectId: subjectEntity.id,
    predicate: predicateType,
    objectId: objectEntity.id,
  };
}

/** List claims for a KB with optional status/predicate/entity filters. */
export async function listClaims(session, { companyName, kbKey, status = null, entityId = null, limit = 200 }) {
  const params = { company: companyName, kb: kbKey, limit: Math.min(Math.max(Number(limit) || 200, 1), 500) };
  const where = ["c.company = $company", "c.kb_key = $kb"];
  if (status) {
    if (!CLAIM_STATUSES.has(status)) throw Object.assign(new Error(`Invalid claim status '${status}'.`), { status: 400 });
    where.push("c.status = $status");
    params.status = status;
  }
  if (entityId && String(entityId).trim()) {
    where.push("(s.id = $entityId OR o.id = $entityId)");
    params.entityId = String(entityId).trim();
  }
  const res = await runQuery(
    session,
    `MATCH (s:${ENTITY_LABEL})-[:SUBJECT_OF]->(c:${CLAIM_LABEL})-[:OBJECT_OF]->(o:${ENTITY_LABEL})
     WHERE ${where.join(" AND ")}
     RETURN DISTINCT c.id AS id, c.status AS status, c.predicate AS predicate,
            c.confidence AS confidence, c.evidence AS evidence,
            s.id AS subjectId, s.name AS subjectName,
            o.id AS objectId, o.name AS objectName,
            c.created_by AS createdBy, c.created_at AS createdAt, c.updated_at AS updatedAt
     ORDER BY c.updated_at DESC LIMIT toInteger($limit)`,
    params
  );
  return res.records.map((r) => ({
    id: String(r.get("id")),
    status: r.get("status"),
    predicate: r.get("predicate"),
    confidence: r.get("confidence") ?? null,
    evidence: r.get("evidence") || [],
    subjectId: String(r.get("subjectId")),
    subjectName: r.get("subjectName"),
    objectId: String(r.get("objectId")),
    objectName: r.get("objectName"),
    createdBy: r.get("createdBy"),
    createdAt: r.get("createdAt") ?? null,
    updatedAt: r.get("updatedAt") ?? null,
  }));
}

/** Fetch a single claim with its endpoints + evidence. */
export async function getClaim(session, { companyName, kbKey, claimId }) {
  const res = await runQuery(
    session,
    `MATCH (s:${ENTITY_LABEL})-[:SUBJECT_OF]->(c:${CLAIM_LABEL} {id: $id})-[:OBJECT_OF]->(o:${ENTITY_LABEL})
     WHERE c.company = $company AND c.kb_key = $kb
     RETURN c.id AS id, c.status AS status, c.predicate AS predicate,
            c.confidence AS confidence, c.evidence AS evidence,
            c.created_by AS createdBy, c.created_at AS createdAt, c.updated_at AS updatedAt,
            s.id AS subjectId, s.name AS subjectName,
            o.id AS objectId, o.name AS objectName`,
    { id: claimId, company: companyName, kb: kbKey }
  );
  if (!res.records[0]) throw Object.assign(new Error("Claim not found."), { status: 404 });
  const r = res.records[0];
  return {
    id: String(r.get("id")),
    status: r.get("status"),
    predicate: r.get("predicate"),
    confidence: r.get("confidence") ?? null,
    evidence: r.get("evidence") || [],
    subjectId: String(r.get("subjectId")),
    subjectName: r.get("subjectName"),
    objectId: String(r.get("objectId")),
    objectName: r.get("objectName"),
    createdBy: r.get("createdBy"),
    createdAt: r.get("createdAt") ?? null,
    updatedAt: r.get("updatedAt") ?? null,
  };
}

/** Transition a claim's lifecycle status (accept / reject / deprecate / review). */
export async function updateClaimStatus(session, { companyName, kbKey, claimId, status, actor = {}, reason = null }) {
  if (!CLAIM_STATUSES.has(status)) throw Object.assign(new Error(`Invalid claim status '${status}'.`), { status: 400 });
  const res = await runQuery(
    session,
    `MATCH (c:${CLAIM_LABEL} {id: $id})
     WHERE c.company = $company AND c.kb_key = $kb
     SET c.status = $status,
         c.updated_at = datetime(),
         c.reviewed_by = $actor,
         c.review_reason = $reason
     RETURN c.id AS id, c.status AS status`,
    { id: claimId, company: companyName, kb: kbKey, status, actor: actor?.id || actor?.type || null, reason: reason || null }
  );
  if (!res.records[0]) throw Object.assign(new Error("Claim not found."), { status: 404 });
  return { id: claimId, status: res.records[0].get("status") };
}

/** Find all claims flagged conflicting (or a pair that contradicts). */
export async function findConflicts(session, { companyName, kbKey }) {
  const res = await runQuery(
    session,
    `MATCH (s:${ENTITY_LABEL})-[:SUBJECT_OF]->(c:${CLAIM_LABEL})-[:OBJECT_OF]->(o:${ENTITY_LABEL})
     WHERE c.company = $company AND c.kb_key = $kb AND c.status IN ['conflicting', 'needs_review']
     RETURN c.id AS id, c.status AS status, c.predicate AS predicate, c.confidence AS confidence,
            s.id AS subjectId, s.name AS subjectName,
            o.id AS objectId, o.name AS objectName,
            c.evidence AS evidence, c.updated_at AS updatedAt
     ORDER BY c.updated_at DESC`,
    { company: companyName, kb: kbKey }
  );
  return res.records.map((r) => ({
    id: String(r.get("id")),
    status: r.get("status"),
    predicate: r.get("predicate"),
    confidence: r.get("confidence") ?? null,
    subjectId: String(r.get("subjectId")),
    subjectName: r.get("subjectName"),
    objectId: String(r.get("objectId")),
    objectName: r.get("objectName"),
    evidence: r.get("evidence") || [],
    updatedAt: r.get("updatedAt") ?? null,
  }));
}
