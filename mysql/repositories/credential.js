// --------------------------
// credential — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";
import { mapRow } from "./helpers.js";

// ------------------------------------------------------------------
export const CredentialRepository = {
  /**
   * List a company's credentials. With `includeStored` the encrypted blob is
   * also selected so the route can decrypt NON-SECRET fields for the edit form
   * (password/secret values never leave the server — the route strips them).
   */
  async listByCompany(companyId, { includeInactive = false, includeStored = false } = {}) {
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
              ${includeStored ? ", c.encrypted_credentials, c.encryption_version" : ""}
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

  /** Fetch one credential row WITHOUT the encrypted blob (ownership checks, UI). */
  async findById(id) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, company_id, provider_id, environment_id, credential_key,
              credential_name, is_default, is_active
         FROM credentials
        WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  /** Fetch one credential WITH the encrypted blob + encryption version. */
  async findWithEncrypted(id) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, company_id, provider_id, environment_id, credential_key,
              credential_name, encrypted_credentials, encryption_version,
              config, priority, is_default, rotation_policy, auto_rotate_enabled
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
    // Recreate-after-delete: soft-deleted rows are invisible to the app but
    // still occupy the uk_company_provider_env_cred unique key. Permanently
    // purge any soft-deleted row that would collide with this insert.
    // Best-effort: an FK RESTRICT (a live assistant row still referencing the
    // deleted credential) keeps the row — the INSERT below then fails with
    // ER_DUP_ENTRY and the route surfaces a 409 instead.
    try {
      await pool.query(
        `DELETE FROM credentials
          WHERE company_id = ? AND provider_id = ?
            AND credential_key = ? AND deleted_at IS NOT NULL
            AND environment_id <=> ?`,
        [companyId, input.providerId, input.credentialKey, input.environmentId ?? null]
      );
    } catch {
      // A failed purge must not mask the real insert outcome (see above).
    }
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

  /**
   * Update credential metadata (name, environment, flags, is_active). An
   * optional `encryptedCredentials` blob is swapped in WITHOUT bumping the
   * rotation version (unlike `rotate`) — used for in-place edits of secret
   * values. Undefined inputs keep the stored value (is_active included), so
   * the 9Router-style enable/disable toggle only flips when the caller
   * actually passes a boolean.
   */
  async update(id, input) {
    const pool = await getPool();
    const [result] = await pool.query(
      `UPDATE credentials
          SET credential_name = ?,
              environment_id = ?,
              config = ?,
              priority = ?,
              is_default = ?,
              is_active = COALESCE(?, is_active),
              rotation_policy = ?,
              auto_rotate_enabled = ?,
              encrypted_credentials = COALESCE(?, encrypted_credentials),
              updated_by = ?, updated_at = NOW()
        WHERE id = ? AND deleted_at IS NULL`,
      [
        input.credentialName ?? null,
        input.environmentId ?? null,
        input.config ? JSON.stringify(input.config) : null,
        input.priority ?? null,
        input.isDefault ?? null,
        input.isActive ?? null,
        input.rotationPolicy ?? null,
        input.autoRotateEnabled ?? null,
        input.encryptedCredentials ?? null,
        input.updatedBy ?? null,
        id,
      ]
    );
    return result.affectedRows > 0;
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

  /** All rows (incl. soft-deleted) referencing a provider — purge helper.
   *  The provider FK is a hard RESTRICT that ignores deleted_at, so soft-deleted
   *  rows still block provider deletion until permanently removed. */
  async listByProvider(providerId) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, company_id, credential_key, deleted_at
         FROM credentials
        WHERE provider_id = ?`,
      [providerId]
    );
    return rows.map(mapRow);
  },

  /** Hard delete — force provider removal (bypasses the soft-delete above). */
  async removePermanent(id) {
    const pool = await getPool();
    const [result] = await pool.query(`DELETE FROM credentials WHERE id = ?`, [id]);
    return result.affectedRows > 0;
  },

  /**
   * Check if a model is allowed for a credential via credential_model_access.
   * Returns { allowed: boolean, access?: object, reason?: string }.
   */
  async checkModelAccess(credentialId, modelId) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT cma.id, cma.is_enabled, cma.rate_limit_per_min, cma.rate_limit_per_day,
              cma.monthly_quota_tokens, cma.monthly_quota_used_tokens,
              cma.is_default_for_category, cma.notes
         FROM credential_model_access cma
        WHERE cma.credential_id = ? AND cma.provider_model_id = ?`,
      [credentialId, modelId]
    );
    if (!rows.length) {
      return { allowed: false, reason: "No access grant found for this credential/model pair." };
    }
    const access = mapRow(rows[0]);
    if (!access.is_enabled) {
      return { allowed: false, access, reason: "Model access is disabled for this credential." };
    }
    if (access.monthly_quota_tokens && access.monthly_quota_used_tokens >= access.monthly_quota_tokens) {
      return { allowed: false, access, reason: "Monthly token quota exceeded." };
    }
    return { allowed: true, access };
  },
};

