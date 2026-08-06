// --------------------------
// REPOSITORY LAYER (MySQL)
// All SQL for the AI Gateway platform layer lives here, one repository per
// aggregate. Callers (services/routes) never write raw SQL — they use these
// functions. Row casing is snake_case (as stored); routes are responsible
// for shaping responses.
//
// JSON columns come back as strings from mysql2; the `json()` helper parses
// them so callers get plain objects.
// --------------------------
import { getPool } from "./pool.js";

function json(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function mapRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (k.includes("config") || k.includes("json") || k.endsWith("_schema") || k === "tools") {
      out[k] = json(v);
    }
  }
  return out;
}

// ------------------------------------------------------------------
// ProviderRepository — global catalog metadata
// ------------------------------------------------------------------
export const ProviderRepository = {
  async list() {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, provider_key, provider_name, primary_service_category,
              website_url, documentation_url, logo_url, default_api_base_url,
              auth_type, auth_header_name, api_key_format_regex, is_active
         FROM providers
        WHERE is_active = TRUE
        ORDER BY provider_name`
    );
    return rows.map(mapRow);
  },

  async findByKey(providerKey) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, provider_key, provider_name, primary_service_category,
              website_url, documentation_url, logo_url, default_api_base_url,
              auth_type, auth_header_name, api_key_format_regex, is_active
         FROM providers
        WHERE provider_key = ?`,
      [providerKey]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async capabilities(providerId) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT capability_key, is_supported, config
         FROM provider_capabilities
        WHERE provider_id = ? AND is_active = TRUE`,
      [providerId]
    );
    return rows.map(mapRow);
  },

  /** Auth-form fields (v_provider_auth_form equivalent), ordered for UI. */
  async authForm(providerId) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT field_name, field_label, field_type, field_placeholder,
              field_help_text, field_default_value, is_required,
              validation_regex, validation_min_length, validation_max_length,
              is_encrypted, encryption_storage_path, display_order,
              field_group, field_width, select_options, show_when
         FROM provider_auth_schemas
        WHERE provider_id = ? AND is_active = TRUE
        ORDER BY field_group, display_order, field_name`,
      [providerId]
    );
    return rows.map(mapRow);
  },

  /** Resource-provisioning templates (v_provider_resource_templates equivalent). */
  async resourceTemplates(providerId) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT resource_type, display_name, description, icon_name,
              display_color, config_schema, is_required, is_default_enabled,
              max_per_credential, provision_endpoint_key, provision_method,
              provision_payload_schema, health_check_endpoint_key,
              health_check_interval_seconds, display_order
         FROM provider_resource_types
        WHERE provider_id = ? AND is_active = TRUE
        ORDER BY display_order, resource_type`,
      [providerId]
    );
    return rows.map(mapRow);
  },
};

// ------------------------------------------------------------------
// ModelRepository — provider_models + current pricing
// ------------------------------------------------------------------
export const ModelRepository = {
  /** Active, non-deprecated models with their current (effective_to IS NULL) price. */
  async listByProvider(providerId, { includeDeprecated = false } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT pm.id, pm.model_key, pm.model_name, pm.model_family, pm.category,
              pm.supports_streaming, pm.supports_function_calling, pm.supports_vision,
              pm.max_context_window, pm.max_output_tokens, pm.is_deprecated,
              pmp.input_price_per_million, pmp.output_price_per_million,
              pmp.cached_input_price_per_million, pmp.billing_unit, pmp.price_currency
         FROM provider_models pm
         LEFT JOIN provider_model_pricing pmp
                ON pmp.provider_model_id = pm.id AND pmp.effective_to IS NULL
        WHERE pm.provider_id = ?
          AND pm.is_active = TRUE
          ${includeDeprecated ? "" : "AND pm.is_deprecated = FALSE"}
        ORDER BY pm.category, pm.model_name`,
      [providerId]
    );
    return rows.map(mapRow);
  },

  async findById(modelId) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, provider_id, model_key, model_name, model_family, category,
              supports_streaming, supports_function_calling, supports_vision,
              max_context_window, max_output_tokens, is_deprecated
         FROM provider_models
        WHERE id = ?`,
      [modelId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },
};

// ------------------------------------------------------------------
// CompanyRepository — tenant identity (companies + environments)
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
};

// ------------------------------------------------------------------
// CredentialRepository — tenant credentials (encrypted at rest)
// ------------------------------------------------------------------
export const CredentialRepository = {
  async listByCompany(companyId, { includeInactive = false } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT c.id, c.provider_id, p.provider_key, p.provider_name,
              c.environment_id, ce.env_key,
              c.credential_key, c.credential_name, c.description,
              c.config, c.endpoint_override_url, c.credential_type, c.priority,
              c.is_active, c.is_default,
              c.last_verified_at, c.last_verification_status, c.verification_error,
              c.last_test_latency_ms, c.last_rotated_at, c.next_rotation_at,
              c.rotation_policy, c.auto_rotate_enabled, c.expires_at,
              c.created_at, c.updated_at
         FROM credentials c
         JOIN providers p  ON p.id = c.provider_id
         LEFT JOIN company_environments ce ON ce.id = c.environment_id
        WHERE c.company_id = ?
          AND c.deleted_at IS NULL
          ${includeInactive ? "" : "AND c.is_active = TRUE"}
        ORDER BY c.is_default DESC, c.priority ASC, c.credential_name`,
      [companyId]
    );
    return rows.map(mapRow);
  },

  /**
   * Find the best credential for a company+provider+env. Default wins, then
   * lowest priority number, then most recently verified. Never returns the
   * encrypted blob unless `includeEncrypted` is set (verify/rotation only).
   */
  async resolve(companyId, providerId, envKey = null) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT c.id, c.credential_key, c.credential_name, c.provider_id,
              c.environment_id, ce.env_key, c.config, c.endpoint_override_url,
              c.credential_type, c.priority, c.is_default,
              c.last_verification_status, c.last_verified_at
         FROM credentials c
         LEFT JOIN company_environments ce ON ce.id = c.environment_id
        WHERE c.company_id = ? AND c.provider_id = ?
          AND c.is_active = TRUE AND c.deleted_at IS NULL
          AND (? IS NULL OR ce.env_key = ?)
        ORDER BY c.is_default DESC, c.priority ASC, c.last_verified_at DESC, c.created_at DESC
        LIMIT 1`,
      [companyId, providerId, envKey, envKey]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  /** Fetch one credential WITH the encrypted blob + encryption version. */
  async findWithEncrypted(id) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, company_id, provider_id, environment_id, credential_key,
              credential_name, encrypted_credentials, encryption_version
         FROM credentials
        WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  /**
   * Create a credential. `encryptedCredentials` must already be encrypted by
   * the CredentialService before calling this repository.
   */
  async create(companyId, input) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO credentials
         (company_id, provider_id, environment_id, credential_key, credential_name,
          description, encrypted_credentials, encryption_version, config,
          endpoint_override_url, credential_type, priority, is_default,
          rotation_policy, auto_rotate_enabled, created_source, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        input.providerId,
        input.environmentId ?? null,
        input.credentialKey,
        input.credentialName,
        input.description ?? null,
        input.encryptedCredentials,
        input.encryptionVersion ?? 1,
        input.config ? JSON.stringify(input.config) : null,
        input.endpointOverrideUrl ?? null,
        input.credentialType ?? "primary",
        input.priority ?? 100,
        input.isDefault ?? false,
        input.rotationPolicy ?? "manual",
        input.autoRotateEnabled ?? false,
        input.createdSource ?? "admin",
        input.createdBy ?? null,
      ]
    );
    return Number(result.insertId);
  },

  /** Replace the encrypted blob (rotation) and bump verification/rotation metadata. */
  async rotate(id, encryptedCredentials, { verifiedBy = null } = {}) {
    const pool = await getPool();
    const [result] = await pool.query(
      `UPDATE credentials
          SET encrypted_credentials = ?, encryption_version = encryption_version + 1,
              last_rotated_at = NOW(), updated_by = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [encryptedCredentials, verifiedBy, id]
    );
    return result.affectedRows > 0;
  },

  /** Record the outcome of a verification probe. */
  async recordVerification(id, { status, error = null, latencyMs = null, verifiedBy = null }) {
    const pool = await getPool();
    await pool.query(
      `UPDATE credentials
          SET last_verified_at = NOW(), last_verification_status = ?,
              verification_error = ?, last_test_latency_ms = ?,
              verified_by = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [status, error, latencyMs, verifiedBy, id]
    );
  },

  async remove(id) {
    const pool = await getPool();
    const [result] = await pool.query(
      "UPDATE credentials SET deleted_at = NOW() WHERE id = ?",
      [id]
    );
    return result.affectedRows > 0;
  },
};

// ------------------------------------------------------------------
// ResourceRepository — provider_resources + model access
// ------------------------------------------------------------------
export const ResourceRepository = {
  async listByCompany(companyId, { resourceType = null } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, credential_id, provider_id, environment_id, resource_type,
              resource_key, resource_name, external_resource_id,
              external_resource_url, external_region, description, config,
              status, is_default, is_active,
              last_health_check_at, last_health_status, health_check_error,
              provisioned_at, last_synced_at, created_at
         FROM provider_resources
        WHERE company_id = ? AND deleted_at IS NULL
          ${resourceType ? "AND resource_type = ?" : ""}
        ORDER BY resource_name`,
      resourceType ? [companyId, resourceType] : [companyId]
    );
    return rows.map(mapRow);
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
};

// ------------------------------------------------------------------
// AuditRepository — append-only audit trail
// ------------------------------------------------------------------
export const AuditRepository = {
  async log(entry) {
    const pool = await getPool();
    await pool.query(
      `INSERT INTO audit_logs
         (company_id, actor_type, actor_id, actor_ip, action,
          entity_type, entity_id, before_state, after_state, diff,
          request_id, reason, is_sensitive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.companyId ?? null,
        entry.actorType ?? "system",
        entry.actorId ?? null,
        entry.actorIp ?? null,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.beforeState ? JSON.stringify(entry.beforeState) : null,
        entry.afterState ? JSON.stringify(entry.afterState) : null,
        entry.diff ? JSON.stringify(entry.diff) : null,
        entry.requestId ?? null,
        entry.reason ?? null,
        entry.isSensitive ?? false,
      ]
    );
  },

  async listByCompany(companyId, { limit = 100 } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, actor_type, actor_id, actor_ip, action, entity_type,
              entity_id, reason, is_sensitive, created_at
         FROM audit_logs
        WHERE company_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
      [companyId, Math.min(Number(limit), 500)]
    );
    return rows.map(mapRow);
  },
};
