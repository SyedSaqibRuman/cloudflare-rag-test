// --------------------------
// GRAPH RAG — query-time Neo4j context injection
// Optional pipeline step: when the company has a Neo4j connection configured
// (NEO4J_URI + NEO4J_USERNAME + NEO4J_PASSWORD, plus NEO4J_DATABASE), the ask
// path generates a read-only Cypher query from the user's question, runs it
// against the graph, and formats the results as extra context alongside the
// vector chunks — so the AI can answer from relationship data, not just
// chunks. Best-effort by design: any failure (bad config, LLM, network,
// invalid Cypher) yields NO graph context, never an ask error.
//
// Safety:
//  - All queries run inside session.executeRead (the driver refuses writes).
//  - Generated Cypher is sanitized: only MATCH/WITH/WHERE/RETURN/ORDER BY/
//    LIMIT/UNWIND/OPTIONAL MATCH tokens survive; destructive clauses
//    (CREATE, MERGE, DELETE, DETACH, SET, REMOVE, DROP, FOREACH, CALL db.*)
//    and multiple statements are rejected before execution.
//  - Result rows are capped (GRAPH_MAX_ROWS) and truncated to a char budget.
// --------------------------
import { getCompanyConfig } from "../config/index.js";
import { runCloudflareAI } from "../services/cloudflare_ai.js";
import { getLlmModel } from "./llm.js";
import { sanitizeText } from "./context.js";

const GRAPH_MAX_ROWS = 20;
const GRAPH_MAX_CHARS = 2500;
const CYPHER_TIMEOUT_MS = 15_000;

// Destructive / non-read Cypher clauses that must never reach the graph.
// The driver's executeRead mode is the hard backstop (write transactions are
// refused); this blacklist is the first line so we don't even try.
const DESTRUCTIVE = /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|FOREACH|CALL|LOAD\s+CSV)\b/i;

/**
 * The company's Neo4j connection from the RAG config store, or null when the
 * graph isn't configured (no URI/username/password). Database name is
 * optional — Aura defaults to 'neo4j'. `database` overrides the stored
 * NEO4J_DATABASE (used when a selected assistant points at a specific graph
 * resource).
 */
export function getGraphConfig(companyName, database = null) {
  const config = getCompanyConfig(companyName);
  if (!config) return null;
  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE } = config;
  if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) return null;
  return {
    uri: NEO4J_URI,
    username: NEO4J_USERNAME,
    password: NEO4J_PASSWORD,
    database: database || NEO4J_DATABASE || "neo4j",
  };
}

/** True when the company has a usable Neo4j connection in its config store. */
export function graphEnabled(companyName) {
  return getGraphConfig(companyName) !== null;
}

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

/**
 * The GraphRAG step: schema → Cypher → execute → formatted context.
 * Returns { context } or null when the graph isn't configured / anything fails.
 * opts.database overrides the stored NEO4J_DATABASE (assistant-bound graph
 * resource); opts.enabled=false skips the step entirely (assistant with
 * enable_graph_context off — company-level graph config then stays unused).
 */
export async function retrieveGraphContext(question, companyName, { database = null, enabled = true } = {}) {
  if (!enabled) return null;
  const graph = getGraphConfig(companyName, database);
  if (!graph) return null;
  try {
    const schema = await fetchGraphSchema(graph);
    if (!schema.labels.length && !schema.relationshipTypes.length) return null; // empty graph
    const cypher = await generateCypher(question, schema, companyName);
    if (!cypher) return null;
    const context = await runCypher(graph, cypher, question);
    if (!context) return null;
    return { context: `\n[Graph Knowledge]\n${context}`, cypher };
  } catch {
    return null; // graph context is best-effort — never fail the ask
  }
}
