// --------------------------
// KNOWLEDGE TOOLS — the internal AI tool layer (proposal §19–§20).
// Read tools (search/get/evidence) are freely usable during answering;
// write tools route through the mutation policy: trusted actors commit,
// AI/LLM actors propose → candidate claims land in the review queue.
//
// Each tool execution opens ONE short-lived session on the company's
// configured graph (read vs write access mode). Company scope comes from the
// caller context — never from tool arguments. Nothing LLM-supplied is
// interpolated into Cypher: fixed templates + parameters only.
//
// The definitions use the OpenAI/Workers AI function-calling shape so an
// agent loop (or Phase 7 MCP server) can hand the LLM the tool schemas and
// execute calls through executeKnowledgeTool().
// --------------------------
import { withKnowledgeSession } from "./neo4j.js";
import { requireGraphConfig } from "./knowledge-service.js";
import { strictRelationshipType } from "./graph-schema.js";
import { validateClaim, canCommitMutation } from "./validation.js";
import * as entityService from "./entity-service.js";
import * as relationshipService from "./relationship-service.js";
import * as claimService from "./claim-service.js";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

// ------------------------------------------------------------------
// ACCESS TIERS (proposal §20)
// ------------------------------------------------------------------
// read      → automatic for any tenant actor
// write     → trusted actor or explicit policyAllow commits; otherwise the
//             tool degrades to "propose" (candidate claim, no graph write)
const READ_TOOLS = new Set([
  "search_knowledge",
  "get_entity",
  "get_entity_relationships",
  "find_related_entities",
  "get_claims",
  "get_evidence",
  "validate_claim",
  "find_conflicts",
  "find_duplicates",
]);
const WRITE_TOOLS = new Set(["propose_entity", "propose_relationship", "propose_claim"]);

// ------------------------------------------------------------------
// ARG VALIDATION (pure)
// ------------------------------------------------------------------

function coerceLimit(raw, fallback = DEFAULT_LIMIT) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

