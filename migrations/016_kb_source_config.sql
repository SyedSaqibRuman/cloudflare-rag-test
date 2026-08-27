-- =====================================================
-- 016: Source configuration on knowledge_bases
-- Stores source-specific config (URLs, file paths) as
-- a JSON blob alongside source_type.
-- =====================================================

ALTER TABLE knowledge_bases
    ADD COLUMN source_config JSON DEFAULT NULL
        AFTER source_type;
