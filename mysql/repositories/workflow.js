// --------------------------
// workflow — repository layer (Clean Architecture).
// CRUD on the `agent_workflows` table.
// --------------------------
import { getPool } from "../pool.js";
import { mapRow } from "./helpers.js";

const WORKFLOW_SELECT = `SELECT w.*,
                                a.assistant_key, a.assistant_name
                           FROM agent_workflows w
                           LEFT JOIN assistants a ON a.id = w.primary_assistant_id`;

export const WorkflowRepository = {
  async listByCompany(companyId, { includeInactive = false } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `${WORKFLOW_SELECT}
        WHERE w.company_id = ? AND w.deleted_at IS NULL
          ${includeInactive ? "" : "AND w.is_active = TRUE"}
        ORDER BY w.updated_at DESC, w.workflow_name`,
      [companyId]
    );
    return rows.map(mapRow);
  },

  async findByKey(companyId, workflowKey) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `${WORKFLOW_SELECT}
        WHERE w.company_id = ? AND w.workflow_key = ? AND w.deleted_at IS NULL`,
      [companyId, workflowKey]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async findById(workflowId) {
    const pool = await getPool();
    const [rows] = await pool.query(`${WORKFLOW_SELECT} WHERE w.id = ?`, [workflowId]);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async create(companyId, input) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO agent_workflows
         (company_id, workflow_key, workflow_name, description,
          definition, primary_assistant_id, trigger_type, trigger_config,
          status, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        input.workflowKey,
        input.workflowName,
        input.description ?? null,
        input.definition ? JSON.stringify(input.definition) : JSON.stringify({ steps: [] }),
        input.primaryAssistantId ?? null,
        input.triggerType ?? "manual",
        input.triggerConfig ? JSON.stringify(input.triggerConfig) : null,
        input.status ?? "draft",
        input.isActive ?? true,
      ]
    );
    return Number(result.insertId);
  },

  async update(id, input) {
    const pool = await getPool();
    const columnByKey = {
      workflowName: "workflow_name",
      description: "description",
      definition: "definition",
      primaryAssistantId: "primary_assistant_id",
      triggerType: "trigger_type",
      triggerConfig: "trigger_config",
      status: "status",
      isActive: "is_active",
    };
    const sets = [];
    const args = [];
    for (const [key, column] of Object.entries(columnByKey)) {
      if (input[key] !== undefined) {
        sets.push(`\`${column}\` = ?`);
        args.push(
          input[key] !== null && typeof input[key] === "object"
            ? JSON.stringify(input[key])
            : input[key]
        );
      }
    }
    if (sets.length === 0) return false;
    args.push(id);
    const [result] = await pool.query(
      `UPDATE agent_workflows SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
      args
    );
    return result.affectedRows > 0;
  },

  async remove(id) {
    const pool = await getPool();
    const [result] = await pool.query(
      `UPDATE agent_workflows SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    return result.affectedRows > 0;
  },

  async removePermanent(id) {
    const pool = await getPool();
    const [result] = await pool.query(`DELETE FROM agent_workflows WHERE id = ?`, [id]);
    return result.affectedRows > 0;
  },
};
