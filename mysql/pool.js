// --------------------------
// MYSQL CONNECTION POOL (AI Gateway platform layer)
// Lazy singleton — the pool is only created on first use, so the app boots
// fine without MySQL configured (routes return 503 "not configured"). Uses
// mysql2/promise; all callers await queries on `pool`.
//
// Tuned for REMOTE MySQL hosts (Hostinger, managed DBs, etc.): TCP keepalive
// + idle-connection reaping keep the pool from handing out sockets the server
// already closed (the classic `read ECONNRESET` on a stale pooled connection),
// a connectTimeout fails fast on an unreachable host, and query()/execute()
// retry ONCE on a dropped connection so transient resets don't 500 the API.
// --------------------------
import { env } from "../env.js";

let pool = null;
let connecting = null;

/** True when MYSQL_HOST + MYSQL_DATABASE are set in .env. */
export function isMysqlConfigured() {
  return Boolean(env.MYSQL_HOST && env.MYSQL_DATABASE && env.MYSQL_USER);
}

// ------------------------------------------------------------------
// Connection-lost handling
// ------------------------------------------------------------------

/** Error codes (and message patterns) that mean the socket died mid-flight. */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "ER_CONNECTION_LOST",
  "ER_CONNECTION_KILLED",
  "ER_SERVER_SHUTDOWN",
]);

/** True when a query failure is a dropped connection worth one retry. */
export function isTransientConnectionError(err) {
  return Boolean(
    err &&
      (TRANSIENT_CODES.has(err.code) ||
        /read ECONNRESET|socket hang up|write EPIPE|handshake inactivity timeout/i.test(String(err.message)))
  );
}

/**
 * Run an async fn, retrying exactly once when the failure is a dropped
 * connection. The mysql2 pool destroys the broken socket internally, so the
 * retry runs on a fresh connection. Non-transient errors pass through.
 */
export async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientConnectionError(err)) throw err;
    return fn();
  }
}

/**
 * Wrap a mysql2 pool so query()/execute() retry once on a dropped connection
 * while every other property/method (end, getConnection, on, …) passes
 * through untouched.
 */
function createRetryPool(p) {
  return new Proxy(p, {
    get(target, prop) {
      if (prop === "query") return (sql, params) => withRetry(() => target.query(sql, params));
      if (prop === "execute") return (sql, params) => withRetry(() => target.execute(sql, params));
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Get the shared promise pool. Creates it once, lazily.
 * @returns {Promise<import("mysql2/promise").Pool>}
 */
export async function getPool() {
  if (!isMysqlConfigured()) {
    const missing = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"].filter(
      (k) => !env[k]
    );
    const { ServiceUnavailableError } = await import("../shared/errors.js");
    throw new ServiceUnavailableError(
      `MySQL is not configured. Set ${missing.join(", ")} in .env (see .env.example) and run: node mysql/migrate.js`
    );
  }
  if (pool) return pool;
  if (connecting) return connecting;

  connecting = (async () => {
    const mysql = await import("mysql2/promise");
    pool = createRetryPool(
      mysql.createPool({
        host: env.MYSQL_HOST,
        port: parseInt(env.MYSQL_PORT, 10),
        user: env.MYSQL_USER,
        password: env.MYSQL_PASSWORD || "",
        database: env.MYSQL_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        // Remote-host hardening: keep the TCP socket alive, reap idle
        // connections before the server's wait_timeout kills them, and fail
        // fast (10s) instead of hanging when the host is unreachable.
        enableKeepAlive: true,
        // NOTE: keep the first keepalive probe OFF the handshake. With
        // keepAliveInitialDelay: 0 mysql2 enables keepalive with a 0ms initial
        // delay, which sends a probe immediately and can stall the MySQL
        // handshake against some hosts (observed on Hostinger MariaDB: the
        // pooled connection ETIMEDOUT while a plain connection succeeded).
        // 30s keeps idle-socket reaping working without probing mid-handshake.
        keepAliveInitialDelay: 30_000,
        maxIdle: 5,
        idleTimeout: 60_000,
        connectTimeout: 10_000,
        timezone: "Z",
        dateStrings: true,
        // MYSQL_SSL=true in .env for hosts that require TLS.
        ...(env.MYSQL_SSL === "true" ? { ssl: {} } : {}),
      })
    );
    return pool;
  })();

  try {
    return await connecting;
  } catch (err) {
    connecting = null;
    throw err;
  }
}

/** Close the pool (used by tests/scripts; no-op when never opened). */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    connecting = null;
  }
}

/**
 * Test seam — inject a fake pool so route/service tests can exercise
 * transaction flows without MySQL. Needed because ESM namespace bindings are
 * frozen: tests cannot stub the exported getPool directly. Pair with
 * closePool() in the test's cleanup (it calls end() on the injected object).
 * @param {object|null} fakePool  Object exposing getConnection()/end().
 */
export function _usePoolForTests(fakePool) {
  pool = fakePool;
  connecting = null;
}

/** Quick connectivity probe — throws if the database is unreachable. */
export async function pingDb() {
  const p = await getPool();
  await p.query("SELECT 1");
}
