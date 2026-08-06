// --------------------------
// MYSQL PERSISTENCE LAYER (RAG config backend)
// Same storage contract as config/sqlite.js (loadCompanyConfig,
// saveCompanyConfig, listCompanyDbs, deleteCompanyDb) but backed by the
// MySQL `companies` + `company_config` tables (migration 002). Every call is
// async (mysql2/promise). Values keep the identical format and at-rest
// encryption as SQLite (config/codec.js) — plaintext only in memory.
// Selected by CONFIG_STORE=mysql in .env (default stays sqlite).
// --------------------------
import { getPool, isMysqlConfigured } from "../mysql/pool.js";
import { encodeStoredValue, decodeStoredValue } from "./codec.js";

/**
 * Get the company id for a company_key, creating the tenant row if missing
 * (mirrors SQLite's implicit db-file creation on first save). Config-driven
 * companies carry no billing data — email is nullable since migration 002.
 */
async function ensureCompanyId(name, config = {}) {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO companies (company_key, company_name, email)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE company_name = VALUES(company_name)`,
    [name, config.COMPANY_NAME || name, config.EMAIL || null]
  );
  const [rows] = await pool.query(
    `SELECT id FROM companies WHERE company_key = ? AND deleted_at IS NULL`,
    [name]
  );
  if (rows.length === 0) {
    // Company exists but is soft-deleted — restore it.
    await pool.query(
      `UPDATE companies SET deleted_at = NULL, company_name = ? WHERE company_key = ?`,
      [config.COMPANY_NAME || name, name]
    );
    const [restored] = await pool.query(
      `SELECT id FROM companies WHERE company_key = ?`,
      [name]
    );
    return restored[0].id;
  }
  return rows[0].id;
}

/**
 * Load a company's config from MySQL. Returns null if the company does not
 * exist (or is soft-deleted).
 */
export async function loadCompanyConfig(name) {
  if (!isMysqlConfigured()) return null;
  const pool = await getPool();
  const [rows] = await pool.query(
    `SELECT cc.config_key, cc.config_value
       FROM company_config cc
       JOIN companies c ON c.id = cc.company_id
      WHERE c.company_key = ? AND c.deleted_at IS NULL`,
    [name]
  );
  if (rows.length === 0) {
    // Distinguish "no such company" from "company with empty config".
    const [exists] = await pool.query(
      `SELECT id FROM companies WHERE company_key = ? AND deleted_at IS NULL`,
      [name]
    );
    if (exists.length === 0) return null;
  }
  const config = {};
  for (const row of rows) {
    config[row.config_key] = decodeStoredValue(row.config_key, row.config_value, name);
  }
  return config;
}

/**
 * Replace a company's entire config in MySQL (transactional).
 */
export async function saveCompanyConfig(name, config) {
  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const companyId = await ensureCompanyId(name, config);
    await conn.query(`DELETE FROM company_config WHERE company_id = ?`, [companyId]);
    for (const [key, value] of Object.entries(config)) {
      await conn.execute(
        `INSERT INTO company_config (company_id, config_key, config_value)
         VALUES (?, ?, ?)`,
        [companyId, key, JSON.stringify(encodeStoredValue(key, value))]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * List active company keys in MySQL.
 */
export async function listCompanyDbs() {
  if (!isMysqlConfigured()) return [];
  const pool = await getPool();
  const [rows] = await pool.query(
    `SELECT company_key FROM companies WHERE deleted_at IS NULL ORDER BY company_key`
  );
  return rows.map((r) => r.company_key);
}

/**
 * Remove a company from MySQL: soft-delete the tenant row (v5 convention)
 * and drop its config rows.
 */
export async function deleteCompanyDb(name) {
  if (!isMysqlConfigured()) return;
  const pool = await getPool();
  await pool.query(
    `UPDATE companies SET deleted_at = NOW() WHERE company_key = ?`,
    [name]
  );
  await pool.query(
    `DELETE cc FROM company_config cc
      JOIN companies c ON c.id = cc.company_id
     WHERE c.company_key = ?`,
    [name]
  );
}
