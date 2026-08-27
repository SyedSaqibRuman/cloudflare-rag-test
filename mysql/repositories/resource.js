// --------------------------
// resource — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";
import { mapRow } from "./helpers.js";

// ------------------------------------------------------------------
export const ResourceRepository = {
  async listByCompany(companyId, { resourceType = null } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT pr.id, pr.credential_id, pr.provider_id, pr.environment_id,
              pr.resource_type, pr.resource_key, pr.resource_name,
              pr.external_resource_id, pr.external_resource_url,
              pr.external_region, pr.description, pr.config,
              pr.status, pr.is_default, pr.is_active,
              pr.last_health_check_at, pr.last_health_status,
              pr.health_check_error, pr.provisioned_at, pr.last_synced_at,
              pr.created_at,
              c.credential_key, c.credential_name,
              p.provider_key, p.provider_name,
              ce.env_key
         FROM provider_resources pr
         JOIN credentials c ON c.id = pr.credential_id
         JOIN providers p  ON p.id = pr.provider_id
         LEFT JOIN company_environments ce ON ce.id = pr.environment_id
        WHERE pr.company_id = ? AND pr.deleted_at IS NULL
          ${resourceType ? "AND pr.resource_type = ?" : ""}
        ORDER BY pr.resource_name`,
      resourceType ? [companyId, resourceType] : [companyId]
    );
    return rows.map(mapRow);
  },

  /** Find by id with credential/provider/env denormalized (for ownership checks + UI). */
  async findById(id) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT pr.id, pr.credential_id, pr.company_id, pr.provider_id,
              pr.environment_id, pr.resource_type, pr.resource_key,
              pr.resource_name, pr.external_resource_id,
              pr.external_resource_url, pr.external_region, pr.description,
              pr.config, pr.status, pr.is_default, pr.is_active,
              pr.last_health_check_at, pr.last_health_status,
              pr.health_check_error, pr.provisioned_at, pr.last_synced_at,
              pr.created_at,
              c.credential_key, c.credential_name,
              p.provider_key, p.provider_name,
              ce.env_key
         FROM provider_resources pr
         JOIN credentials c ON c.id = pr.credential_id
         JOIN providers p  ON p.id = pr.provider_id
         LEFT JOIN company_environments ce ON ce.id = pr.environment_id
        WHERE pr.id = ? AND pr.deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  /**
   * Create a provider resource under a credential (Phase D of the lifecycle:
   * company → credential → resource). resource_key uniqueness is enforced by
   * the uk_company_resource_key index; callers map ER_DUP_ENTRY to a 409.
   */
  async create(companyId, input) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO provider_resources
         (credential_id, company_id, provider_id, environment_id,
          resource_type, resource_key, resource_name,
          external_resource_id, external_resource_url, external_region,
          description, config, status, is_default, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.credentialId,
        companyId,
        input.providerId,
        input.environmentId ?? null,
        input.resourceType,
        input.resourceKey,
        input.resourceName,
        input.externalResourceId ?? null,
        input.externalResourceUrl ?? null,
        input.externalRegion ?? null,
        input.description ?? null,
        input.config ? JSON.stringify(input.config) : null,
        input.status ?? "active",
        input.isDefault ?? false,
        input.isActive ?? true,
        input.createdBy ?? null,
      ]
    );
    return Number(result.insertId);
  },

  /** Partial update — only present keys are written. */
  async update(id, input) {
    const pool = await getPool();
    const columnByKey = {
      resourceName: "resource_name",
      externalResourceId: "external_resource_id",
      externalResourceUrl: "external_resource_url",
      externalRegion: "external_region",
      description: "description",
      config: "config",
      status: "status",
      isDefault: "is_default",
      isActive: "is_active",
    };
    const sets = [];
    const args = [];
    for (const [key, column] of Object.entries(columnByKey)) {
      if (input[key] !== undefined) {
        sets.push(`\`${column}\` = ?`);
        args.push(input[key] !== null && typeof input[key] === "object" ? JSON.stringify(input[key]) : input[key]);
      }
    }
    if (sets.length === 0) return false;
    args.push(id);
    const [result] = await pool.query(
      `UPDATE provider_resources SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
      args
    );
    return result.affectedRows > 0;
  },

  /** Soft delete — the row is no longer resolvable (credentials keep theirs). */
  async remove(id) {
    const pool = await getPool();
    const [result] = await pool.query(
      `UPDATE provider_resources SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    return result.affectedRows > 0;
  },

  /** Count active resources of a type under one credential (max_per_credential gate). */
  async countByCredentialType(credentialId, resourceType) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c
         FROM provider_resources
        WHERE credential_id = ? AND resource_type = ?
          AND is_active = TRUE AND deleted_at IS NULL`,
      [credentialId, resourceType]
    );
    return rows[0]?.c ?? 0;
  },

  async grantModelAccess(companyId, credentialId, providerModelId, opts = {}) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO credential_model_access
         (credential_id, provider_model_id, company_id,
          rate_limit_per_min, monthly_quota_tokens, is_enabled,
          is_default_for_category, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
          is_enabled = VALUES(is_enabled),
          rate_limit_per_min = VALUES(rate_limit_per_min),
          monthly_quota_tokens = VALUES(monthly_quota_tokens)`,
      [
        credentialId,
        providerModelId,
        companyId,
        opts.rateLimitPerMin ?? null,
        opts.monthlyQuotaTokens ?? null,
        opts.isEnabled ?? true,
        opts.isDefaultForCategory ?? false,
        opts.notes ?? null,
      ]
    );
    return Number(result.insertId);
  },

  /**
   * Bulk-enable/disable every model-access grant of a company's credentials
   * for one provider (9Router "Disable All" on the Available Models card).
   * Rows that don't exist yet have nothing to disable — grants are created
   * by grantModelAccess on first grant.
   * @returns {Promise<number>} affected grant rows
   */
  async setModelAccessByProvider(companyId, providerId, { enabled }) {
    const pool = await getPool();
    const [result] = await pool.query(
      `UPDATE credential_model_access cma
          JOIN credentials c ON c.id = cma.credential_id
         SET cma.is_enabled = ?
       WHERE cma.company_id = ?
         AND c.provider_id = ?
         AND c.deleted_at IS NULL
         AND cma.deleted_at IS NULL`,
      [enabled ? 1 : 0, companyId, providerId]
    );
    return result.affectedRows ?? 0;
  },

  async listModelAccess(credentialId) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT cma.id, cma.provider_model_id, pm.model_key, pm.model_name,
              pm.category, cma.is_enabled, cma.is_default_for_category,
              cma.rate_limit_per_min, cma.rate_limit_per_day,
              cma.monthly_quota_tokens, cma.monthly_quota_used_tokens,
              pmp.input_price_per_million, pmp.output_price_per_million
         FROM credential_model_access cma
         JOIN provider_models pm ON pm.id = cma.provider_model_id
         LEFT JOIN provider_model_pricing pmp
                ON pmp.provider_model_id = pm.id AND pmp.effective_to IS NULL
        WHERE cma.credential_id = ? AND cma.deleted_at IS NULL`,
      [credentialId]
    );
    return rows;
  },

  /** All rows (incl. soft-deleted) referencing a provider — purge helper.
   *  Same deleted_at caveat as CredentialRepository.listByProvider. */
  async listByProvider(providerId) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, company_id, resource_key, deleted_at
         FROM provider_resources
        WHERE provider_id = ?`,
      [providerId]
    );
    return rows.map(mapRow);
  },

  /** Hard delete — force provider removal. */
  async removePermanent(id) {
    const pool = await getPool();
    const [result] = await pool.query(`DELETE FROM provider_resources WHERE id = ?`, [id]);
    return result.affectedRows > 0;
  },
};

