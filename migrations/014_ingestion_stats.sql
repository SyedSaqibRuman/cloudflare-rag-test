-- =====================================================
-- 014: Ingestion statistics on knowledge_bases
-- Stores the last ingestion run's stats so the status
-- endpoint can return them without re-querying the
-- registry or audit trail.
-- =====================================================

ALTER TABLE knowledge_bases
    ADD COLUMN last_ingestion_at              DATETIME     DEFAULT NULL AFTER deleted_at,
    ADD COLUMN last_ingestion_duration_ms     INT UNSIGNED DEFAULT NULL AFTER last_ingestion_at,
    ADD COLUMN last_ingestion_documents_processed INT UNSIGNED DEFAULT NULL AFTER last_ingestion_duration_ms,
    ADD COLUMN last_ingestion_documents_skipped   INT UNSIGNED DEFAULT NULL AFTER last_ingestion_documents_processed,
    ADD COLUMN last_ingestion_chunks_created      INT UNSIGNED DEFAULT NULL AFTER last_ingestion_documents_skipped,
    ADD COLUMN last_ingestion_mode            VARCHAR(20)  DEFAULT NULL AFTER last_ingestion_chunks_created,
    ADD COLUMN last_error                     TEXT         DEFAULT NULL AFTER last_ingestion_mode;
