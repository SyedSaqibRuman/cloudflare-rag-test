-- =====================================================
-- 023: Per-KB graph extraction tuning
-- graph_extract_max_chunks:    cap of chunks per document fed to LLM
--                              knowledge extraction (NULL = global default 10).
-- graph_extract_concurrency:   parallel LLM extraction calls (NULL = global
--                              default 4).
-- NULL always means "use the built-in defaults" so existing KBs inherit the
-- tuned global behavior without a data backfill.
-- =====================================================

ALTER TABLE knowledge_bases
  ADD COLUMN graph_extract_max_chunks  INT UNSIGNED NULL DEFAULT NULL COMMENT 'Max chunks per document for LLM graph extraction (NULL = default 10)' AFTER enable_graph_rag,
  ADD COLUMN graph_extract_concurrency INT UNSIGNED NULL DEFAULT NULL COMMENT 'Parallel LLM extraction calls (NULL = default 4)' AFTER graph_extract_max_chunks;
