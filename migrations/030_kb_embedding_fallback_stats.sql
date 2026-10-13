-- --------------------------
-- 030_kb_embedding_fallback_stats.sql
-- Surface KB-bound embedding-adapter failures on the KB detail page.
--
-- When a KB binds a non-Cloudflare embedding model (e.g. NVIDIA
-- nemotron-3-embed-1b) and that provider's endpoint dies, the vector adapters
-- silently fall back to the company's CF embeddings (mysql/adapters/
-- embed-fallback.js). Vectors still land — but in the CF vector space, and the
-- fallback is a reliability signal worth surfacing. These columns persist the
-- fallback counts from the LAST completed ingestion run alongside the existing
-- last_ingestion_* stats (migration 014), so the portal can show
-- "embedding model failed → CF fallback used" without reading server logs.
--
-- NULL = the run used no KB-bound embedding adapter (company default), so
-- there was nothing to fall back FROM.
-- --------------------------

ALTER TABLE knowledge_bases
    ADD COLUMN last_ingestion_embedding_fallbacks INT UNSIGNED DEFAULT NULL
        AFTER last_ingestion_mode,
    ADD COLUMN last_ingestion_embedding_error TEXT DEFAULT NULL
        AFTER last_ingestion_embedding_fallbacks;
