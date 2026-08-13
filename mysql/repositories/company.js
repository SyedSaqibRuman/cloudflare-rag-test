// --------------------------
// company — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";

// ------------------------------------------------------------------
export const CompanyRepository = {
  async list({ includeInactive = false } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, company_key, company_name, legal_name, email, billing_email,
              website, plan_tier, status, is_active,
              max_credentials, max_storage_gb, max_monthly_requests,
              max_knowledge_bases, max_assistants, created_at
         FROM companies
        WHERE deleted_at IS NULL
          ${includeInactive ? "" : "AND is_active = TRUE"}
        ORDER BY company_name`
    );
    return rows;
  },

  async findByKey(companyKey) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, company_key, company_name, legal_name, email, billing_email,
              website, plan_tier, status, is_active,
              max_credentials, max_storage_gb, max_monthly_requests,
              max_knowledge_bases, max_assistants, created_at
         FROM companies
        WHERE company_key = ? AND deleted_at IS NULL`,
      [companyKey]
    );
    return rows[0] || null;
  },

  async create(input) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO companies
         (company_key, company_name, email, plan_tier, max_knowledge_bases, max_assistants)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.companyKey,
        input.companyName,
        input.email || `${input.companyKey}@localhost`,
        input.planTier || "free",
        input.maxKnowledgeBases ?? 10,
        input.maxAssistants ?? 25,
      ]
    );
    return this.findByKey(input.companyKey);
  },

  async environments(companyId) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, env_key, env_name, description, is_production, is_active, sort_order
         FROM company_environments
        WHERE company_id = ? AND is_active = TRUE AND deleted_at IS NULL
        ORDER BY sort_order, env_key`,
      [companyId]
    );
    return rows;
  },

  /**
   * Seed the standard environments (Production/Staging/Development) for a
   * company that has none. Returns the environments after seeding.
   */
  async ensureDefaultEnvironments(companyId) {
    const pool = await getPool();
    const [existing] = await pool.query(
      `SELECT id FROM company_environments WHERE company_id = ? AND deleted_at IS NULL`,
      [companyId]
    );
    if (existing.length > 0) return this.environments(companyId);

    const defaults = [
      { envKey: "production", envName: "Production", isProduction: true, sortOrder: 10 },
      { envKey: "staging", envName: "Staging", isProduction: false, sortOrder: 20 },
      { envKey: "development", envName: "Development", isProduction: false, sortOrder: 30 },
    ];
    for (const d of defaults) {
      await pool.query(
        `INSERT INTO company_environments
           (company_id, env_key, env_name, is_production, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [companyId, d.envKey, d.envName, d.isProduction, d.sortOrder]
      );
    }
    return this.environments(companyId);
  },

  /** Create an environment (caller validates envKey uniqueness/name). */
  async createEnvironment(companyId, input) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO company_environments
         (company_id, env_key, env_name, description, is_production, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        input.envKey,
        input.envName,
        input.description ?? null,
        input.isProduction ?? false,
        input.sortOrder ?? 0,
      ]
    );
    return result.insertId;
  },

  /** Update an environment's metadata (env_key is immutable — recreate to rename). */
  async updateEnvironment(companyId, envKey, input) {
    const pool = await getPool();
    const [result] = await pool.query(
      `UPDATE company_environments
          SET env_name = ?, description = ?, is_production = ?, sort_order = ?
        WHERE company_id = ? AND env_key = ? AND is_active = TRUE AND deleted_at IS NULL`,
      [
        input.envName,
        input.description ?? null,
        input.isProduction ?? false,
        input.sortOrder ?? 0,
        companyId,
        envKey,
      ]
    );
    return result.affectedRows > 0;
  },

  /** Soft-delete an environment; credentials keep their row (resolve as unassigned). */
  async deleteEnvironment(companyId, envKey) {
    const pool = await getPool();
    const [result] = await pool.query(
      `UPDATE company_environments
          SET is_active = FALSE, deleted_at = NOW()
        WHERE company_id = ? AND env_key = ? AND is_active = TRUE AND deleted_at IS NULL`,
      [companyId, envKey]
    );
    return result.affectedRows > 0;
  },
};

