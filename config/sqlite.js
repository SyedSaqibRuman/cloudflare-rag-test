// --------------------------
// SQLITE PERSISTENCE LAYER
// Each company gets its own SQLite database file: db/<companyName>.db
// Stores only that company's config keys as a key/value table.
// --------------------------
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { SENSITIVE_KEY_SET, encryptSecret, decryptSecret } from "./encryption.js";

const DB_DIR = path.resolve(process.cwd(), "db");

function ensureDir() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

export function companyDbPath(name) {
  return path.join(DB_DIR, `${name}.db`);
}

function openDb(name) {
  ensureDir();
  return new DatabaseSync(companyDbPath(name));
}

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
}

/**
 * Load a company's config from its SQLite database.
 * Returns null if the database does not exist.
 */
export function loadCompanyConfig(name) {
  if (!fs.existsSync(companyDbPath(name))) return null;

  const db = openDb(name);
  try {
    ensureSchema(db);
    const rows = db.prepare("SELECT key, value FROM config").all();
    const config = {};
    for (const row of rows) {
      let value;
      try {
        value = JSON.parse(row.value);
      } catch {
        value = row.value;
      }
      if (SENSITIVE_KEY_SET.has(row.key) && typeof value === "string") {
        try {
          value = decryptSecret(value);
        } catch (err) {
          throw new Error(`Failed to load credentials for company '${name}' (${row.key}): ${err.message}`);
        }
      }
      config[row.key] = value;
    }
    return config;
  } finally {
    db.close();
  }
}

/**
 * Upsert a company's entire config into its SQLite database.
 */
export function saveCompanyConfig(name, config) {
  const db = openDb(name);
  try {
    ensureSchema(db);
    const upsert = db.prepare(
      `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    const del = db.prepare("DELETE FROM config WHERE key = ?");
    db.exec("BEGIN");
    const seen = new Set();
    for (const [key, value] of Object.entries(config)) {
      // Sensitive values (provider credentials, ask API key) are encrypted
      // before hitting the file — plaintext only ever lives in memory.
      const stored = SENSITIVE_KEY_SET.has(key) && typeof value === "string" ? encryptSecret(value) : value;
      upsert.run(key, JSON.stringify(stored));
      seen.add(key);
    }
    // Remove rows whose keys are no longer part of the config (e.g. cleared credentials).
    for (const row of db.prepare("SELECT key FROM config").all()) {
      if (!seen.has(row.key)) del.run(row.key);
    }
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* best effort */ }
    throw err;
  } finally {
    db.close();
  }
}

/**
 * List company names that have a SQLite database file.
 */
export function listCompanyDbs() {
  ensureDir();
  return fs
    .readdirSync(DB_DIR)
    .filter((f) => f.endsWith(".db"))
    .map((f) => f.replace(/\.db$/, ""));
}

/**
 * Remove a company's SQLite database file.
 */
export function deleteCompanyDb(name) {
  const file = companyDbPath(name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/**
 * Remove all company SQLite database files.
 */
export function clearAllCompanyDbs() {
  for (const name of listCompanyDbs()) {
    deleteCompanyDb(name);
  }
}
