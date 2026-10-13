// --------------------------
// workflow_run — persistent workflow execution history.
// Stores completed workflow runs with step-level detail.
// --------------------------
import { getPool } from "../pool.js";
import { mapRow } from "./helpers.js";

export const WorkflowRunRepository = {
  /**
   * Log a completed workflow run.
   */
  async logRun({ companyId, workflowId, workflowKey, runId, status, triggerType, startedAt, completedAt, durationMs, steps, error, metadata }) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO workflow_runs
         (company_id, workflow_id, workflow_key, run_id, status, trigger_type,
          started_at, completed_at, duration_ms, steps, error, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        workflowId,
        workflowKey,
        runId,
        status || "completed",
        triggerType || "manual",
        startedAt || new Date(),
        completedAt || new Date(),
        durationMs || 0,
        steps ? JSON.stringify(steps) : null,
        error || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
    return Number(result.insertId);
  },

  /**
   * List runs for a workflow (most recent first).
   */
  async listByWorkflow(workflowId, { limit = 50, offset = 0 } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT id, run_id, status, trigger_type, started_at, completed_at,
              duration_ms, steps, error, metadata
         FROM workflow_runs
        WHERE workflow_id = ?
        ORDER BY started_at DESC
        LIMIT ? OFFSET ?`,
      [workflowId, limit, offset]
    );
    return rows.map((r) => {
      const row = mapRow(r);
      if (row.steps && typeof row.steps === "string") {
        try { row.steps = JSON.parse(row.steps); } catch { /* keep as string */ }
      }
      return row;
    });
  },

  /**
   * List all runs for a company (most recent first).
   */
  async listByCompany(companyId, { limit = 50, offset = 0 } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT r.id, r.run_id, r.workflow_key, r.status, r.trigger_type,
              r.started_at, r.completed_at, r.duration_ms, r.steps, r.error
         FROM workflow_runs r
        WHERE r.company_id = ?
        ORDER BY r.started_at DESC
        LIMIT ? OFFSET ?`,
      [companyId, limit, offset]
    );
    return rows.map((r) => {
      const row = mapRow(r);
      if (row.steps && typeof row.steps === "string") {
        try { row.steps = JSON.parse(row.steps); } catch { /* keep as string */ }
      }
      return row;
    });
  },

  /**
   * Get summary stats for a workflow.
   */
  async getStats(workflowId) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT
         COUNT(*) AS total_runs,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) AS aborted,
         ROUND(AVG(duration_ms)) AS avg_duration_ms,
         MAX(completed_at) AS last_run_at
       FROM workflow_runs
       WHERE workflow_id = ?`,
      [workflowId]
    );
    return mapRow(rows[0] || {});
  },
};
