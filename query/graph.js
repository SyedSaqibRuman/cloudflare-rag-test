// --------------------------
// GRAPH RAG — query-time Neo4j context injection
// Optional pipeline step: when the company has a Neo4j connection configured
// (NEO4J_URI + NEO4J_USERNAME + NEO4J_PASSWORD, plus NEO4J_DATABASE), the ask
// path augments the answer with knowledge from the company's knowledge graph.
//
// Phase 4 retrieval is knowledge-aware (proposal §17) instead of raw
// generated Cypher:
//
//   question → entity mention detection → canonical entity resolution
//            → graph traversal (typed edges + accepted claims w/ evidence)
//            → confidence filtering → formatted [Graph Knowledge] context
//
// The legacy path (LLM-generated read-only Cypher) remains as a FALLBACK for
// structural questions (aggregates, counts, "list everything") that entity
// matching cannot answer. Best-effort by design: any failure (bad config,
// LLM, network, invalid Cypher) yields NO graph context, never an ask error.
//
// Safety:
//  - All queries run inside session.executeRead (the driver refuses writes).
//  - Entity/claim/edge queries are fixed templates with parameters — no
//    LLM-supplied string is ever interpolated into Cypher.
//  - The fallback path sanitizes generated Cypher (isSafeCypher): only
//    MATCH/WITH/WHERE/RETURN/ORDER BY/LIMIT/UNWIND/OPTIONAL MATCH survive;
//    destructive clauses and multiple statements are rejected.
//  - Every query is scoped to the company (entities/claims/edges carry the
//    company property) — tenant isolation is enforced by the query shape,
//    not by the model.
//  - Result rows are capped (GRAPH_MAX_ROWS / per-entity budgets) and
//    truncated to a char budget.
// --------------------------
import { runCloudflareAI } from "../services/cloudflare_ai.js";
import { getLlmModel } from "./llm.js";
import { sanitizeText } from "./context.js";

// Graph config resolution now lives in config/graph.js (shared with the
// knowledge layer). Re-exported here so existing importers (kb-service,
// ingest, tests) keep working unchanged.
export { getGraphConfig, graphEnabled } from "../config/graph.js";

const GRAPH_MAX_ROWS = 20;
const GRAPH_MAX_CHARS = 2500;
const CYPHER_TIMEOUT_MS = 15_000;

// Knowledge-aware path budgets.
const GRAPH_MAX_ENTITIES = 5; // entities considered per question
const GRAPH_MAX_NEIGHBORS_PER_ENTITY = 8; // edges+claims shown per entity
const GRAPH_MIN_CONFIDENCE = 0.5; // below this, edges/claims are filtered out
const GRAPH_ENTITY_CANDIDATES = 20; // raw mention candidates before filtering

// Destructive / non-read Cypher clauses that must never reach the graph.
// The driver's executeRead mode is the hard backstop (write transactions are
// refused); this blacklist is the first line so we don't even try.
const DESTRUCTIVE = /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|FOREACH|CALL|LOAD\s+CSV)\b/i;

/**
 * Open a short-lived driver session. The driver is lazy-imported so the module
 * loads without the dependency installed (tests / CLI runs without deps).
 */
