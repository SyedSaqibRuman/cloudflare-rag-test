// --------------------------
// endpoint — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";
import { json, mapRow } from "./helpers.js";

// ------------------------------------------------------------------
const ENDPOINT_SELECT = `SELECT pe.id, pe.provider_id, p.provider_key, p.provider_name,
                                pe.endpoint_key, pe.endpoint_name, pe.endpoint_url,
                                pe.http_method, pe.default_timeout_seconds,
                                pe.is_default, pe.is_active, pe.created_at, pe.updated_at
                           FROM provider_endpoints pe
                           JOIN providers p ON p.id = pe.provider_id`;

export const EndpointRepository = {
  async list({ providerId = null, providerKey = null } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `${ENDPOINT_SELECT}
        WHERE (? IS NULL OR pe.provider_id = ?)
          AND (? IS NULL OR p.provider_key = ?)
        ORDER BY p.provider_name, pe.is_default DESC, pe.endpoint_name`,
      [providerId, providerId, providerKey, providerKey]
    );
    return rows.map(mapRow);
  },

  async findById(id) {
    const pool = await getPool();
    const [rows] = await pool.query(`${ENDPOINT_SELECT} WHERE pe.id = ?`, [id]);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  /** Uniqueness gate for uk_provider_endpoint (provider_id, endpoint_key). */
  async findByKey(providerId, endpointKey) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `${ENDPOINT_SELECT} WHERE pe.provider_id = ? AND pe.endpoint_key = ?`,
      [providerId, endpointKey]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async create(providerId, input, conn) {
    const pool = conn ?? (await getPool());
    const [result] = await pool.query(
      `INSERT INTO provider_endpoints
         (provider_id, endpoint_key, endpoint_name, endpoint_url,
          http_method, default_timeout_seconds, is_default, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        providerId,
        input.endpointKey,
        input.endpointName,
        input.endpointUrl,
        input.httpMethod ?? "POST",
        input.defaultTimeoutSeconds ?? 30,
        input.isDefault ?? false,
        input.isActive ?? true,
      ]
    );
    return result.insertId;
  },

  async update(id, input, conn) {
    const pool = conn ?? (await getPool());
    const columnByKey = {
      endpointKey: "endpoint_key",
      endpointName: "endpoint_name",
      endpointUrl: "endpoint_url",
      httpMethod: "http_method",
      defaultTimeoutSeconds: "default_timeout_seconds",
      isDefault: "is_default",
      isActive: "is_active",
    };
    const sets = [];
    const args = [];
    for (const [key, column] of Object.entries(columnByKey)) {
      if (input[key] !== undefined) {
        sets.push(`\`${column}\` = ?`);
        args.push(input[key]);
      }
    }
    if (sets.length === 0) return;
    args.push(id);
    await pool.query(`UPDATE provider_endpoints SET ${sets.join(", ")} WHERE id = ?`, args);
  },

  async clearDefaults(providerId, excludeId = null, conn) {
    const pool = conn ?? (await getPool());
    await pool.query(
      `UPDATE provider_endpoints
          SET is_default = FALSE
        WHERE provider_id = ? AND (? IS NULL OR id <> ?)`,
      [providerId, excludeId, excludeId]
    );
  },

  /** Hard delete — no deleted_at column on this table. */
  async remove(id) {
    const pool = await getPool();
    await pool.query(`DELETE FROM provider_endpoints WHERE id = ?`, [id]);
  },

  /** F5 guard: resource templates referencing this endpoint as their provisioner. */
  async countResourceTypeReferences(providerId, endpointKey) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c
         FROM provider_resource_types
        WHERE provider_id = ? AND provision_endpoint_key = ? AND is_active = TRUE`,
      [providerId, endpointKey]
    );
    return rows[0]?.c ?? 0;
  },
};

