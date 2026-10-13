// --------------------------
// ENTITY SERVICE — canonical entity resolution + CRUD on Neo4j Entity nodes.
// Identity = deterministic stableEntityId(company, kb, canonical_name), so
// the same name inside one KB always resolves to the same node and different
// KBs/companies never collide. `type` is a mutable descriptive property.
// --------------------------
import { stableEntityId, normalizeEntityType, ENTITY_LABEL } from "./graph-schema.js";
import { buildProvenance } from "./provenance.js";
import { runQuery } from "./neo4j.js";

/**
 * Resolve an entity reference ({ id } or { name, type }) to a canonical
 * Entity node for this (company, kb). Resolution order (proposal §8):
 *   exact id → exact name → case-insensitive name → create when allowed.
 * @param {object} session  open WRITE session
 * @param {object} opts
 * @param {string} opts.companyName
 * @param {string} opts.kbKey
 * @param {object|string} opts.ref      { id } | { name, type? } | "Name"
 * @param {boolean} [opts.autoCreate]   create a new node when unresolved
 * @returns {Promise<{ id: string, name: string, type: string, created: boolean, matchedBy: string }>}
 */
export async function resolveEntity(session, { companyName, kbKey, ref, autoCreate = false }) {
  if (ref && typeof ref === "object" && ref.id) {
    const id = String(ref.id);
    const row = await runQuery(
      session,
      `MATCH (e:${ENTITY_LABEL} {id: $id})
       WHERE e.company = $company AND e.kb_key = $kb
       RETURN e.id AS id, e.name AS name, e.type AS type`,
      { id, company: companyName, kb: kbKey }
    );
    if (row.records[0]) return mapEntity(row.records[0], "id");
  }

  let name = "";
  let type = null;
  if (ref && typeof ref === "object") {
    name = String(ref.name || "").trim();
    type = ref.type || null;
  } else if (typeof ref === "string") {
    name = ref.trim();
  }
  if (!name) throw Object.assign(new Error("Entity reference must include an id or name."), { status: 400 });

  // Exact name match (canonical node), then case-insensitive fallback.
  const res = await runQuery(
    session,
    `MATCH (e:${ENTITY_LABEL})
     WHERE e.company = $company AND e.kb_key = $kb AND toLower(e.name) = toLower($name)
     RETURN e.id AS id, e.name AS name, e.type AS type
     ORDER BY e.created_at ASC LIMIT 1`,
    { company: companyName, kb: kbKey, name }
  );
  if (res.records[0]) {
    const found = mapEntity(res.records[0], "name");
    return { ...found, created: false, matchedBy: found.name === name ? "name" : "name-case" };
  }

  if (!autoCreate) {
    throw Object.assign(
      new Error(`Entity '${name}' not found in knowledge base '${kbKey}'.`),
      { status: 404, code: "ENTITY_NOT_FOUND" }
    );
  }

  return createEntity(session, { companyName, kbKey, name, type: type || "Other", provenance: { type: "llm" } });
}

/**
 * Create (or match) a canonical entity node. Idempotent per canonical name.
 * @returns {Promise<{ id, name, type, created: boolean }>}
 */
export async function createEntity(session, { companyName, kbKey, name, type = "Other", provenance = {} }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw Object.assign(new Error("Entity name is required."), { status: 400 });
  const id = stableEntityId(companyName, kbKey, cleanName);
  const entityType = normalizeEntityType(type);
  const prov = buildProvenance({ companyName, kbKey, actor: provenance, confidence: provenance.confidence });

  const res = await runQuery(
    session,
    `MERGE (e:${ENTITY_LABEL} {id: $id})
     ON CREATE SET
       e.company = $company,
       e.kb_key = $kb,
       e.name = $name,
       e.type = $type,
       e.aliases = [],
       e.extracted_by = $extractedBy,
       e.confidence = $confidence,
       e.created_at = datetime()
     SET e.updated_at = datetime()
     RETURN e.id AS id, e.name AS name, e.type AS type,
            exists((e)-[]-()) AS hasRel, e.created_at AS createdAt`,
    {
      id,
      company: companyName,
      kb: kbKey,
      name: cleanName,
      type: entityType,
      extractedBy: prov.extracted_by,
      confidence: prov.confidence,
    }
  );
  const created = res.summary?.counters?.nodesCreated === 1;
  const row = res.records[0];
  return {
    id: String(row.get("id")),
    name: row.get("name"),
    type: row.get("type"),
    createdAt: row.get("createdAt") || null,
    created,
  };
}

/**
 * Add an alias to a canonical entity (proposal §8). Aliases are stored as a
 * string array and used by the resolver as a secondary match.
 */