async function withSession(graph, fn) {
  const neo4j = await import("neo4j-driver");
  const driver = neo4j.default.driver(
    graph.uri,
    neo4j.default.auth.basic(graph.username, graph.password)
  );
  try {
    const session = driver.session({ database: graph.database, defaultAccessMode: neo4j.default.session.READ });
    try {
      return await fn(session);
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

// ------------------------------------------------------------------
// PHASE 4 — KNOWLEDGE-AWARE RETRIEVAL (entity path)
// ------------------------------------------------------------------

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Build a word-boundary-aware matcher for one entity name/alias. Only applies
 * boundaries on the sides where the term starts/ends with a word character —
 * punctuation-edged terms (e.g. "O'Reilly") match loosely.
 * @param {string} term
 * @returns {RegExp|null}  null when the term is empty
 */
export function entityMentionRegex(term) {
  const t = String(term || "").trim();
  if (!t) return null;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = WORD_CHAR.test(t[0]) ? "(?<![\\p{L}\\p{N}_])" : "";
  const end = WORD_CHAR.test(t[t.length - 1]) ? "(?![\\p{L}\\p{N}_])" : "";
  return new RegExp(`${start}${escaped}${end}`, "iu");
}

/**
 * True when `question` mentions the entity name/alias (case-insensitive,
 * word-boundary aware — "ISO" does not match "isolation").
 * @param {string} question
 * @param {string} name
 * @returns {boolean}
 */
export function matchesEntityMention(question, name) {
  const re = entityMentionRegex(name);
  return re ? re.test(question) : false;
}

/**
 * Detect canonical entities mentioned in the question. Runs a fixed template
 * query scoped to the company (optionally one KB); word-boundary filtering
 * happens in JS to cut false positives. Returns up to GRAPH_MAX_ENTITIES
 * entities, most-specific (longest name) first.
 *
 * @param {object} session  open READ session
 * @param {string} question
 * @param {string} companyName
 * @param {string|null} [kbKey]  scope to a single KB when provided
 * @returns {Promise<Array<{id, name, type, confidence, kbKey}>>}
 */
export async function detectEntityMentions(session, question, companyName, kbKey = null) {
  const params = { company: companyName, q: question, limit: GRAPH_ENTITY_CANDIDATES };
  const kbClause = kbKey ? "AND e.kb_key = $kb" : "";
  if (kbKey) params.kb = kbKey;
  const res = await session.run(
    `MATCH (e:Entity)
     WHERE e.company = $company ${kbClause}
       AND (toLower($q) CONTAINS toLower(e.name)
            OR any(a IN coalesce(e.aliases, []) WHERE toLower($q) CONTAINS toLower(a)))
     RETURN e.id AS id, e.name AS name, e.type AS type,
            e.confidence AS confidence, e.kb_key AS kbKey
     ORDER BY size(e.name) DESC
     LIMIT $limit`,
    params,
    { timeout: CYPHER_TIMEOUT_MS }
  );

  const out = [];
  for (const row of res.records) {
    const name = String(row.get("name") || "");
    if (!name) continue;
    // Word-boundary check against the question (name + any alias).
    if (!matchesEntityMention(question, name)) continue;
    const aliases = [];
    out.push({
      id: String(row.get("id")),
      name,
      type: String(row.get("type") || "Other"),
      confidence: row.get("confidence") ?? null,
      kbKey: String(row.get("kbKey") || ""),
      aliases,
    });
    if (out.length >= GRAPH_MAX_ENTITIES) break;
  }
  return out;
}

/**
 * Fetch the neighborhood of the matched entities: typed edges (both
 * directions) and ACCEPTED claims with their evidence, all company-scoped and
 * confidence-filtered. Claims and edges for the same triple are both returned;
 * formatGraphKnowledge dedupes.
 *
 * @param {object} session  open READ session
 * @param {string} companyName
 * @param {Array<{id, name}>} entities
 * @returns {Promise<{ relationships: Array, claims: Array }>}
 */
export async function fetchEntityNeighborhood(session, companyName, entities) {
  const relationships = [];
  const claims = [];
  const paramsBase = { company: companyName, minConf: GRAPH_MIN_CONFIDENCE };

  await Promise.all(
    entities.map(async (entity) => {
      const relRes = await session.run(
        `MATCH (e:Entity {id: $id})-[r]-(n:Entity)
         WHERE e.company = $company AND n.company = $company
           AND coalesce(r.confidence, 0) >= $minConf
         RETURN n.id AS nid, n.name AS nname, n.type AS ntype,
                type(r) AS rtype, r.confidence AS confidence, r.evidence AS evidence,
                CASE WHEN startNode(r) = e THEN 'out' ELSE 'in' END AS dir
         ORDER BY coalesce(r.confidence, 0) DESC
         LIMIT $max`,
        { ...paramsBase, id: entity.id, max: GRAPH_MAX_NEIGHBORS_PER_ENTITY },
        { timeout: CYPHER_TIMEOUT_MS }
      );
      for (const row of relRes.records) {
        relationships.push({
          entityId: entity.id,
          entityName: entity.name,
          otherId: String(row.get("nid")),
          otherName: String(row.get("nname") || ""),
          otherType: String(row.get("ntype") || "Other"),
          type: String(row.get("rtype") || ""),
          confidence: row.get("confidence") ?? null,
          evidence: row.get("evidence") || [],
          direction: row.get("dir") === "out" ? "out" : "in",
        });
      }

      // Accepted claims where the entity is the subject (out) …
      const outRes = await session.run(
        `MATCH (e:Entity {id: $id})-[:SUBJECT_OF]->(c:Claim)-[:OBJECT_OF]->(o:Entity)
         WHERE c.company = $company AND c.status = 'accepted'
           AND coalesce(c.confidence, 0) >= $minConf
         RETURN o.id AS otherId, o.name AS otherName, c.predicate AS predicate,
                c.confidence AS confidence, c.evidence AS evidence
         ORDER BY coalesce(c.confidence, 0) DESC
         LIMIT $max`,
        { ...paramsBase, id: entity.id, max: GRAPH_MAX_NEIGHBORS_PER_ENTITY },
        { timeout: CYPHER_TIMEOUT_MS }
      );
      for (const row of outRes.records) {
        claims.push({
          entityId: entity.id,
          entityName: entity.name,
          otherId: String(row.get("otherId")),
          otherName: String(row.get("otherName") || ""),
          predicate: String(row.get("predicate") || ""),
          confidence: row.get("confidence") ?? null,
          evidence: row.get("evidence") || [],
          direction: "out",
        });
      }

      // … and where it is the object (in).
      const inRes = await session.run(
        `MATCH (e:Entity {id: $id})<-[:OBJECT_OF]-(c:Claim)<-[:SUBJECT_OF]-(s:Entity)
         WHERE c.company = $company AND c.status = 'accepted'
           AND coalesce(c.confidence, 0) >= $minConf
         RETURN s.id AS otherId, s.name AS otherName, c.predicate AS predicate,
                c.confidence AS confidence, c.evidence AS evidence
         ORDER BY coalesce(c.confidence, 0) DESC
         LIMIT $max`,
        { ...paramsBase, id: entity.id, max: GRAPH_MAX_NEIGHBORS_PER_ENTITY },
        { timeout: CYPHER_TIMEOUT_MS }
      );
      for (const row of inRes.records) {
        claims.push({
          entityId: entity.id,
          entityName: entity.name,
          otherId: String(row.get("otherId")),
          otherName: String(row.get("otherName") || ""),
          predicate: String(row.get("predicate") || ""),
          confidence: row.get("confidence") ?? null,
          evidence: row.get("evidence") || [],
          direction: "in",
        });
      }
    })
  );

  return { relationships, claims };
}

function fmtConfidence(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
    : "?";
}

function fmtEvidence(evidence) {
  const refs = Array.isArray(evidence) ? evidence.slice(0, 2) : [];
  return refs.length ? ` — ${refs.join(", ")}` : "";
}

/**
 * Format the matched-entity neighborhood into a [Graph Knowledge] context
 * block. Pure + deterministic: sorts by confidence, dedupes the same
 * (predicate, direction, other) from edge + claim representations, and stays
 * within the char budget. Returns null when there is nothing to show.
 *
 * @param {object} opts
 * @param {Array<{name, type}>} opts.entities
 * @param {Array} opts.relationships  [{ entityName, otherName, type, confidence, evidence, direction }]
 * @param {Array} opts.claims         [{ entityName, otherName, predicate, confidence, evidence, direction }]
 * @param {number} [opts.maxChars]
 * @param {number} [opts.maxPerEntity]
 * @returns {string|null}
 */
export function formatGraphKnowledge({ entities = [], relationships = [], claims = [], maxChars = GRAPH_MAX_CHARS, maxPerEntity = GRAPH_MAX_NEIGHBORS_PER_ENTITY } = {}) {
  if (!entities.length) return null;

  // Merge edges + claims, deduping identical (entity, predicate, other, dir).
  const byEntity = new Map(); // entityName → Map(key → {…})
  const upsert = (item, key) => {
    const bucket = byEntity.get(item.entityName) || new Map();
    const existing = bucket.get(key);
    if (!existing) {
      bucket.set(key, item);
    } else if ((item.confidence ?? 0) > (existing.confidence ?? 0)) {
      // Higher-confidence representation wins, but evidence is merged — the
      // claim's citation trail must survive even when the edge scored higher.
      item.evidence = mergeEvidence(existing.evidence, item.evidence);
      bucket.set(key, item);
    } else {
      existing.evidence = mergeEvidence(existing.evidence, item.evidence);
    }
    byEntity.set(item.entityName, bucket);
  };

  const mergeEvidence = (a, b) => {
    const refs = [...(a || []), ...(b || [])];
    return [...new Set(refs)].slice(0, 4);
  };
  for (const rel of relationships) {
    if (!rel.type || !rel.otherName) continue;
    upsert(rel, `${rel.type}|${rel.direction}|${rel.otherName.toLowerCase()}`);
  }
  for (const claim of claims) {
    if (!claim.predicate || !claim.otherName) continue;
    upsert(claim, `${claim.predicate}|${claim.direction}|${claim.otherName.toLowerCase()}`);
  }

  let text = "";
  for (const entity of entities) {
    const bucket = [...(byEntity.get(entity.name) || new Map()).values()]
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, maxPerEntity);
    if (!bucket.length) continue;
    const arrow = (dir) => (dir === "out" ? "→" : "←");
    const header = `- ${entity.name}${entity.type && entity.type !== "Other" ? ` (${entity.type})` : ""}`;
    if (text && (text + `\n${header}`).length > maxChars) break;
    text += `\n${header}`;
    for (const item of bucket) {
      const pred = item.type || item.predicate;
      const line = `\n    ${arrow(item.direction)} ${pred} ${item.otherName} (${fmtConfidence(item.confidence)})${fmtEvidence(item.evidence)}`;
      if ((text + line).length > maxChars) break;
      text += line;
    }
  }
  if (!text) return null;
  return `[Graph Knowledge]${text}`;
}

/**
 * Knowledge-aware retrieval for one question, in one READ session.
 * Returns { context, method: "knowledge", entities } or null.
 */
async function retrieveViaKnowledge(graph, question, companyName, kbKey) {
  return withSession(graph, async (session) => {
    const entities = await detectEntityMentions(session, question, companyName, kbKey);
    if (!entities.length) return null;
    const { relationships, claims } = await fetchEntityNeighborhood(session, companyName, entities);
    const context = formatGraphKnowledge({ entities, relationships, claims });
    if (!context) return null;
    return {
      context: `\n${sanitizeText(context)}`,
      cypher: null,
      method: "knowledge",
      entities: entities.map((e) => ({ id: e.id, name: e.name, type: e.type, kbKey: e.kbKey })),
    };
  });
}

// ------------------------------------------------------------------
// LEGACY PATH — schema → generated Cypher (fallback for structural Qs)
// ------------------------------------------------------------------

/**
 * Fetch a compact graph schema (labels, relationship types, property keys)
 * so the Cypher-generation prompt can produce valid queries.
 */
async function fetchGraphSchema(graph) {
  return withSession(graph, async (session) => {
    const [labels, rels, props] = await Promise.all([
      session.run("CALL db.labels()"),
      session.run("CALL db.relationshipTypes()"),
      session.run("CALL db.propertyKeys()"),
    ]);
    return {
      labels: labels.records.map((r) => r.get(0)),
      relationshipTypes: rels.records.map((r) => r.get(0)),
      propertyKeys: props.records.map((r) => r.get(0)),
    };
  });
}

/**
 * Generate a read-only Cypher query for the user's question via the LLM.
 * Returns the Cypher string or null (INVALID / empty / unsafe).
 */
export async function generateCypher(question, schema, companyName) {
  const prompt = `You are a Cypher query generator for a Neo4j graph database.

Graph schema:
- Node labels: ${schema.labels.join(", ") || "(none)"}
- Relationship types: ${schema.relationshipTypes.join(", ") || "(none)"}
- Property keys: ${schema.propertyKeys.join(", ") || "(none)"}

Write ONE read-only Cypher query to answer this question:
"${question}"

RULES:
- Return ONLY the Cypher query. No explanation, no backticks, no markdown.
- Use ONLY MATCH, OPTIONAL MATCH, WITH, WHERE, RETURN, ORDER BY, LIMIT, UNWIND, and property access.
- NO CREATE, MERGE, DELETE, DETACH, SET, REMOVE, DROP, FOREACH, or CALL.
- Do not invent labels, relationship types, or property names not in the schema.
- Prefer returning node properties (name/title/label) over node ids.
- End with LIMIT 20.
- If the question cannot be answered from this schema, return exactly: INVALID`;

  try {
    const res = await runCloudflareAI(companyName, getLlmModel(companyName), {
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 200,
    });
    const cypher = String(res.response || "").trim();
    return isSafeCypher(cypher) ? cypher : null;
  } catch {
    return null;
  }
}

/**
 * Safety gate for generated Cypher. A generated query must:
 *  1. start with a read clause (MATCH / OPTIONAL MATCH / UNWIND),
 *  2. contain no destructive clause (CREATE/MERGE/DELETE/SET/REMOVE/DROP/
 *     FOREACH/CALL/LOAD CSV — see DESTRUCTIVE),
 *  3. be a single statement (no second semicolon).
 * The driver's executeRead is the hard backstop beyond this.
 */
export function isSafeCypher(cypher) {
  if (!cypher || typeof cypher !== "string") return false;
  const trimmed = cypher.trim();
  if (!trimmed || !trimmed.startsWith("MATCH") && !trimmed.startsWith("OPTIONAL MATCH") && !trimmed.startsWith("UNWIND")) {
    return false;
  }
  // Reject any destructive keyword anywhere in the statement.
  if (DESTRUCTIVE.test(trimmed)) return false;
  // Reject multiple statements (a second semicolon implies an injection).
  const firstSemicolon = trimmed.indexOf(";");
  if (firstSemicolon !== -1 && trimmed.slice(firstSemicolon + 1).trim() !== "") return false;
  return true;
}

/** Flatten a Neo4j record into readable "prop: value" text. */
function recordToText(record) {
  const parts = [];
  for (const key of record.keys) {
    const value = record.get(key);
    parts.push(`${key}: ${valueToString(value)}`);
  }
  return parts.join(", ");
}

function valueToString(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  // Nodes/relationships/arrays/maps — serialize shallowly.
  if (Array.isArray(value)) return `[${value.map(valueToString).join(", ")}]`;
  if (typeof value === "object") {
    const props = {};
    // Neo4j node/relationship instances expose .properties / .labels / .type
    if (typeof value.properties === "object" && value.properties) {
      for (const [k, v] of Object.entries(value.properties)) props[k] = valueToString(v);
    }
    if (value.labels) props._labels = value.labels.join(":");
    if (value.type) props._type = value.type;
    const entries = Object.keys(props).length
      ? props
      : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, valueToString(v)]));
    return JSON.stringify(entries);
  }
  return String(value);
}