function coerceConfidence(raw) {
  if (raw === undefined || raw === null) return undefined; // service default
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

/**
 * Validate tool arguments against the tool's parameter schema (pure).
 * @param {string} toolName
 * @param {object} args
 * @returns {{ ok: true, value: object } | { ok: false, errors: object }}
 */
export function validateToolArgs(toolName, args = {}) {
  const def = toolDef(toolName);
  if (!def || !def.name) return { ok: false, errors: { tool: `Unknown tool '${toolName}'.` } };
  const errors = {};
  const value = { ...args };

  for (const required of def.required || []) {
    const raw = args[required];
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      errors[required] = `${required} is required.`;
    }
  }

  if (args.kbKey !== undefined && args.kbKey !== null && !/^[a-z0-9-]+$/i.test(String(args.kbKey).trim())) {
    errors.kbKey = "kbKey must be a KB key (lowercase letters, numbers, hyphens).";
  }
  if (args.limit !== undefined && args.limit !== null) {
    value.limit = coerceLimit(args.limit);
  }

  if (toolName === "propose_claim" || toolName === "validate_claim") {
    const predicate = strictRelationshipType(args.predicate);
    if (!predicate) errors.predicate = "predicate must be one of the allowed relationship types.";
    else value.predicate = predicate;
    if (args.confidence !== undefined && args.confidence !== null) {
      const c = coerceConfidence(args.confidence);
      if (c === undefined) errors.confidence = "confidence must be a number between 0 and 1.";
      else value.confidence = c;
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}

/**
 * Policy gate for a tool call (pure).
 * @param {string} toolName
 * @param {object} ctx  { actor: {type,id}, policyAllow }
 * @returns {{ allowed: 'read'|'commit'|'propose'|'denied', reason: string }}
 */
export function resolveToolPolicy(toolName, { actor = {}, policyAllow = false } = {}) {
  if (!READ_TOOLS.has(toolName) && !WRITE_TOOLS.has(toolName)) {
    return { allowed: "denied", reason: `Unknown tool '${toolName}'.` };
  }
  const tenant = actor?.companyKey || actor?.type === "admin" || actor?.type === "api";
  if (READ_TOOLS.has(toolName)) {
    if (!tenant) return { allowed: "denied", reason: "Read tools require a tenant actor." };
    return { allowed: "read", reason: "read tools are automatic for tenant actors" };
  }
  // Write tools.
  const policy = canCommitMutation({ actor, policyAllow });
  if (policy.commit) {
    return { allowed: "commit", reason: policy.reason };
  }
  if (actor?.type === "llm" || actor?.type === "ai") {
    return { allowed: "propose", reason: "AI actors propose; a trusted actor or policy grant must commit." };
  }
  return { allowed: "denied", reason: policy.reason };
}

// ------------------------------------------------------------------
// SESSION-BASED IMPLEMENTATIONS (fixed templates; fake-able in tests)
// ------------------------------------------------------------------

/** search_knowledge — entities whose name/alias contains the query (company or KB scoped). */
export async function searchKnowledge(session, { companyName, query, kbKey = null, limit = DEFAULT_LIMIT }) {
  const params = { company: companyName, q: String(query || "").trim(), limit: coerceLimit(limit) };
  const kbClause = kbKey ? "AND e.kb_key = $kb" : "";
  if (kbKey) params.kb = kbKey;
  const res = await session.run(
    `MATCH (e:Entity)
     WHERE e.company = $company ${kbClause}
       AND (toLower(e.name) CONTAINS toLower($q)
            OR any(a IN coalesce(e.aliases, []) WHERE toLower(a) CONTAINS toLower($q)))
     OPTIONAL MATCH (e)-[r]-(n:Entity)
     RETURN e.id AS id, e.name AS name, e.type AS type, e.kb_key AS kbKey,
            e.confidence AS confidence, count(DISTINCT r) AS relationshipCount
     ORDER BY e.name LIMIT toInteger($limit)`,
    params
  );
  return res.records.map((r) => ({
    id: String(r.get("id")),
    name: r.get("name"),
    type: r.get("type") || "Other",
    kbKey: r.get("kbKey") || null,
    confidence: r.get("confidence") ?? null,
    relationshipCount: Number(r.get("relationshipCount") || 0),
  }));
}

/** Resolve an entity ref ({ id } | { name }) to a canonical node (read). */
async function resolveEntityRead(session, { companyName, kbKey, ref }) {
  return entityService.resolveEntity(session, { companyName, kbKey, ref, autoCreate: false });
}

/** get_entity — entity detail incl. its typed relationships. */
export async function getEntityTool(session, { companyName, kbKey, entityId, name }) {
  if (entityId) {
    return entityService.getEntity(session, { companyName, kbKey, entityId });
  }
  const resolved = await resolveEntityRead(session, { companyName, kbKey, ref: { name } });
  return entityService.getEntity(session, { companyName, kbKey, entityId: resolved.id });
}

/** get_entity_relationships — typed edges of one entity. */
export async function getEntityRelationshipsTool(session, { companyName, kbKey, entityId, name, type = null, limit = DEFAULT_LIMIT }) {
  const resolved = entityId
    ? { id: entityId }
    : await resolveEntityRead(session, { companyName, kbKey, ref: { name } });
  return relationshipService.listRelationships(session, {
    companyName, kbKey, entityId: resolved.id, type, limit: coerceLimit(limit),
  });
}

/** find_related_entities — 1..N hop neighborhood over typed edges. */
export async function findRelatedEntities(session, { companyName, kbKey, entityId, name, type = null, hops = 1, limit = DEFAULT_LIMIT }) {
  const resolved = entityId
    ? { id: entityId }
    : await resolveEntityRead(session, { companyName, kbKey, ref: { name } });
  const depth = Math.min(Math.max(Number(hops) || 1, 1), 3);
  const params = { id: resolved.id, company: companyName, kb: kbKey, limit: coerceLimit(limit) };
  // `type` only ever reaches this template after strictRelationshipType()
  // (allowlist member or null) — never a raw LLM string.
  const typeClause = type ? `:${strictRelationshipType(type)}` : "";
  const res = await session.run(
    `MATCH (e:Entity {id: $id})-[r${typeClause}*1..${depth}]-(n:Entity)
     WHERE n.company = $company AND n.kb_key = $kb AND n.id <> $id
     RETURN DISTINCT n.id AS id, n.name AS name, n.type AS type, n.kb_key AS kbKey
     ORDER BY n.name LIMIT toInteger($limit)`,
    params
  );
  return res.records.map((r) => ({
    id: String(r.get("id")),
    name: r.get("name"),
    type: r.get("type") || "Other",
    kbKey: r.get("kbKey") || null,
  }));
}

/** get_claims — claims for a KB, optionally filtered by status/entity. */
export async function getClaimsTool(session, { companyName, kbKey, status = null, entityId = null, limit = DEFAULT_LIMIT }) {
  return claimService.listClaims(session, { companyName, kbKey, status, entityId, limit: coerceLimit(limit) });
}

/** get_evidence — evidence refs for claims touching an entity or one claim. */
export async function getEvidenceTool(session, { companyName, kbKey, entityId, claimId = null, limit = DEFAULT_LIMIT }) {
  if (claimId) {
    const claim = await claimService.getClaim(session, { companyName, kbKey, claimId });
    return [{ ...claim, evidence: claim.evidence || [] }];
  }
  const claims = await claimService.listClaims(session, { companyName, kbKey, entityId, limit: coerceLimit(limit) });
  return claims
    .filter((c) => (c.evidence || []).length)
    .map((c) => ({ id: c.id, status: c.status, evidence: c.evidence }));
}

/** validate_claim — pure validation + existing conflict/duplicate scan. */
export async function validateClaimTool(session, { companyName, kbKey, subject, predicate, object, confidence }) {
  const check = validateClaim({ subject, predicate, object, confidence });
  if (!check.ok) return { valid: false, errors: check.errors, duplicates: [], conflicts: [] };
  let duplicates = [];
  let conflicts = [];
  if (kbKey) {
    try {
      const subj = await resolveEntityRead(session, { companyName, kbKey, ref: check.value.subject });
      const obj = await resolveEntityRead(session, { companyName, kbKey, ref: check.value.object });
      if (subj.id !== obj.id) {
        const res = await session.run(
          `MATCH (s:Entity {id: $sid})-[:SUBJECT_OF]->(c:Claim)-[:OBJECT_OF]->(o:Entity)
           WHERE c.company = $company AND c.kb_key = $kb AND c.predicate = $predicate
           RETURN c.id AS id, c.status AS status, o.id AS objectId, o.name AS objectName,
                  c.confidence AS confidence
           ORDER BY c.created_at DESC LIMIT 10`,
          { sid: subj.id, company: companyName, kb: kbKey, predicate: check.value.predicate }
        );
        for (const row of res.records) {
          const sameObject = String(row.get("objectId")) === obj.id;
          (sameObject ? duplicates : conflicts).push({
            id: String(row.get("id")),
            status: row.get("status"),
            objectId: String(row.get("objectId")),
            objectName: row.get("objectName"),
            confidence: row.get("confidence") ?? null,
          });
        }
      }
    } catch {
      /* resolution failure → no conflict data; validation itself still stands */
    }
  }
  return { valid: true, value: check.value, duplicates, conflicts };
}

/** find_conflicts — claims flagged conflicting / needs_review. */
export async function findConflictsTool(session, { companyName, kbKey }) {
  return claimService.findConflicts(session, { companyName, kbKey });
}

/** find_duplicates — same canonical name, different ids within a KB (legacy). */
export async function findDuplicates(session, { companyName, kbKey, limit = DEFAULT_LIMIT }) {
  const res = await session.run(
    `MATCH (a:Entity), (b:Entity)
     WHERE a.company = $company AND a.kb_key = $kb
       AND b.company = $company AND b.kb_key = $kb
       AND a.id < b.id AND toLower(a.name) = toLower(b.name)
     RETURN a.id AS keepId, a.name AS name, a.created_at AS createdAt,
            b.id AS dropId, b.created_at AS duplicateCreatedAt
     ORDER BY a.name LIMIT $limit`,
    { company: companyName, kb: kbKey, limit: coerceLimit(limit) }
  );
  return res.records.map((r) => ({
    name: r.get("name"),
    keepId: String(r.get("keepId")),
    dropId: String(r.get("dropId")),
    createdAt: r.get("createdAt") ?? null,
    duplicateCreatedAt: r.get("duplicateCreatedAt") ?? null,
  }));
}

/** propose_entity — create a canonical node (idempotent MERGE). */
export async function proposeEntity(session, { companyName, kbKey, name, type = "Other", confidence, actor = {} }) {
  return entityService.createEntity(session, {
    companyName, kbKey, name, type, provenance: { ...actor, confidence: coerceConfidence(confidence) },
  });
}

/**
 * propose_relationship — trusted commit writes the typed edge (+ accepted
 * claim); a proposing (AI) actor writes a candidate claim instead, so nothing
 * reaches the graph until a trusted actor or policy grant commits.
 */
export async function proposeRelationship(session, { companyName, kbKey, source, type, target, confidence, evidence = [], actor = {}, canCommit = false }) {
  if (canCommit) {
    const edge = await relationshipService.createRelationship(session, {
      companyName, kbKey, source, type, target, confidence, evidence, actor, autoCreateEntities: true,
    });
    return { committed: true, ...edge };
  }
  const claim = await claimService.createClaim(session, {
    companyName, kbKey, subject: source, predicate: type, object: target,
    confidence, evidence, actor, status: "candidate", allowAutoCreateEntities: false,
  });
  return { committed: false, queued: true, claim: { id: claim.id, status: claim.status, reason: claim.reason } };
}

/** propose_claim — claim lifecycle via policy (createClaim applies the actor). */
export async function proposeClaim(session, { companyName, kbKey, subject, predicate, object, confidence, evidence = [], actor = {} }) {
  return claimService.createClaim(session, {
    companyName, kbKey, subject, predicate, object, confidence, evidence, actor,
    allowAutoCreateEntities: false,
  });
}

// ------------------------------------------------------------------
// REGISTRY + DISPATCHER
// ------------------------------------------------------------------

function def(name, description, properties, required = [], access = "read") {
  return {
    type: "function",
    access,
    name,
    description,
    required,
    function: { name, description, parameters: { type: "object", properties, required } },
  };
}

/** Function-calling definitions (OpenAI/Workers AI shape). */
export const KNOWLEDGE_TOOLS = [
  def(
    "search_knowledge",
    "Search the knowledge graph for entities whose name or alias contains the query text.",
    {
      query: { type: "string", description: "Free-text search term (entity name or alias)." },
      kbKey: { type: "string", description: "Optional KB key to scope the search." },
      limit: { type: "integer", description: "Max results (1-100)." },
    },
    ["query"]
  ),
  def(
    "get_entity",
    "Get one canonical entity with its typed relationships. Provide either entityId or name.",
    {
      kbKey: { type: "string", description: "KB key." },
      entityId: { type: "string", description: "Canonical entity id (ent_...)." },
      name: { type: "string", description: "Entity canonical name." },
    },
    ["kbKey"]
  ),
  def(
    "get_entity_relationships",
    "List the typed relationships of one entity.",
    {
      kbKey: { type: "string", description: "KB key." },
      entityId: { type: "string" },
      name: { type: "string" },
      type: { type: "string", description: "Optional relationship type filter (allowlisted)." },
      limit: { type: "integer" },
    },
    ["kbKey"]
  ),
  def(
    "find_related_entities",
    "Find entities reachable from a given entity across 1-3 relationship hops.",
    {
      kbKey: { type: "string", description: "KB key." },
      entityId: { type: "string" },
      name: { type: "string" },
      hops: { type: "integer", description: "Traversal depth (1-3, default 1)." },
      limit: { type: "integer" },
    },
    ["kbKey"]
  ),
  def(
    "get_claims",
    "List knowledge claims (subject-predicate-object statements with confidence), optionally by status or entity.",
    {
      kbKey: { type: "string", description: "KB key." },
      status: { type: "string", description: "candidate|accepted|rejected|conflicting|deprecated|needs_review" },
      entityId: { type: "string" },
      limit: { type: "integer" },
    },
    ["kbKey"]
  ),
  def(
    "get_evidence",
    "Get the document/chunk evidence backing claims for an entity or a specific claim.",
    {
      kbKey: { type: "string", description: "KB key." },
      entityId: { type: "string" },
      claimId: { type: "string" },
      limit: { type: "integer" },
    },
    ["kbKey"]
  ),
  def(
    "validate_claim",
    "Validate a subject-predicate-object claim and check for existing duplicates or contradictions.",
    {
      kbKey: { type: "string", description: "Optional KB key to scan for conflicts." },
      subject: { type: "string" },
      predicate: { type: "string", description: "Allowlisted relationship type (e.g. USES)." },
      object: { type: "string" },
      confidence: { type: "number", description: "0-1." },
    },
    ["subject", "predicate", "object"]
  ),
  def("find_conflicts", "List claims currently flagged as conflicting or needs_review.", {
    kbKey: { type: "string", description: "KB key." },
  }, ["kbKey"]),
  def(
    "find_duplicates",
    "Find entity pairs with the same canonical name in a KB (candidates for merging).",
    {
      kbKey: { type: "string", description: "KB key." },
      limit: { type: "integer" },
    },
    ["kbKey"]
  ),
  def(
    "propose_entity",
    "Create (or match) a canonical entity node. Trusted actors commit immediately.",
    {
      kbKey: { type: "string", description: "KB key." },
      name: { type: "string" },
      type: { type: "string", description: "Entity type (Person, Organization, Concept, ...)." },
      confidence: { type: "number", description: "0-1." },
    },
    ["kbKey", "name"],
    "write"
  ),
  def(
    "propose_relationship",
    "Propose a typed relationship between two entities. Trusted actors commit the edge + accepted claim; AI actors queue a candidate claim for review.",
    {
      kbKey: { type: "string", description: "KB key." },
      source: { type: "string", description: "Source entity name." },
      type: { type: "string", description: "Allowlisted relationship type (e.g. USES)." },
      target: { type: "string", description: "Target entity name." },
      confidence: { type: "number", description: "0-1." },
      evidence: { type: "array", items: { type: "string" }, description: "Document/chunk refs." },
    },
    ["kbKey", "source", "type", "target"],
    "write"
  ),
  def(
    "propose_claim",
    "Propose a knowledge claim. Status is derived from confidence + actor policy (trusted actors commit accepted claims; AI actors get candidates).",
    {
      kbKey: { type: "string", description: "KB key." },
      subject: { type: "string" },
      predicate: { type: "string", description: "Allowlisted relationship type." },
      object: { type: "string" },
      confidence: { type: "number", description: "0-1." },
      evidence: { type: "array", items: { type: "string" }, description: "Document/chunk refs." },
    },
    ["kbKey", "subject", "predicate", "object"],
    "write"
  ),
];

/** name → implementation. */
const TOOL_MAP = {
  search_knowledge: searchKnowledge,
  get_entity: getEntityTool,
  get_entity_relationships: getEntityRelationshipsTool,
  find_related_entities: findRelatedEntities,
  get_claims: getClaimsTool,
  get_evidence: getEvidenceTool,
  validate_claim: validateClaimTool,
  find_conflicts: findConflictsTool,
  find_duplicates: findDuplicates,
  propose_entity: proposeEntity,
  propose_relationship: proposeRelationship,
  propose_claim: proposeClaim,
};

export const TOOL_NAMES = new Set(Object.keys(TOOL_MAP));

/** Full definition for a tool name (definition + impl + access tier). */
function toolDef(name) {
  const d = KNOWLEDGE_TOOLS.find((t) => t.name === name);
  if (!d) return null;
  return { ...d, impl: TOOL_MAP[name], access: d.access, required: d.required };
}

/**
 * Execute one knowledge tool.
 * @param {string} toolName
 * @param {object} args
 * @param {object} ctx  { companyName, kbKey, actor: {type,id}, policyAllow }
 * @returns {Promise<object>}  tool result
 * @throws {Error} with .status / .code for API surfacing
 */
export async function executeKnowledgeTool(toolName, args = {}, { companyName, kbKey = null, actor = {}, policyAllow = false } = {}) {
  if (!TOOL_MAP[toolName]) {
    throw Object.assign(new Error(`Unknown knowledge tool '${toolName}'.`), { status: 400, code: "UNKNOWN_TOOL" });
  }
  if (!companyName) throw Object.assign(new Error("companyName is required."), { status: 400, code: "TENANT_REQUIRED" });

  // Context-level KB scoping wins over the (optional) argument-level one.
  const effectiveArgs = kbKey && !args.kbKey ? { ...args, kbKey } : args;
  const check = validateToolArgs(toolName, effectiveArgs);
  if (!check.ok) {
    throw Object.assign(new Error(`Invalid tool arguments: ${JSON.stringify(check.errors)}`), { status: 400, code: "INVALID_TOOL_ARGS", errors: check.errors });
  }

  const policy = resolveToolPolicy(toolName, { actor, policyAllow });
  if (policy.allowed === "denied") {
    throw Object.assign(new Error(`Tool '${toolName}' denied: ${policy.reason}`), { status: 403, code: "TOOL_POLICY_DENIED", reason: policy.reason });
  }

  const graph = requireGraphConfig(companyName);
  // Both `commit` and `propose` write to the graph (candidate claims ARE
  // writes) — only pure reads open a READ session.
  const write = policy.allowed === "commit" || policy.allowed === "propose";
  const argsWithRef = { ...check.value, actor, canCommit: policy.allowed === "commit" };
  const def = toolDef(toolName);

  return withKnowledgeSession(graph, { write }, (session) => def.impl(session, argsWithRef));
}