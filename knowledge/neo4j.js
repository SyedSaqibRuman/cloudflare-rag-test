// --------------------------
// NEO4J SESSION UTILITIES — knowledge layer I/O seam.
// Every knowledge service opens sessions through here so connection
// handling, timeouts, and close semantics live in one place. The driver is
// lazy-imported so modules that import the knowledge layer still load when
// neo4j-driver is not installed (tests / CLI).
//
// Drivers are POOLED per (uri, username, database) config instead of being
// created per operation. Neo4j Aura limits concurrent connections per
// account — creating a fresh driver (TCP + TLS + bolt handshake + routing
// table discovery) for every query intermittently exhausts it and fails
// with "No routing servers available". A shared driver multiplexes all
// sessions over one connection pool; refcounting closes it when the last
// session ends.
// --------------------------

import { logToFile } from "../utils/logger.js";

const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 10_000;
const IDLE_CLOSE_MS = 60_000; // close the shared driver after 1 min idle

/** Resolve a promise or reject after `ms`. Losing promise never rejects unhandled. */
export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// --------------------------
// 🔹 Shared driver pool (per uri+username+database)
// --------------------------
const sharedDrivers = new Map(); // key -> { driver, refCount, idleTimer }

function driverKey(graph) {
  return `${graph.uri}|${graph.username}|${graph.database || "neo4j"}`;
}

function clearIdleTimer(entry) {
  if (entry.idleTimer) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
}

/**
 * Schedule closing the shared driver once it has been idle for
 * IDLE_CLOSE_MS. Runs best-effort in the background.
 */
function scheduleIdleClose(key, entry) {
  clearIdleTimer(entry);
  entry.idleTimer = setTimeout(() => {
    if (entry.refCount > 0) return; // a new session grabbed it meanwhile
    sharedDrivers.delete(key);
    entry.driver
      .close()
      .then(() => logToFile("process.log", "🔗 Shared Neo4j driver closed (idle)"))
      .catch(() => {});
  }, IDLE_CLOSE_MS);
  // Never hold the event loop open just to close an idle driver.
  if (typeof entry.idleTimer.unref === "function") entry.idleTimer.unref();
}

/**
 * Test seam: replace the real neo4j-driver factory (mirrors the
 * `_usePoolForTests` convention in mysql/pool.js). Never call in app code.
 */
let testDriverFactory = null;
export function _setDriverFactoryForTests(fn) {
  testDriverFactory = fn;
}

async function createDriver(graph) {
  if (testDriverFactory) return testDriverFactory(graph);
  const neo4j = (await import("neo4j-driver")).default;
  return neo4j.driver(graph.uri, neo4j.auth.basic(graph.username, graph.password), {
    connectionTimeout: CONNECT_TIMEOUT_MS,
    disableLosslessIntegers: true,
  });
}

/**
 * Acquire the shared driver for this graph config, creating + verifying it
 * on first use (so a bad URI fails fast at open, not mid-query).
 */
async function acquireDriver(graph) {
  const key = driverKey(graph);
  let entry = sharedDrivers.get(key);
  if (!entry) {
    const driver = await createDriver(graph);
    // Fail fast on unreachable/misconfigured servers instead of letting the
    // first query hang until the per-query timeout.
    await withTimeout(driver.verifyConnectivity(), CONNECT_TIMEOUT_MS, "Neo4j connectivity check").catch((err) => {
      // Close and forget — the next call retries from scratch.
      driver.close().catch(() => {});
      throw new Error(`Neo4j connection failed: ${err.message}`);
    });
    entry = { driver, refCount: 0, idleTimer: null };
    sharedDrivers.set(key, entry);
  }
  clearIdleTimer(entry);
  entry.refCount++;
  return entry;
}

/** Release a previously acquired shared driver. */
function releaseDriver(graph, entry) {
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount === 0 && sharedDrivers.get(driverKey(graph)) === entry) {
    scheduleIdleClose(driverKey(graph), entry);
  }
}

/**
 * Close every pooled driver immediately (test/CLI teardown helper).
 * @returns {Promise<void>}
 */
export async function closeAllKnowledgeDrivers() {
  const entries = [...sharedDrivers.values()];
  sharedDrivers.clear();
  await Promise.all(entries.map((e) => e.driver.close().catch(() => {})));
}

/**
 * Open a driver + session for one knowledge operation.
 * @param {object} graph  { uri, username, password, database } from getGraphConfig
 * @param {object} [opts]
 * @param {boolean} [opts.write]  WRITE vs READ access mode
 * @returns {Promise<{ session: object, close: () => Promise<void> }>}
 */
export async function openKnowledgeSession(graph, { write = false } = {}) {
  const entry = await acquireDriver(graph);
  // neo4j.session.WRITE / READ are the string enums "WRITE" / "READ".
  const session = entry.driver.session({
    database: graph.database || "neo4j",
    defaultAccessMode: write ? "WRITE" : "READ",
  });
  return {
    session,
    async close() {
      await withTimeout(session.close(), CLOSE_TIMEOUT_MS, "Neo4j session.close").catch(() => {});
      releaseDriver(graph, entry);
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
