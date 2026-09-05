// --------------------------
// kb — one aggregate per file (Clean Architecture: repository layer).
// Extracted verbatim from the former mysql/repositories.js monolith.
// --------------------------
import { getPool } from "../pool.js";
import { mapRow } from "./helpers.js";

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
          enable_graph_rag, enable_hybrid_search, source_type, status, is_active,
          webhook_url, webhook_secret, webhook_events, source_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.sourceType ?? "wordpress",
        input.status ?? "active",
        input.isActive ?? true,
        input.webhookUrl ?? null,
        input.webhookSecret ?? null,
        input.webhookEvents ?? null,
        input.sourceConfig ? JSON.stringify(input.sourceConfig) : null,
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
      sourceType: "source_type",
      sourceConfig: "source_config",
      webhookUrl: "webhook_url",
      webhookSecret: "webhook_secret",
      webhookEvents: "webhook_events",
      status: "status",
      isActive: "is_active",
    };
    const sets = [];
    const args = [];
    for (const [key, column] of Object.entries(columnByKey)) {
      if (input[key] !== undefined) {
        sets.push(`\`${column}\` = ?`);
        // source_config is a JSON column — must be stringified
        args.push(key === "sourceConfig" && input[key] != null ? JSON.stringify(input[key]) : input[key]);
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

  /** Persist ingestion statistics from the last completed run. */
  /** Update source_config (JSON blob for URL/file sources). */
  async setSourceConfig(kbId, config) {
    const pool = await getPool();
    await pool.query(
      `UPDATE knowledge_bases SET source_config = ? WHERE id = ?`,
      [config ? JSON.stringify(config) : null, kbId]
    );
  },

  async setIngestionStats(kbId, stats) {
    const pool = await getPool();
    await pool.query(
      `UPDATE knowledge_bases SET
         last_ingestion_at = NOW(),
         last_ingestion_duration_ms = ?,
         last_ingestion_documents_processed = ?,
         last_ingestion_documents_skipped = ?,
         last_ingestion_chunks_created = ?,
         last_ingestion_mode = ?,
         last_error = NULL
       WHERE id = ?`,
      [
        stats.durationMs ?? null,
        stats.documentsProcessed ?? null,
        stats.documentsSkipped ?? null,
        stats.chunksCreated ?? null,
        stats.mode ?? null,
        kbId,
      ]
    );
  },

  /** Record an ingestion error on the KB row. */
  async setIngestionError(kbId, errorMessage) {
    const pool = await getPool();
    await pool.query(
      `UPDATE knowledge_bases SET last_error = ? WHERE id = ?`,
      [errorMessage, kbId]
    );
  },

  // ------------------------------------------------------------------
  // 🔹 Custom Q&A — direct answers that override the RAG pipeline
  // ------------------------------------------------------------------

  /** Get all custom Q&A pairs for a KB. */
  async getCustomQa(kbId) {
    const pool = await getPool();
    const [[row]] = await pool.query(
      `SELECT custom_qa FROM knowledge_bases WHERE id = ?`,
      [kbId]
    );
    if (!row?.custom_qa) return [];
    try {
      const parsed = typeof row.custom_qa === "string" ? JSON.parse(row.custom_qa) : row.custom_qa;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  /** Replace all custom Q&A pairs for a KB. */
  async setCustomQa(kbId, entries) {
    const pool = await getPool();
    await pool.query(
      `UPDATE knowledge_bases SET custom_qa = ? WHERE id = ?`,
      [JSON.stringify(entries), kbId]
    );
  },

  /** Add a single Q&A pair to a KB. Returns the new entry with id. */
  async addCustomQaEntry(kbId, entry) {
    const existing = await this.getCustomQa(kbId);
    const newEntry = {
      id: `qa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question: entry.question,
      answer: entry.answer,
      enabled: entry.enabled !== false,
      tags: entry.tags || [],
      created_at: new Date().toISOString(),
    };
    existing.push(newEntry);
    await this.setCustomQa(kbId, existing);
    return newEntry;
  },

  /** Update a single Q&A pair by id. */
  async updateCustomQaEntry(kbId, entryId, updates) {
    const existing = await this.getCustomQa(kbId);
    const idx = existing.findIndex((e) => e.id === entryId);
    if (idx === -1) return null;
    existing[idx] = { ...existing[idx], ...updates, id: entryId, updated_at: new Date().toISOString() };
    await this.setCustomQa(kbId, existing);
    return existing[idx];
  },

  /** Delete a single Q&A pair by id. */
  async deleteCustomQaEntry(kbId, entryId) {
    const existing = await this.getCustomQa(kbId);
    const filtered = existing.filter((e) => e.id !== entryId);
    if (filtered.length === existing.length) return false;
    await this.setCustomQa(kbId, filtered);
    return true;
  },

  /** Find the first matching custom Q&A entry for a question (case-insensitive contains). */
  async matchCustomQa(kbId, question) {
    const entries = await this.getCustomQa(kbId);
    const q = question.toLowerCase().trim();
    // First: exact match
    for (const entry of entries) {
      if (entry.enabled && entry.question.toLowerCase().trim() === q) return entry;
    }
    // Second: contains match (question contains the custom question, or vice versa)
    for (const entry of entries) {
      if (!entry.enabled) continue;
      const cq = entry.question.toLowerCase().trim();
      if (q.includes(cq) || cq.includes(q)) return entry;
    }
    return null;
  },
};

