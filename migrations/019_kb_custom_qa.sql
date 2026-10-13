-- Migration 019: Add custom_qa JSON column to knowledge_bases
-- Stores an array of { question: string, answer: string, enabled: boolean, tags: string[] }
-- When a user question matches a custom Q&A pair, the stored answer is returned
-- directly instead of going through the RAG pipeline.
-- The matching is case-insensitive substring match (contains) with optional tags.

ALTER TABLE knowledge_bases
    ADD COLUMN custom_qa JSON DEFAULT NULL COMMENT 'Array of {question, answer, enabled, tags} pairs'
    AFTER enable_hybrid_search;

-- Seed existing rows with empty array
UPDATE knowledge_bases SET custom_qa = '[]' WHERE custom_qa IS NULL;