export async function addAlias(session, { entityId, alias }) {
  const cleanAlias = String(alias || "").trim();
  if (!cleanAlias) throw Object.assign(new Error("alias is required."), { status: 400 });
  const res = await runQuery(
    session,
    `MATCH (e:${ENTITY_LABEL} {id: $id})
     SET e.aliases = [a IN coalesce(e.aliases, []) WHERE toLower(a) <> toLower($alias)] + $alias,
         e.updated_at = datetime()
     RETURN e.id AS id, e.aliases AS aliases`,
    { id: entityId, alias: cleanAlias }
  );
  if (!res.records[0]) throw Object.assign(new Error("Entity not found."), { status: 404 });
  return { id: entityId, aliases: res.records[0].get("aliases") || [] };
}

/** List entities in a KB with optional type filter + search + pagination. */
export async function listEntities(session, { companyName, kbKey, type = null, q = null, limit = 100, offset = 0 }) {
  const where = ["e.company = $company", "e.kb_key = $kb"];
  const params = { company: companyName, kb: kbKey, limit: Math.min(Math.max(Number(limit) || 100, 1), 500), offset: Math.max(Number(offset) || 0, 0) };
  if (type) {
    where.push("toLower(e.type) = toLower($type)");
    params.type = type;
  }
  if (q) {
    where.push("(toLower(e.name) CONTAINS toLower($q) OR any(a IN coalesce(e.aliases, []) WHERE toLower(a) CONTAINS toLower($q)))");
    params.q = q;
  }
  const res = await runQuery(
    session,
    `MATCH (e:${ENTITY_LABEL})
     WHERE ${where.join(" AND ")}
     WITH e SKIP toInteger($offset) LIMIT toInteger($limit)
     MATCH (e)-[r]-(n:${ENTITY_LABEL})
     RETURN e.id AS id, e.name AS name, e.type AS type, e.aliases AS aliases,
            e.confidence AS confidence, e.created_at AS createdAt, e.updated_at AS updatedAt,
            count(DISTINCT r) AS relationshipCount
     ORDER BY e.name`,
    params
  );
  return res.records.map((r) => ({
    id: String(r.get("id")),
    name: r.get("name"),
    type: r.get("type"),
    aliases: r.get("aliases") || [],
    confidence: r.get("confidence") ?? null,
    createdAt: r.get("createdAt") ?? null,
    updatedAt: r.get("updatedAt") ?? null,
    relationshipCount: Number(r.get("relationshipCount") || 0),
  }));
}

/** Full detail of a single entity incl. its typed relationships. */
export async function getEntity(session, { companyName, kbKey, entityId }) {
  const res = await runQuery(
    session,
    `MATCH (e:${ENTITY_LABEL} {id: $id})
     WHERE e.company = $company AND e.kb_key = $kb
     OPTIONAL MATCH (e)-[r]-(n:${ENTITY_LABEL})
     RETURN e, collect(DISTINCT {
       type: type(r),
       direction: CASE WHEN startNode(r) = e THEN 'out' ELSE 'in' END,
       otherId: n.id,
       otherName: n.name,
       otherType: n.type,
       confidence: r.confidence,
       chunkId: r.chunk_id,
       sourceTitle: r.source_title
     }) AS relationships`,
    { id: entityId, company: companyName, kb: kbKey }
  );
  const row = res.records[0];
  if (!row) throw Object.assign(new Error("Entity not found."), { status: 404 });
  const node = row.get("e");
  return {
    id: String(node.properties.id),
    name: node.properties.name,
    type: node.properties.type,
    aliases: node.properties.aliases || [],
    confidence: node.properties.confidence ?? null,
    createdAt: node.properties.created_at ?? null,
    updatedAt: node.properties.updated_at ?? null,
    relationships: (row.get("relationships") || []).filter((r) => r.type),
  };
}

/**
 * Update mutable entity properties (type, aliases, description). Identity
 * (name, id) is immutable — to rename, merge into an existing entity.
 */
