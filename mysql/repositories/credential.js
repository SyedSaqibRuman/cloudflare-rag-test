// --------------------------
// credential — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";
import { json, mapRow } from "./helpers.js";

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
   * Update credential metadata (name, environment, flags). An optional
   * `encryptedCredentials` blob is swapped in WITHOUT bumping the rotation
   * version (unlike `rotate`) — used for in-place edits of secret values.
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
};

