-- =====================================================
-- 024: Persisted suspended (paused) jobs
-- Paused standalone jobs survive server restarts: on boot the lifecycle
-- re-registers every row as a suspended in-memory job so it can be
-- resumed (or inspected) after a restart. Ingestion resume progress
-- still comes from the ingestion registry, not from this table.
-- =====================================================

CREATE TABLE IF NOT EXISTS suspended_jobs (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_id        VARCHAR(64)  NOT NULL,
    company_name  VARCHAR(63)  DEFAULT NULL,
    kb_key        VARCHAR(63)  DEFAULT NULL,
    started_at    VARCHAR(40)  NOT NULL,
    paused_at     VARCHAR(40)  NOT NULL,
    progress      JSON         DEFAULT NULL,
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_suspended_job (job_id, company_name, kb_key)
);
