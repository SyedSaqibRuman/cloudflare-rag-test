// --------------------------
// MYSQL CONNECTION TEST (AI Gateway platform layer)
// `node test.js` — verifies .env MySQL config, connectivity, schema state,
// and migration status. Exits 0 on success, 1 on failure. Never prints the
// password. (The old scheduler "testing" job handler lives in cron/testing-job.js.)
// --------------------------
import { env } from "../env.js";
import { isMysqlConfigured, getPool, closePool } from "../mysql/pool.js";
import { pendingMigrations } from "../mysql/migrate.js";

async function main() {
  console.log("🔌 MySQL connection test");
  console.log("────────────────────────");
  console.log(
    `  Host:     ${env.MYSQL_HOST || "(not set)"}:${env.MYSQL_PORT || "3306"}`
  );
  console.log(`  Database: ${env.MYSQL_DATABASE || "(not set)"}`);
  console.log(`  User:     ${env.MYSQL_USER || "(not set)"}`);

  if (!isMysqlConfigured()) {
    console.error("❌ MySQL is not configured. Set MYSQL_HOST/USER/DATABASE in .env");
    process.exit(1);
  }

  try {
    const pool = await getPool();
    const [[{ version }]] = await pool.query("SELECT VERSION() AS version");
    console.log(`✅ Connected — server version: ${version}`);

    const [rows] = await pool.query(
      `SELECT COUNT(*) AS n FROM information_schema.tables
       WHERE table_schema = DATABASE()`
    );
    const tables = Object.values(rows[0])[0];
    console.log(`📦 Tables/views present: ${tables}`);

    const pending = await pendingMigrations(pool);
    if (pending.length === 0) {
      console.log("✅ Migrations: up to date (0 pending).");
    } else {
      console.log(`⚠️  Migrations: ${pending.length} pending — run: node mysql/migrate.js`);
      for (const { file } of pending) console.log(`   - ${file}`);
    }

    await closePool();
    console.log("✅ All checks passed.");
    process.exit(0);
  } catch (err) {
    console.error(`❌ Connection failed: ${err.message}`);
    await closePool().catch(() => {});
    process.exit(1);
  }
}

main();
