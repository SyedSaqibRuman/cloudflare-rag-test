-- 021_assistant_guardrails.sql
-- Per-assistant guardrails (moved from the company-level Config page):
--   guardrail_prompt  — custom instructions appended to the system message
--                       (assistant > company GUARDRAIL_PROMPT > built-in).
--   blocked_topics    — newline-separated keywords refused before retrieval/LLM
--                       (adds to company BLOCKED_TOPICS + built-in patterns).
ALTER TABLE assistants
  ADD COLUMN guardrail_prompt TEXT NULL AFTER system_prompt,
  ADD COLUMN blocked_topics TEXT NULL AFTER guardrail_prompt;
