// --------------------------
// MYSQL CONNECTION POOL (AI Gateway platform layer)
// Lazy singleton — the pool is only created on first use, so the app boots
// fine without MySQL configured (routes return 503 "not configured"). Uses
// mysql2/promise; all callers await queries on `pool`.
// --------------------------
import { env } from "../env.js";

let pool = null;
let connecting = null;

/** True when MYSQL_HOST + MYSQL_DATABASE are set in .env. */
export function isMysqlConfigured() {
  return Boolean(env.MYSQL_HOST && env.MYSQL_DATABASE && env.MYSQL_USER);
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
    throw new Error(
      `MySQL is not configured. Set ${missing.join(", ")} in .env (see .env.example) and run: node mysql/migrate.js`
    );
  }
  if (pool) return pool;
  if (connecting) return connecting;

  connecting = (async () => {
    const mysql = await import("mysql2/promise");
    pool = mysql.createPool({
      host: env.MYSQL_HOST,
      port: parseInt(env.MYSQL_PORT, 10),
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD || "",
      database: env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      timezone: "Z",
      dateStrings: true,
    });
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

/** Quick connectivity probe — throws if the database is unreachable. */
export async function pingDb() {
  const p = await getPool();
  await p.query("SELECT 1");
}
