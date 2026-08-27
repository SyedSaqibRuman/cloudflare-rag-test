// --------------------------
// assistant — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";
import { mapRow } from "./helpers.js";

// Binds a credential + model + knowledge bases to a runtime persona.
// ------------------------------------------------------------------
const ASSISTANT_SELECT = `SELECT a.*,
                                 c.credential_key, c.credential_name,
                                 p.provider_key, p.provider_name,
                                 pm.model_key, pm.model_name,
                                 k.kb_name AS primary_kb_name
                            FROM assistants a
                            LEFT JOIN credentials c  ON c.id  = a.credential_id
                            LEFT JOIN providers p   ON p.id  = c.provider_id
                            LEFT JOIN provider_models pm ON pm.id = a.model_id
                            LEFT JOIN knowledge_bases k  ON k.id  = a.primary_kb_id`;

export const AssistantRepository = {
  async listByCompany(companyId, { includeInactive = false } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `${ASSISTANT_SELECT}
        WHERE a.company_id = ? AND a.deleted_at IS NULL
          ${includeInactive ? "" : "AND a.is_active = TRUE"}
        ORDER BY a.updated_at DESC, a.assistant_name`,
      [companyId]
    );
    return rows.map(mapRow);
  },

  async findByKey(companyId, assistantKey) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `${ASSISTANT_SELECT}
        WHERE a.company_id = ? AND a.assistant_key = ? AND a.deleted_at IS NULL`,
      [companyId, assistantKey]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async findById(assistantId) {
    const pool = await getPool();
    const [rows] = await pool.query(`${ASSISTANT_SELECT} WHERE a.id = ?`, [assistantId]);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async create(companyId, input) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO assistants
         (company_id, assistant_key, assistant_name, description,
          credential_id, model_id, model_key, system_prompt, assistant_variables,
          temperature, max_tokens, enable_function_calling, enable_streaming,
          tools, primary_kb_id, kb_ids, enable_graph_context,
          graph_resource_id, is_active, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        input.assistantKey,
        input.assistantName,
        input.description ?? null,
        input.credentialId,
        input.modelId ?? null,
        input.modelKey ?? null,
        input.systemPrompt ?? null,
        input.variables?.length ? JSON.stringify(input.variables) : null,
        input.temperature ?? 0.7,
        input.maxTokens ?? 4096,
        input.enableFunctionCalling ?? true,
        input.enableStreaming ?? true,
        input.tools ? JSON.stringify(input.tools) : null,
        input.primaryKbId ?? null,
        input.kbIds?.length ? JSON.stringify(input.kbIds) : null,
        input.enableGraphContext ?? false,
        input.graphResourceId ?? null,
        input.isActive ?? true,
        input.isPublic ?? false,
      ]
    );
    return Number(result.insertId);
  },

  /** Partial update — only present keys are written. */
  async update(id, input) {
    const pool = await getPool();
    const columnByKey = {
      assistantName: "assistant_name",
      description: "description",
      credentialId: "credential_id",
      modelId: "model_id",
      modelKey: "model_key",
      systemPrompt: "system_prompt",
      variables: "assistant_variables",
      temperature: "temperature",
      maxTokens: "max_tokens",
      enableFunctionCalling: "enable_function_calling",
      enableStreaming: "enable_streaming",
      tools: "tools",
      primaryKbId: "primary_kb_id",
      kbIds: "kb_ids",
      enableGraphContext: "enable_graph_context",
      graphResourceId: "graph_resource_id",
      isActive: "is_active",
      isPublic: "is_public",
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
      `UPDATE assistants SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
      args
    );
    return result.affectedRows > 0;
  },

  /** Soft delete — the assistant can no longer be resolved. */
  async remove(id) {
    const pool = await getPool();
    const [result] = await pool.query(
      `UPDATE assistants SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    return result.affectedRows > 0;
  },

  /**
   * All assistants (incl. soft-deleted) referencing any of the given
   * credential ids — used by the provider-delete purge, where the plain
   * RESTRICT FK on assistants.credential_id blocks a hard credential delete
   * regardless of the assistant's deleted_at.
   */
  async listByCredentialIds(credentialIds) {
    if (!credentialIds.length) return [];
    const pool = await getPool();
    const placeholders = credentialIds.map(() => "?").join(",");
    const [rows] = await pool.query(
      `SELECT id, company_id, assistant_key, assistant_name, credential_id, deleted_at
         FROM assistants
        WHERE credential_id IN (${placeholders})`,
      credentialIds
    );
    return rows.map(mapRow);
  },

  /** Hard delete — force provider removal (bypasses the soft delete above).
   *  Chatbots cascade on assistant delete; nothing else references assistants. */
  async removePermanent(id) {
    const pool = await getPool();
    const [result] = await pool.query(`DELETE FROM assistants WHERE id = ?`, [id]);
    return result.affectedRows > 0;
  },
};

