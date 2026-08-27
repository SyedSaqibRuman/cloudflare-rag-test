// --------------------------
// provider — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";
import { mapRow } from "./helpers.js";

// ------------------------------------------------------------------
export const ProviderRepository = {
  async list() {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, provider_key, provider_name, primary_service_category,
              website_url, documentation_url, logo_url, default_api_base_url,
              auth_type, auth_header_name, api_key_format_regex, is_active,
              round_robin_enabled
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
              auth_type, auth_header_name, api_key_format_regex, is_active,
              round_robin_enabled
         FROM providers
        WHERE provider_key = ?`,
      [providerKey]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  /** Duplicate gate for POST /providers — only *active* providers block a key,
   * so a soft-deleted provider's key can be recreated. */
  async activeByKey(providerKey) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, provider_key FROM providers WHERE provider_key = ? AND is_active = TRUE`,
      [providerKey]
    );
    return rows[0] || null;
  },

  /** Hard delete — catalog child tables CASCADE, but `credentials` and
   * `provider_resources` RESTRICT on provider_id, so deleting a provider those
   * rows reference throws ER_ROW_IS_REFERENCED_2 (caller maps it to a 409).
   * Hard (not is_active = FALSE) so the key can be reused: provider_key is a
   * plain UNIQUE that a soft-deleted row would keep blocked (D10). */
  async remove(providerKey) {
    const pool = await getPool();
    const [result] = await pool.query(`DELETE FROM providers WHERE provider_key = ?`, [providerKey]);
    return result.affectedRows > 0;
  },

  async create(input) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO providers
         (provider_key, provider_name, primary_service_category,
          website_url, documentation_url, default_api_base_url,
          auth_type, auth_header_name, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.providerKey,
        input.providerName,
        input.category,
        input.websiteUrl ?? null,
        input.documentationUrl ?? null,
        input.defaultApiBaseUrl ?? null,
        input.authType ?? "bearer_token",
        input.authHeaderName ?? "Authorization",
        input.isActive ?? true,
      ]
    );
    return result.insertId;
  },

  /**
   * Update a provider's editable metadata (provider_key is the route identity
   * and never changes). Partial updates merge over the stored row — only keys
   * present in `input` are written.
   * @returns {Promise<boolean>} true when a row was updated
   */
  async update(providerKey, input) {
    const pool = await getPool();
    const columnByKey = {
      providerName: "provider_name",
      category: "primary_service_category",
      authType: "auth_type",
      websiteUrl: "website_url",
      documentationUrl: "documentation_url",
      defaultApiBaseUrl: "default_api_base_url",
      isActive: "is_active",
      roundRobinEnabled: "round_robin_enabled",
    };
    const sets = [];
    const args = [];
    for (const [key, column] of Object.entries(columnByKey)) {
      if (input[key] !== undefined) {
        sets.push(`\`${column}\` = ?`);
        args.push(input[key]);
      }
    }
    if (sets.length === 0) return false;
    args.push(providerKey);
    const [result] = await pool.query(`UPDATE providers SET ${sets.join(", ")} WHERE provider_key = ?`, args);
    return result.affectedRows > 0;
  },

  // Bulk variants for the registry loader (refreshRegistry) — one query for
  // ALL providers instead of a per-provider N+1. Rows carry provider_id for
  // in-memory grouping; these are the ONLY entry points for capabilities /
  // auth forms / resource templates (the old single-provider methods were
  // removed — every consumer goes through the cached registry).
  async capabilitiesByProviderIds(providerIds) {
    if (!providerIds.length) return [];
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT provider_id, capability_key, is_supported, config
         FROM provider_capabilities
        WHERE provider_id IN (?) AND is_active = TRUE`,
      [providerIds]
    );
    return rows.map(mapRow);
  },

  async authFormsByProviderIds(providerIds) {
    if (!providerIds.length) return [];
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT provider_id, field_name, field_label, field_type, field_placeholder,
              field_help_text, field_default_value, is_required,
              validation_regex, validation_min_length, validation_max_length,
              is_encrypted, encryption_storage_path, display_order,
              field_group, field_width, select_options, show_when
         FROM provider_auth_schemas
        WHERE provider_id IN (?) AND is_active = TRUE
        ORDER BY provider_id, field_group, display_order, field_name`,
      [providerIds]
    );
    return rows.map(mapRow);
  },

  async resourceTemplatesByProviderIds(providerIds) {
    if (!providerIds.length) return [];
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT provider_id, resource_type, display_name, description, icon_name,
              display_color, config_schema, is_required, is_default_enabled,
              max_per_credential, provision_endpoint_key, provision_method,
              provision_payload_schema, health_check_endpoint_key,
              health_check_interval_seconds, display_order
         FROM provider_resource_types
        WHERE provider_id IN (?) AND is_active = TRUE
        ORDER BY provider_id, display_order, resource_type`,
      [providerIds]
    );
    return rows.map(mapRow);
  },
};

