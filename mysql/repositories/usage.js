// --------------------------
// usage — repository layer (Clean Architecture).
// Append-only writes to credential_usage_logs + aggregate reads.
// --------------------------
import { getPool } from "../pool.js";

/** Compute the p-th percentile from a sorted array of numbers. */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export const UsageRepository = {
  /**
   * Log a usage event (append-only, never UPDATE).
   * @param {Object} entry
   * @returns {Promise<number>} inserted id
   */
  async log(entry) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO credential_usage_logs
         (credential_id, company_id, provider_resource_id, chatbot_id,
          action, endpoint, model_used, resource_type, request_method,
          response_status, input_units, output_units, duration_ms, cost_usd,
          error_code, error_message, user_id, client_ip, user_agent,
          trace_id, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.credentialId ?? null,
        entry.companyId,
        entry.providerResourceId ?? null,
        entry.chatbotId ?? null,
        entry.action ?? "ask",
        entry.endpoint ?? null,
        entry.modelUsed ?? null,
        entry.resourceType ?? null,
        entry.requestMethod ?? "POST",
        entry.responseStatus ?? 200,
        entry.inputUnits ?? null,
        entry.outputUnits ?? null,
        entry.durationMs ?? null,
        entry.costUsd ?? null,
        entry.errorCode ?? null,
        entry.errorMessage ?? null,
        entry.userId ?? null,
        entry.clientIp ?? null,
        entry.userAgent ?? null,
        entry.traceId ?? null,
        entry.requestId ?? null,
      ]
    );
    return Number(result.insertId);
  },

  /**
   * Aggregate usage for a company over a time range.
   * @param {number} companyId
   * @param {Object} opts — { from, to, groupBy: 'day'|'model'|'credential' }
   * @returns {Promise<Array>}
   */
  async aggregate(companyId, { from, to, groupBy = "day" } = {}) {
    const pool = await getPool();
    const params = [companyId];

    let dateFilter = "";
    if (from) {
      dateFilter += " AND created_at >= ?";
      params.push(from);
    }
    if (to) {
      dateFilter += " AND created_at <= ?";
      params.push(to);
    }

    let groupClause;
    let selectClause;
    switch (groupBy) {
      case "model":
        groupClause = "model_used";
        selectClause = "model_used AS group_key";
        break;
      case "credential":
        groupClause = "credential_id";
        selectClause = "credential_id AS group_key";
        break;
      case "day":
      default:
        groupClause = "DATE(created_at)";
        selectClause = "DATE(created_at) AS group_key";
        break;
    }

    const [rows] = await pool.query(
      `SELECT ${selectClause},
              COUNT(*) AS request_count,
              SUM(input_units) AS total_input_units,
              SUM(output_units) AS total_output_units,
              SUM(cost_usd) AS total_cost_usd,
              AVG(duration_ms) AS avg_duration_ms,
              MIN(duration_ms) AS min_duration_ms,
              MAX(duration_ms) AS max_duration_ms,
              SUM(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS success_count,
              SUM(CASE WHEN response_status >= 400 THEN 1 ELSE 0 END) AS error_count
       FROM credential_usage_logs
       WHERE company_id = ? ${dateFilter}
       GROUP BY ${groupClause}
       ORDER BY ${groupClause} DESC`,
      params
    );
    return rows;
  },

  /**
   * Get summary stats for a company.
   * @param {number} companyId
   * @param {Object} opts — { from, to }
   * @returns {Promise<Object>}
   */
  async summary(companyId, { from, to } = {}) {
    const pool = await getPool();
    const params = [companyId];
    let dateFilter = "";
    if (from) { dateFilter += " AND created_at >= ?"; params.push(from); }
    if (to) { dateFilter += " AND created_at <= ?"; params.push(to); }

    const [rows] = await pool.query(
      `SELECT COUNT(*) AS total_requests,
              SUM(input_units) AS total_input_tokens,
              SUM(output_units) AS total_output_tokens,
              COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
              AVG(duration_ms) AS avg_duration_ms,
              SUM(CASE WHEN response_status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS success_count,
              SUM(CASE WHEN response_status >= 400 THEN 1 ELSE 0 END) AS error_count
       FROM credential_usage_logs
       WHERE company_id = ? ${dateFilter}`,
      params
    );
    const summary = rows[0] || {};

    // Latency percentiles (P50/P95/P99)
    try {
      const [pRows] = await pool.query(
        `SELECT duration_ms FROM credential_usage_logs
         WHERE company_id = ? ${dateFilter} AND duration_ms IS NOT NULL
         ORDER BY duration_ms ASC`,
        params
      );
      if (pRows.length > 0) {
        const durations = pRows.map((r) => r.duration_ms);
        summary.p50_duration_ms = percentile(durations, 50);
        summary.p95_duration_ms = percentile(durations, 95);
        summary.p99_duration_ms = percentile(durations, 99);
      }
    } catch { /* percentiles are best-effort */ }

    return summary;
  },

  /**
   * Top models/KBs by cost.
   * @param {number} companyId
   * @param {number} [limit=10]
   * @returns {Promise<Array>}
   */
  async topByCost(companyId, limit = 10) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT model_used, COUNT(*) AS request_count,
              SUM(cost_usd) AS total_cost_usd,
              SUM(input_units) AS total_input_tokens,
              SUM(output_units) AS total_output_tokens
       FROM credential_usage_logs
       WHERE company_id = ? AND model_used IS NOT NULL
       GROUP BY model_used
       ORDER BY total_cost_usd DESC
       LIMIT ?`,
      [companyId, limit]
    );
    return rows;
  },

  /**
   * Top KBs by cost (groups by trace_id which contains kbKey).
   * @param {number} companyId
   * @param {number} [limit=10]
   * @returns {Promise<Array>}
   */
  async topKBsByCost(companyId, limit = 10) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT model_used AS kb_key, COUNT(*) AS request_count,
              SUM(cost_usd) AS total_cost_usd,
              SUM(input_units) AS total_input_tokens
       FROM credential_usage_logs
       WHERE company_id = ? AND action = 'ask'
       GROUP BY model_used
       ORDER BY total_cost_usd DESC
       LIMIT ?`,
      [companyId, limit]
    );
    return rows;
  },

  /**
   * Recent calls (for the activity feed).
   * @param {number} companyId
   * @param {number} [limit=20]
   * @returns {Promise<Array>}
   */
  async recent(companyId, limit = 20) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, action, model_used, response_status, input_units, output_units,
              duration_ms, cost_usd, created_at
       FROM credential_usage_logs
       WHERE company_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [companyId, limit]
    );
    return rows;
  },
};
