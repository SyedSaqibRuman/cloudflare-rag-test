-- ============================================================
-- 012_seed_provider_docs_urls — "Sign up / Learn more" links
--
-- The provider detail header (9Router-style) shows a "Sign up / Learn more"
-- external link from the provider's website_url (falling back to
-- documentation_url). The 010 catalog seed left both NULL for every provider,
-- so the link never rendered. This fills documentation_url for the OAuth /
-- session-token providers (the ones 9Router links out for signup) plus a few
-- API-key providers with obvious signup pages.
--
-- Idempotent: NULLIF keeps existing URLs (only NULL cells are written).
-- Checksummed by mysql/migrate.js — NEVER edit after applying. Add 013.
-- ============================================================

UPDATE providers
   SET documentation_url = NULLIF(
         CASE provider_key
           WHEN 'claude'        THEN 'https://claude.com/download'
           WHEN 'codex'         THEN 'https://chatgpt.com/codex'
           WHEN 'cursor'        THEN 'https://cursor.com'
           WHEN 'antigravity'   THEN 'https://cloud.google.com/products/antigravity'
           WHEN 'github'        THEN 'https://github.com/features/copilot'
           WHEN 'gemini-cli'    THEN 'https://cloud.google.com/ai/gemini-cli'
           WHEN 'zed'           THEN 'https://zed.dev'
           WHEN 'kiro'          THEN 'https://kiro.dev'
           WHEN 'grok-web'      THEN 'https://grok.com'
           WHEN 'grok-cli'      THEN 'https://grok.com'
           WHEN 'openai'        THEN 'https://platform.openai.com/signup'
           WHEN 'anthropic'     THEN 'https://console.anthropic.com/signup'
           WHEN 'google'        THEN 'https://aistudio.google.com'
           WHEN 'mistral'       THEN 'https://console.mistral.ai'
           WHEN 'deepseek'      THEN 'https://platform.deepseek.com'
           WHEN 'cohere'        THEN 'https://dashboard.cohere.com'
           WHEN 'xai'           THEN 'https://console.x.ai'
           ELSE NULL
         END,
         documentation_url
       )
 WHERE provider_key IN (
   'claude','codex','cursor','antigravity','github','gemini-cli',
   'zed','kiro','grok-web','grok-cli',
   'openai','anthropic','google','mistral','deepseek','cohere','xai'
 );
