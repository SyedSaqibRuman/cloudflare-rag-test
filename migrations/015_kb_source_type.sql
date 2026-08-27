-- =====================================================
-- 015: Ingestion source type on knowledge_bases
-- Determines how the KB gets its content: WordPress,
-- uploaded files, or external URLs.
-- =====================================================

ALTER TABLE knowledge_bases
    ADD COLUMN source_type ENUM('wordpress', 'file', 'url', 'custom') DEFAULT 'wordpress'
        AFTER embedding_model_provider;

UPDATE knowledge_bases SET source_type = 'wordpress' WHERE source_type IS NULL;
