// --------------------------
// model — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";
import { mapRow } from "./helpers.js";

// ------------------------------------------------------------------
export const ModelRepository = {
  /** Active, non-deprecated models with their current (effective_to IS NULL)
   * price — bulk variant for the registry loader: one query for all providers,
   * rows carry provider_id for in-memory grouping. */
  async listByProviderIds(providerIds, { includeDeprecated = false } = {}) {
    if (!providerIds.length) return [];
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT pm.provider_id, pm.id, pm.model_key, pm.model_name, pm.model_family, pm.category,
              pm.supports_streaming, pm.supports_function_calling, pm.supports_vision,
              pm.max_context_window, pm.max_output_tokens, pm.thinking_mode, pm.is_deprecated,
              pmp.input_price_per_million, pmp.output_price_per_million,
              pmp.cached_input_price_per_million, pmp.billing_unit, pmp.price_currency
         FROM provider_models pm
         LEFT JOIN provider_model_pricing pmp
                ON pmp.provider_model_id = pm.id AND pmp.effective_to IS NULL
        WHERE pm.provider_id IN (?)
          AND pm.is_active = TRUE
          ${includeDeprecated ? "" : "AND pm.is_deprecated = FALSE"}
        ORDER BY pm.provider_id, pm.category, pm.model_name`,
      [providerIds]
    );
    return rows.map(mapRow);
  },

  /** Active, non-deprecated models in a category, with their provider (M2: embedding). */
  async listByCategory(category) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT pm.id, pm.model_key, pm.model_name, pm.model_family, pm.category,
              pr.provider_key, pr.provider_name
         FROM provider_models pm
         JOIN providers pr ON pr.id = pm.provider_id
        WHERE pm.category = ? AND pm.is_active = TRUE AND pm.is_deprecated = FALSE
        ORDER BY pr.provider_name, pm.model_name`,
      [category]
    );
    return rows.map(mapRow);
  },

  /**
   * Upsert a single provider model (ON DUPLICATE KEY on provider_id+model_key)
   * — same semantics as the catalog importer's model upsert, used by the
   * Add Model route. Returns the model row id.
   * @param {number} providerId
   * @param {Object} m  camelCase: modelKey, modelName, modelFamily, category,
   *                    supportsStreaming, supportsFunctionCalling, supportsVision,
   *                    maxContextWindow, maxOutputTokens
   */
  async upsert(providerId, m) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO provider_models
         (provider_id, model_key, model_name, model_family, category,
          supports_streaming, supports_function_calling, supports_vision,
          max_context_window, max_output_tokens, is_active, is_deprecated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, FALSE)
       ON DUPLICATE KEY UPDATE
         model_name = VALUES(model_name),
         model_family = VALUES(model_family),
         category = VALUES(category),
         supports_streaming = VALUES(supports_streaming),
         supports_function_calling = VALUES(supports_function_calling),
         supports_vision = VALUES(supports_vision),
         max_context_window = VALUES(max_context_window),
         max_output_tokens = VALUES(max_output_tokens),
         is_active = TRUE`,
      [
        providerId,
        m.modelKey,
        m.modelName,
        m.modelFamily ?? null,
        m.category,
        m.supportsStreaming ?? false,
        m.supportsFunctionCalling ?? false,
        m.supportsVision ?? false,
        m.maxContextWindow ?? null,
        m.maxOutputTokens ?? null,
      ]
    );
    // ON DUPLICATE KEY UPDATE leaves insertId 0 when the row already existed
    // (update path) — resolve the real id so callers get a truthful modelId.
    let id = Number(result.insertId);
    if (!id) {
      const [rows] = await pool.query(
        `SELECT id FROM provider_models WHERE provider_id = ? AND model_key = ?`,
        [providerId, m.modelKey]
      );
      id = rows[0] ? Number(rows[0].id) : id;
    }
    return id;
  },

  async findById(modelId) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `SELECT pm.id, pm.provider_id, p.provider_key, pm.model_key, pm.model_name,
              pm.model_family, pm.category, pm.supports_streaming,
              pm.supports_function_calling, pm.supports_vision,
              pm.max_context_window, pm.max_output_tokens, pm.thinking_mode, pm.is_deprecated
         FROM provider_models pm
         JOIN providers p ON p.id = pm.provider_id
        WHERE pm.id = ?`,
      [modelId]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  /**
   * Update a model's metadata. model_key IS editable (renaming to a key already
   * in use on the same provider violates the (provider_id, model_key) unique
   * key and throws ER_DUP_ENTRY — callers surface that as a 409).
   * Callers MUST pass input.modelKey (the stored key when it isn't changing).
   */
  async update(id, input) {
    const pool = await getPool();
    const [result] = await pool.query(
      `UPDATE provider_models
          SET model_key = ?,
              model_name = ?,
              model_family = ?,
              category = ?,
              supports_streaming = ?,
              supports_function_calling = ?,
              supports_vision = ?,
              max_context_window = ?,
              max_output_tokens = ?,
              thinking_mode = ?
        WHERE id = ?`,
      [
        input.modelKey,
        input.modelName,
        input.modelFamily ?? null,
        input.category,
        input.supportsStreaming ?? false,
        input.supportsFunctionCalling ?? false,
        input.supportsVision ?? false,
        input.maxContextWindow ?? null,
        input.maxOutputTokens ?? null,
        input.thinkingMode ?? "auto",
        id,
      ]
    );
    return result.affectedRows > 0;
  },

  /** Hard delete a model — pricing + credential_model_access rows CASCADE. */
  async remove(id) {
    const pool = await getPool();
    const [result] = await pool.query(`DELETE FROM provider_models WHERE id = ?`, [id]);
    return result.affectedRows > 0;
  },

  /**
   * Hard delete EVERY model of one provider ("Delete All Models" bulk action).
   * Pricing and credential_model_access rows CASCADE with each model, so
   * tenant grants for the provider disappear with it. Returns the number of
   * models removed.
   */
  async removeByProvider(providerId) {
    const pool = await getPool();
    const [result] = await pool.query(`DELETE FROM provider_models WHERE provider_id = ?`, [providerId]);
    return result.affectedRows;
  },
};

