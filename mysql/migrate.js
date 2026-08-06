// --------------------------
// MIGRATION RUNNER
// Applies migrations/*.sql in filename order, tracking each in the
// schema_migrations table. Migration files may use mysql-client DELIMITER
// blocks (stored procedures); the runner parses statements itself (splitting
// on the active delimiter, default ';') so DELIMITER is handled without
// multipleStatements. Idempotent — safe to re-run, and applied migrations are
// checksummed so editing one fails loudly (add a new migration instead).
//
//   node mysql/migrate.js            # apply all pending migrations
//   node mysql/migrate.js --dry-run  # list pending without applying
//   MIGRATIONS_DIR=/path node ...    # use a different migrations folder
// --------------------------
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import { fileURLToPath } from "url";
import { getPool } from "./pool.js";
import { env } from "../env.js";

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version      VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checksum     VARCHAR(64)  NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function listMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
}

/**
 * Split a migration file into executable statements, honoring mysql-client
 * DELIMITER directives (used to define stored procedures). `DELIMITER` lines
 * are consumed and never sent to the server.
 */
export function parseStatements(sql) {
  const statements = [];
  let current = "";
  let delimiter = ";";
  for (const rawLine of sql.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("DELIMITER ")) {
      delimiter = line.slice("DELIMITER ".length).trim();
      continue;
    }
    current += rawLine + "\n";
    if (line.endsWith(delimiter)) {
      // drop the terminator itself ("END //" → "END")
      const idx = current.lastIndexOf(delimiter);
      if (idx !== -1) current = current.slice(0, idx);
      statements.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter((s) => s.length > 0);
}

export async function pendingMigrations(pool) {
  await ensureMigrationsTable(pool);
  const [rows] = await pool.query("SELECT version, checksum FROM schema_migrations");
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));
  const pending = [];
  for (const file of listMigrations()) {
    const body = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const checksum = crypto.createHash("sha256").update(body, "utf8").digest("hex");
    if (applied.has(file) && applied.get(file) !== checksum) {
      throw new Error(
        `Migration ${file} was applied with a different checksum. Never edit an applied migration — add a new one.`
      );
    }
    if (!applied.has(file)) pending.push({ file, body, checksum });
  }
  return pending;
}

/**
 * MariaDB rejects foreign keys on partitioned tables (MySQL 8 accepts them).
 * When the target server is MariaDB, strip the PARTITION BY RANGE clauses so
 * the v5 DDL applies unchanged everywhere else.
 */
function stripPartitionClauses(sql) {
  return sql.replace(
    /  PARTITION BY RANGE\s*\(.*?\)\s*\(.*?p_future VALUES LESS THAN MAXVALUE\s*\);/gs,
    ";"
  );
}

async function detectMariaDB(conn) {
  const [rows] = await conn.query("SELECT VERSION() AS version");
  return /mariadb/i.test(rows[0].version);
}

/**
 * Apply all pending migrations on a dedicated connection (pool connections
 * are reserved for queries; migrations are one-off DDL).
 */
export async function migrate() {
  const pool = await getPool();
  const pending = await pendingMigrations(pool);
  if (pending.length === 0) {
    console.log("✅ MySQL schema is up to date (0 pending migrations).");
    return { applied: [] };
  }

  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST,
    port: parseInt(env.MYSQL_PORT, 10),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD || "",
    database: env.MYSQL_DATABASE,
    timezone: "Z",
    dateStrings: true,
  });

  const isMariaDB = await detectMariaDB(conn);
  if (isMariaDB) {
    console.log("⚠️  Server is MariaDB — stripping PARTITION BY RANGE clauses (MariaDB forbids FKs on partitioned tables).");
  }

  const applied = [];
  try {
    for (const { file, body, checksum } of pending) {
      console.log(`⚙️  Applying migration ${file} ...`);
      const sql = isMariaDB ? stripPartitionClauses(body) : body;
      const statements = parseStatements(sql);
      try {
        for (const statement of statements) {
          await conn.query(statement);
        }
        await conn.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)",
          [file, checksum]
        );
        applied.push(file);
      } catch (err) {
        console.error(`❌ Migration ${file} failed: ${err.message}`);
        throw err;
      }
    }
    console.log(`✅ Applied ${applied.length} migration(s).`);
    return { applied };
  } finally {
    await conn.end();
  }
}

async function main() {
  const pool = await getPool();
  if (process.argv.includes("--dry-run")) {
    const pending = await pendingMigrations(pool);
    if (pending.length === 0) {
      console.log("✅ No pending migrations.");
    } else {
      console.log(`Pending (${pending.length}):`);
      for (const { file } of pending) console.log(`  ${file}`);
    }
    return;
  }
  await migrate();
  await pool.end();
}

// Run directly: node mysql/migrate.js
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}
