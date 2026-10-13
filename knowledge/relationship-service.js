// --------------------------
// RELATIONSHIP SERVICE — typed relationship writes between canonical
// entities. Every edge goes through: entity resolution → type allowlist →
// duplicate detection → conflict detection → provenance → Neo4j write.
// The type is always a member of the RELATIONSHIP_TYPES allowlist so no
// user/LLM string is ever interpolated into Cypher.
// --------------------------
import { ENTITY_LABEL, normalizeRelationshipType, SINGULAR_RELATIONSHIP_TYPES } from "./graph-schema.js";
import { buildProvenance, normalizeEvidence } from "./provenance.js";
import { runQuery } from "./neo4j.js";
import { resolveEntity } from "./entity-service.js";

/**
 * Create (or idempotently match) a typed relationship between two canonical
 * entities. Endpoints may be entity ids or names (auto-created when the
 * caller opts in). Returns the outcome incl. conflict/duplicate assessment.
 *
 * @param {object} session
 * @param {object} opts
 * @param {string} opts.companyName
 * @param {string} opts.kbKey
 * @param {object} opts.source  { id } | { name } | string
 * @param {string} opts.type    allowlisted relationship type
 * @param {object} opts.target
 * @param {number} [opts.confidence]
 * @param {Array}  [opts.evidence]
 * @param {object} [opts.actor] { type, id }
 * @param {boolean} [opts.autoCreateEntities]
 * @returns {Promise<{ status: string, reason: string, sourceId, targetId, type,
 *   created: boolean, existing?: object, conflicts?: object[] }>}
 */
export async function createRelationship(
  session,
  { companyName, kbKey, source, type, target, confidence = 0.8, evidence = [], actor = {}, autoCreateEntities = false }
) {
  const relType = normalizeRelationshipType(type);
  if (!relType) throw Object.assign(new Error("Invalid relationship type."), { status: 400, code: "INVALID_RELATIONSHIP_TYPE" });

  const sourceEntity = await resolveEntity(session, { companyName, kbKey, ref: source, autoCreate: autoCreateEntities });
  const targetEntity = await resolveEntity(session, { companyName, kbKey, ref: target, autoCreate: autoCreateEntities });

  if (sourceEntity.id === targetEntity.id) {
    throw Object.assign(new Error("A relationship cannot connect an entity to itself."), { status: 400 });
  }

  const prov = buildProvenance({ companyName, kbKey, actor, confidence, evidence });
  const evidenceEntries = normalizeEvidence(evidence);
  const evidenceRefs = evidenceEntries.map((e) => {
    if (e.documentId && e.chunkId) return `${e.documentId}/${e.chunkId}`;
    if (e.documentId) return e.documentId;
    return e.title || e.chunkId || "manual";
  });

  // Duplicate detection: same endpoints + same type already present?
  const existingRes = await runQuery(
    session,
    `MATCH (a:${ENTITY_LABEL} {id: $fromId})-[r:${relType} {kb_key: $kb}]->(b:${ENTITY_LABEL} {id: $toId})
     RETURN r.confidence AS confidence, r.chunk_id AS chunkId, r.created_at AS createdAt`,
    { fromId: sourceEntity.id, toId: targetEntity.id, kb: kbKey }
  );
  if (existingRes.records[0]) {
    const row = existingRes.records[0];
    const existing = {
      confidence: row.get("confidence") ?? null,
      chunkId: row.get("chunkId") ?? null,
      createdAt: row.get("createdAt") ?? null,
    };
    // Keep the higher-confidence write; supplement provenance.
    await runQuery(
      session,
      `MATCH (a:${ENTITY_LABEL} {id: $fromId})-[r:${relType} {kb_key: $kb}]->(b:${ENTITY_LABEL} {id: $toId})
       SET r.confidence = CASE WHEN coalesce(r.confidence, 0) < $confidence THEN $confidence ELSE r.confidence END,
           r.evidence = [e IN coalesce(r.evidence, []) WHERE NOT e IN $newEvidence] + $newEvidence,
           r.updated_at = datetime()`,
      {
        fromId: sourceEntity.id,
        toId: targetEntity.id,
        kb: kbKey,
        confidence: prov.confidence,
        newEvidence: evidenceRefs,
      }
    );
    return {
      status: "duplicate",
      reason: "Relationship already exists — confidence/evidence merged.",
      sourceId: sourceEntity.id,
      targetId: targetEntity.id,
      type: relType,
      created: false,
      existing,
    };
  }

  // Conflict detection: does the same source already claim this type toward a
  // DIFFERENT target? Only meaningful for SINGLE-VALUED predicates
  // (SUPERSEDES/OWNED_BY) — for multi-valued ones ("A USES B" vs "A USES C")
  // both edges legitimately coexist, so the check is skipped entirely.
  // Flag, but still allow both to exist — triage is the claim service's job.
  const conflicts = [];
  if (SINGULAR_RELATIONSHIP_TYPES.has(relType)) {
    const conflictRes = await runQuery(
      session,
      `MATCH (a:${ENTITY_LABEL} {id: $fromId})-[r:${relType} {kb_key: $kb}]->(other:${ENTITY_LABEL})
       WHERE other.id <> $toId
       RETURN other.id AS otherId, other.name AS otherName, r.confidence AS confidence, r.created_at AS createdAt`,
      { fromId: sourceEntity.id, kb: kbKey, toId: targetEntity.id }
    );
    for (const r of conflictRes.records) {
      conflicts.push({
        entityId: String(r.get("otherId")),
        entityName: r.get("otherName"),
        confidence: r.get("confidence") ?? null,
        createdAt: r.get("createdAt") ?? null,
      });
    }
  }

  await runQuery(
    session,
    `MATCH (a:${ENTITY_LABEL} {id: $fromId}), (b:${ENTITY_LABEL} {id: $toId})
     MERGE (a)-[r:${relType} {kb_key: $kb}]->(b)
     ON CREATE SET
       r.company = $company,
       r.extracted_by = $extractedBy,
       r.created_by = $createdBy,
       r.confidence = $confidence,
       r.evidence = $evidence,
       r.source_title = $sourceTitle,
       r.source_url = $sourceUrl,
       r.created_at = datetime()
     SET r.updated_at = datetime()
     RETURN r`,
    {
      fromId: sourceEntity.id,
      toId: targetEntity.id,
      kb: kbKey,
      company: companyName,
      extractedBy: prov.extracted_by,
      createdBy: prov.created_by || null,
      confidence: prov.confidence,
      evidence: evidenceRefs,
      sourceTitle: evidenceEntries[0]?.title || null,
      sourceUrl: evidenceEntries[0]?.url || null,
    }
  );

  const created = true;
  return {
    status: conflicts.length ? "conflicting" : "created",
    reason: conflicts.length ? "Relationship created; conflicting edge(s) detected on the same subject." : "Relationship created.",
    sourceId: sourceEntity.id,
    targetId: targetEntity.id,
    type: relType,
    created,
    conflicts,
  };
}

