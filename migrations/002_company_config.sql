-- ============================================================
-- 002_company_config — RAG runtime config storage in MySQL
--
-- The existing SQLite per-company config (db/<company>.db, a key/value
-- table) moves into MySQL so companies and their AI/RAG configuration
-- live in one database. The v5 `companies` table is the tenant registry;
-- this migration adds the key/value bag that holds each company's models,
-- URLs, system prompt, vector index, R2 bucket, and (encrypted) Cloudflare
-- credentials + ask API key — the exact keys the SQLite `config` table
-- stored, same JSON-encoded value format, same at-rest encryption
-- (per-field AES-256-GCM via config/encryption.js, applied before save).
--
-- The RAG config facade creates companies without billing data, so the
-- v5 NOT NULL email constraint is relaxed to NULL.
-- ============================================================

ALTER TABLE companies
    MODIFY COLUMN email VARCHAR(255) NULL;

CREATE TABLE IF NOT EXISTS company_config (
    company_id    INT UNSIGNED  NOT NULL,
    config_key    VARCHAR(120)  NOT NULL,
    config_value  MEDIUMTEXT    NOT NULL,
    updated_at    TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (company_id, config_key),
    INDEX idx_company_config_key (config_key),
    CONSTRAINT fk_company_config_company
        FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
