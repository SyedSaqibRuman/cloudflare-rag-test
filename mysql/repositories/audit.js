// --------------------------
// audit — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";
import { mapRow } from "./helpers.js";

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