/** List typed relationships in a KB (optionally filtered by entity + type). */
export async function listRelationships(session, { companyName, kbKey, entityId = null, type = null, limit = 200 }) {
  const params = {
    company: companyName,
    kb: kbKey,
    limit: Math.min(Math.max(Number(limit) || 200, 1), 500),
  };
  const where = ["a.company = $company", "a.kb_key = $kb"];
  if (entityId) {
    where.push("(a.id = $entityId OR b.id = $entityId)");
    params.entityId = entityId;
  }
  let typeClause = "";
  if (type) {
    const relType = normalizeRelationshipType(type);
    if (!relType) throw Object.assign(new Error("Invalid relationship type filter."), { status: 400 });
    typeClause = `[r:${relType}]`;
  } else {
    typeClause = "[r]";
  }
  const res = await runQuery(
    session,
    `MATCH (a:${ENTITY_LABEL})-${typeClause}->(b:${ENTITY_LABEL})
     WHERE ${where.join(" AND ")}
     RETURN a.id AS fromId, a.name AS fromName, a.type AS fromType,
            type(r) AS type,
            b.id AS toId, b.name AS toName, b.type AS toType,
            r.confidence AS confidence, r.evidence AS evidence, r.created_at AS createdAt
     ORDER BY r.created_at DESC LIMIT toInteger($limit)`,
    params
  );
  return res.records.map((r) => ({
    fromId: String(r.get("fromId")),
    fromName: r.get("fromName"),
    fromType: r.get("fromType"),
    type: r.get("type"),
    toId: String(r.get("toId")),
    toName: r.get("toName"),
    toType: r.get("toType"),
    confidence: r.get("confidence") ?? null,
    evidence: r.get("evidence") || [],
    createdAt: r.get("createdAt") ?? null,
  }));
}

/**
 * Remove a typed relationship between two entities (safe delete).
 * @param {object} session
 * @param {object} opts  { companyName, kbKey, sourceId, targetId, type }
 * @returns {Promise<{ deleted: boolean }>}
 */
export async function removeRelationship(session, { companyName, kbKey, sourceId, targetId, type }) {
  const relType = normalizeRelationshipType(type);
  if (!relType) throw Object.assign(new Error("Invalid relationship type."), { status: 400 });
  const res = await runQuery(
    session,
    `MATCH (a:${ENTITY_LABEL} {id: $fromId})-[r:${relType} {kb_key: $kb}]->(b:${ENTITY_LABEL} {id: $toId})
     WHERE a.company = $company AND b.company = $company
     DELETE r`,
    { fromId: sourceId, toId: targetId, kb: kbKey, company: companyName }
  );
  return { deleted: (res.summary?.counters?.relationshipsDeleted ?? 0) > 0 };
}