export async function updateEntity(session, { companyName, kbKey, entityId, patch = {} }) {
  const sets = [];
  const params = { id: entityId, company: companyName, kb: kbKey };
  if (patch.type !== undefined) {
    params.type = normalizeEntityType(patch.type);
    sets.push("e.type = $type");
  }
  if (patch.aliases !== undefined) {
    if (!Array.isArray(patch.aliases)) throw Object.assign(new Error("aliases must be an array."), { status: 400 });
    params.aliases = [...new Set(patch.aliases.map((a) => String(a).trim()).filter(Boolean))];
    sets.push("e.aliases = $aliases");
  }
  if (patch.description !== undefined) {
    params.description = String(patch.description || "");
    sets.push("e.description = $description");
  }
  if (patch.confidence !== undefined) {
    const c = Number(patch.confidence);
    if (!Number.isFinite(c) || c < 0 || c > 1) throw Object.assign(new Error("confidence must be 0..1."), { status: 400 });
    params.confidence = c;
    sets.push("e.confidence = $confidence");
  }
  if (!sets.length) throw Object.assign(new Error("Nothing to update (type, aliases, description, confidence)."), { status: 400 });
  sets.push("e.updated_at = datetime()");
  const res = await runQuery(
    session,
    `MATCH (e:${ENTITY_LABEL} {id: $id})
     WHERE e.company = $company AND e.kb_key = $kb
     SET ${sets.join(",\n         ")}
     RETURN e.id AS id, e.type AS type, e.aliases AS aliases`,
    params
  );
  if (!res.records[0]) throw Object.assign(new Error("Entity not found."), { status: 404 });
  return { id: entityId, type: res.records[0].get("type"), aliases: res.records[0].get("aliases") || [] };
}

/**
 * Merge two canonical entities: the survivor (`keepId`) absorbs the other
 * (`dropId`), moving every typed relationship and deleting the dropped node.
 * Runs per relationship type because Cypher cannot parameterize a rel type.
 * @returns {Promise<{ keptId: string, droppedId: string, edgesMoved: number }>}
 */
export async function mergeEntities(session, { companyName, kbKey, keepId, dropId }) {
  if (!keepId || !dropId || keepId === dropId) {
    throw Object.assign(new Error("keepId and dropId are required and must differ."), { status: 400 });
  }
  // Both must exist in this company/KB.
  const check = await runQuery(
    session,
    `MATCH (a:${ENTITY_LABEL} {id: $keepId}), (b:${ENTITY_LABEL} {id: $dropId})
     WHERE a.company = $company AND a.kb_key = $kb
       AND b.company = $company AND b.kb_key = $kb
     RETURN a.id AS keepId, b.id AS dropId`,
    { keepId, dropId, company: companyName, kb: kbKey }
  );
  if (!check.records[0]) throw Object.assign(new Error("One or both entities not found in this knowledge base."), { status: 404 });

  const relTypes = (await runQuery(session, "CALL db.relationshipTypes()")).records.map((r) => String(r.get(0)));
  let edgesMoved = 0;
  for (const relType of relTypes) {
    const out = await runQuery(
      session,
      `MATCH (drop:${ENTITY_LABEL} {id: $dropId})-[r:${relType}]->(target:${ENTITY_LABEL})
       WHERE target.id <> $keepId
       MERGE (keep:${ENTITY_LABEL} {id: $keepId})-[nr:${relType} {kb_key: $kb}]->(target)
       ON CREATE SET
         nr.company = coalesce(nr.company, r.company, $company),
         nr.source_title = coalesce(nr.source_title, r.source_title),
         nr.source_url = coalesce(nr.source_url, r.source_url),
         nr.chunk_id = coalesce(nr.chunk_id, r.chunk_id),
         nr.confidence = coalesce(nr.confidence, r.confidence, 0.8),
         nr.created_at = coalesce(nr.created_at, r.created_at, datetime()),
         nr.updated_at = datetime()
       DELETE r`,
      { keepId, dropId, kb: kbKey, company: companyName }
    );
    edgesMoved += out.summary?.counters?.relationshipsDeleted ?? 0;
    const inc = await runQuery(
      session,
      `MATCH (source:${ENTITY_LABEL})-[r:${relType}]->(drop:${ENTITY_LABEL} {id: $dropId})
       WHERE source.id <> $keepId
       MERGE (source)-[nr:${relType} {kb_key: $kb}]->(keep:${ENTITY_LABEL} {id: $keepId})
       ON CREATE SET
         nr.company = coalesce(nr.company, r.company, $company),
         nr.source_title = coalesce(nr.source_title, r.source_title),
         nr.source_url = coalesce(nr.source_url, r.source_url),
         nr.chunk_id = coalesce(nr.chunk_id, r.chunk_id),
         nr.confidence = coalesce(nr.confidence, r.confidence, 0.8),
         nr.created_at = coalesce(nr.created_at, r.created_at, datetime()),
         nr.updated_at = datetime()
       DELETE r`,
      { keepId, dropId, kb: kbKey, company: companyName }
    );
    edgesMoved += inc.summary?.counters?.relationshipsDeleted ?? 0;
  }
  await runQuery(
    session,
    `MATCH (drop:${ENTITY_LABEL} {id: $dropId}) DETACH DELETE drop`,
    { dropId }
  );
  return { keptId: keepId, droppedId: dropId, edgesMoved };
}

function mapEntity(record, matchedBy) {
  return {
    id: String(record.get("id")),
    name: record.get("name"),
    type: record.get("type") || "Other",
    matchedBy,
  };
}
