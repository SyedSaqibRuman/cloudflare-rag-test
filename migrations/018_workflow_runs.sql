-- ============================================================
-- 018_workflow_runs — Persistent workflow execution history
-- Stores completed workflow runs with step-level detail.
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_runs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_id INT UNSIGNED NOT NULL,
    workflow_id BIGINT UNSIGNED NOT NULL,
    workflow_key VARCHAR(100) NOT NULL,

    run_id VARCHAR(100) NOT NULL,
    status ENUM('pending','running','completed','failed','aborted') DEFAULT 'pending',
    trigger_type VARCHAR(50) DEFAULT 'manual',

    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL DEFAULT NULL,
    duration_ms INT UNSIGNED DEFAULT NULL,

    steps JSON,
    -- [{ name, type, status, output, error, startedAt, completedAt, durationMs }]

    error TEXT,
    metadata JSON,

    INDEX idx_company_workflow (company_id, workflow_id),
    INDEX idx_status (status),
    INDEX idx_started (started_at),
    UNIQUE KEY uk_run_id (run_id),

    FOREIGN KEY (company_id)  REFERENCES companies(id)  ON DELETE CASCADE,
    FOREIGN KEY (workflow_id) REFERENCES agent_workflows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
