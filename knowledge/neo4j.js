// --------------------------
// NEO4J SESSION UTILITIES — knowledge layer I/O seam.
// Every knowledge service opens sessions through here so connection
// handling, timeouts, and close semantics live in one place. The driver is
// lazy-imported so modules that import the knowledge layer still load when
// neo4j-driver is not installed (tests / CLI).
// --------------------------

const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 10_000;

/** Resolve a promise or reject after `ms`. Losing promise never rejects unhandled. */
export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Open a driver + session for one knowledge operation.
 * @param {object} graph  { uri, username, password, database } from getGraphConfig
 * @param {object} [opts]
 * @param {boolean} [opts.write]  WRITE vs READ access mode
 * @returns {Promise<{ driver: object, session: object, close: () => Promise<void> }>}
 */
export async function openKnowledgeSession(graph, { write = false } = {}) {
  const neo4j = (await import("neo4j-driver")).default;
  const driver = neo4j.driver(graph.uri, neo4j.auth.basic(graph.username, graph.password), {
    connectionTimeout: CONNECT_TIMEOUT_MS,
    disableLosslessIntegers: true,
  });
  const session = driver.session({
    database: graph.database || "neo4j",
    defaultAccessMode: write ? neo4j.session.WRITE : neo4j.session.READ,
  });
  return {
    driver,
    session,
    async close() {
      await withTimeout(session.close(), CLOSE_TIMEOUT_MS, "Neo4j session.close").catch(() => {});
      await withTimeout(driver.close(), CLOSE_TIMEOUT_MS, "Neo4j driver.close").catch(() => {});
    },
  };
}

/**
 * Run `fn(session)` against the graph and guarantee cleanup.
 * @param {object} graph
 * @param {object} [opts]
 * @param {boolean} [opts.write]
 * @param {(session: object) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withKnowledgeSession(graph, opts, fn) {
  const { session, close } = await openKnowledgeSession(graph, opts);
  try {
    return await fn(session);
  } finally {
    await close();
  }
}

/** Run a single query with the shared per-query timeout. */
export function runQuery(session, cypher, params = {}) {
  return withTimeout(session.run(cypher, params), QUERY_TIMEOUT_MS, "Neo4j query");
}

/**
 * Convert a Neo4j record into a plain serializable object. Node values become
 * { _elementId, _labels, _props } and relationship values become
 * { _elementId, _type, _props } so callers never touch driver internals.
 * @param {object} record
 * @returns {Object<string, unknown>}
 */
export function recordToPlain(record) {
  const out = {};
  for (const key of record.keys) {
    out[key] = valueToPlain(record.get(key));
  }
  return out;
}

function valueToPlain(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // neo4j-driver Node / Relationship
    if (typeof value.elementId === "string") {
      const props = {};
      const entries = value.properties ? Object.entries(value.properties) : [];
      for (const [k, v] of entries) props[k] = valueToPlain(v);
      if (value.labels) return { _elementId: value.elementId, _labels: value.labels, ...props };
      if (value.type) return { _elementId: value.elementId, _type: value.type, ...props };
    }
    if (typeof value.toNumber === "function" && value.integerLike) return value.toNumber();
    if (Array.isArray(value)) return value.map(valueToPlain);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, valueToPlain(v)]));
    }
  }
  return value;
}