/**
 * Run the (sanitized, read-only) Cypher and return up to GRAPH_MAX_ROWS as
 * formatted text. Any error → null (graph context is optional).
 */
async function runCypher(graph, cypher, question) {
  return withSession(graph, async (session) => {
    const result = await session.run(cypher, { q: question }, { timeout: CYPHER_TIMEOUT_MS });
    const rows = result.records.slice(0, GRAPH_MAX_ROWS);
    if (!rows.length) return null;
    let text = "";
    for (const [i, record] of rows.entries()) {
      const line = `[Graph ${i + 1}] ${sanitizeText(recordToText(record))}\n`;
      if ((text + line).length > GRAPH_MAX_CHARS) break;
      text += line;
    }
    return text.trim();
  });
}

// ------------------------------------------------------------------
// ORCHESTRATOR
// ------------------------------------------------------------------

/**
 * The GraphRAG step. Knowledge-aware path first (entity mentions → canonical
 * entities → neighborhood edges + accepted claims with evidence →
 * confidence-filtered context); legacy schema → Cypher path as a fallback for
 * structural questions. Returns { context, cypher?, method?, entities? } or
 * null when the graph isn't configured / nothing matched / anything fails.
 *
 * opts.database overrides the stored NEO4J_DATABASE (assistant-bound graph
 * resource); opts.enabled=false skips the step entirely (assistant with
 * enable_graph_context off — company-level graph config then stays unused);
 * opts.kbKey optionally scopes entity detection to a single knowledge base.
 */
export async function retrieveGraphContext(question, companyName, { database = null, enabled = true, kbKey = null } = {}) {
  if (!enabled) return null;
  const graph = getGraphConfig(companyName, database);
  if (!graph) return null;
  try {
    // Phase 4 — knowledge-aware retrieval (fixed templates, entity-grounded).
    const knowledge = await retrieveViaKnowledge(graph, question, companyName, kbKey);
    if (knowledge) return knowledge;

    // Fallback — structural questions (aggregates, counts, "what exists").
    const schema = await fetchGraphSchema(graph);
    if (!schema.labels.length && !schema.relationshipTypes.length) return null; // empty graph
    const cypher = await generateCypher(question, schema, companyName);
    if (!cypher) return null;
    const context = await runCypher(graph, cypher, question);
    if (!context) return null;
    return { context: `\n[Graph Knowledge]\n${context}`, cypher, method: "cypher" };
  } catch {
    return null; // graph context is best-effort — never fail the ask
  }
}