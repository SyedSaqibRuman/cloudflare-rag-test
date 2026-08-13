// --------------------------
// kb — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";
import { json, mapRow } from "./helpers.js";

// ------------------------------------------------------------------
const KB_SELECT = `SELECT k.*,
                          pv.resource_name AS vector_resource_name,
                          pv.external_resource_id AS vector_external_id,
                          pg.resource_name AS graph_resource_name,
                          pg.external_resource_id AS graph_external_id,
                          ps.resource_name AS storage_resource_name,
                          ps.external_resource_id AS storage_external_id,
                          pm.model_key, pm.model_name AS embedding_model_name
                     FROM knowledge_bases k
                     LEFT JOIN provider_resources pv ON pv.id = k.vector_resource_id
                     LEFT JOIN provider_resources pg ON pg.id = k.graph_resource_id
                     LEFT JOIN provider_resources ps ON ps.id = k.storage_resource_id
                     LEFT JOIN provider_models pm ON pm.id = k.embedding_model_id`;

export const KbRepository = {
  async listByCompany(companyId, { includeInactive = false } = {}) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `${KB_SELECT}
        WHERE k.company_id = ? AND k.deleted_at IS NULL
          ${includeInactive ? "" : "AND k.is_active = TRUE"}
        ORDER BY k.updated_at DESC`,
      [companyId]
    );
    return rows.map(mapRow);
  },

  async findByKey(companyId, kbKey) {
    const pool = await getPool();
    const [rows] = await pool.query(
      `${KB_SELECT}
        WHERE k.company_id = ? AND k.kb_key = ? AND k.deleted_at IS NULL`,
      [companyId, kbKey]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async findById(kbId) {
    const pool = await getPool();
    const [rows] = await pool.query(`${KB_SELECT} WHERE k.id = ?`, [kbId]);
    return rows[0] ? mapRow(rows[0]) : null;
  },

  async create(companyId, input) {
    const pool = await getPool();
    const [result] = await pool.query(
      `INSERT INTO knowledge_bases
         (company_id, kb_key, kb_name, description,
          vector_resource_id, graph_resource_id, storage_resource_id,
          embedding_model_id, embedding_model_provider,
          chunk_size, chunk_overlap, retrieval_top_k, retrieval_score_threshold,
          enable_graph_rag, enable_hybrid_search, status, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        input.kbKey,
        input.kbName,
        input.description ?? null,
        input.vectorResourceId ?? null,
        input.graphResourceId ?? null,
        input.storageResourceId ?? null,
        input.embeddingModelId ?? null,
        input.embeddingModelProvider ?? null,
        input.chunkSize ?? 512,
        input.chunkOverlap ?? 50,
        input.retrievalTopK ?? 10,
        input.retrievalScoreThreshold ?? 0.7,
        input.enableGraphRag ?? false,
        input.enableHybridSearch ?? true,
        input.status ?? "active",
        input.isActive ?? true,
      ]
    );
    return Number(result.insertId);
  },

  async update(kbId, input, conn) {
    const pool = conn ?? (await getPool());
    const columnByKey = {
      kbName: "kb_name",
      description: "description",
      vectorResourceId: "vector_resource_id",
      graphResourceId: "graph_resource_id",
      storageResourceId: "storage_resource_id",
      embeddingModelId: "embedding_model_id",
      embeddingModelProvider: "embedding_model_provider",
      chunkSize: "chunk_size",
      chunkOverlap: "chunk_overlap",
      retrievalTopK: "retrieval_top_k",
      retrievalScoreThreshold: "retrieval_score_threshold",
      enableGraphRag: "enable_graph_rag",
      enableHybridSearch: "enable_hybrid_search",
      status: "status",
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
    args.push(kbId);
    await pool.query(`UPDATE knowledge_bases SET ${sets.join(", ")} WHERE id = ?`, args);
  },

  /** Hard delete (D10) — uk_company_kb is a plain UNIQUE, so soft-deleted rows would
      still occupy the key; the audit trail keeps history. */
  async remove(kbId) {
    const pool = await getPool();
    await pool.query(`DELETE FROM knowledge_bases WHERE id = ?`, [kbId]);
  },

  /** The DDL has no error/last_sync columns — status is the only persistable signal;
      last errors live in the audit trail and in-memory job state (see /status). */
  async setStatus(kbId, status) {
    const pool = await getPool();
    await pool.query(`UPDATE knowledge_bases SET status = ? WHERE id = ?`, [status, kbId]);
  },
};

