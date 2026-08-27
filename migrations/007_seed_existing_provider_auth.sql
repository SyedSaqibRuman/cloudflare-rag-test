-- --------------------------
-- 007_seed_existing_provider_auth.sql
-- Seed provider-specific auth schemas for providers that already exist in the
-- catalog but were created with a bare/generic schema (e.g. a single "API key"
-- field). The Credentials page's "New Credential" form is driven entirely by
-- provider_auth_schemas, so without these rows it can only ask for one generic
-- key — it can't collect provider-specific fields like a Cloudflare Account ID
-- or a custom base URL.
--
-- DML only — no DDL. Idempotent: rows already present are skipped (the same
-- INSERT ... SELECT ... LEFT JOIN ... WHERE NULL pattern as 004/006).
-- Checksummed by mysql/migrate.js — NEVER edit after applying. Add 008.
--
-- Fields added per provider key (only when that provider exists):
--   cloudflare_worker_ai : api_token, account_id, base_url
--   cloudflare_vectorize : api_token, account_id
--   cloudflare_r2       : api_token, account_id, access_key_id, secret_access_key
--   nvidia               : api_key
--   openai               : api_key
--   anthropic            : api_key
-- --------------------------

INSERT INTO provider_auth_schemas
  (provider_id, field_name, field_label, field_type, is_required, validation_regex,
   is_encrypted, encryption_storage_path, display_order, field_group,
   field_help_text, select_options, field_placeholder)
SELECT p.id, s.field_name, s.field_label, s.field_type, s.is_required, s.validation_regex,
       s.is_encrypted, s.encryption_storage_path, s.display_order, s.field_group,
       s.field_help_text, s.select_options, s.field_placeholder
FROM (
  -- Cloudflare Workers AI — chat/embedding runtime
  SELECT 'cloudflare_worker_ai' AS provider_key, 'api_token' AS field_name,
         'Cloudflare API Token' AS field_label, 'password' AS field_type, TRUE AS is_required,
         NULL AS validation_regex, TRUE AS is_encrypted, 'api_token' AS encryption_storage_path,
         10 AS display_order, 'main' AS field_group,
         'Generate at https://dash.cloudflare.com/profile/api-tokens' AS field_help_text,
         NULL AS select_options, NULL AS field_placeholder
  UNION ALL SELECT 'cloudflare_worker_ai', 'account_id', 'Cloudflare Account ID', 'text', TRUE,
         NULL, TRUE, 'account_id', 20, 'main',
         'Found in the Cloudflare dashboard URL after /accounts/', NULL, NULL
  UNION ALL SELECT 'cloudflare_worker_ai', 'base_url', 'API Base URL', 'url', FALSE,
         NULL, FALSE, 'base_url', 30, 'main',
         'Defaults to https://api.cloudflare.com/client/v4', NULL,
         'https://api.cloudflare.com/client/v4'
  -- Cloudflare Vectorize — vector index provider
  UNION ALL SELECT 'cloudflare_vectorize', 'api_token', 'Cloudflare API Token', 'password', TRUE,
         NULL, TRUE, 'api_token', 10, 'main',
         'Generate at https://dash.cloudflare.com/profile/api-tokens', NULL, NULL
  UNION ALL SELECT 'cloudflare_vectorize', 'account_id', 'Cloudflare Account ID', 'text', TRUE,
         NULL, TRUE, 'account_id', 20, 'main',
         'Found in the Cloudflare dashboard URL after /accounts/', NULL, NULL
  -- Cloudflare R2 — object storage provider
  UNION ALL SELECT 'cloudflare_r2', 'api_token', 'Cloudflare API Token', 'password', TRUE,
         NULL, TRUE, 'api_token', 10, 'main',
         'Generate at https://dash.cloudflare.com/profile/api-tokens', NULL, NULL
  UNION ALL SELECT 'cloudflare_r2', 'account_id', 'Cloudflare Account ID', 'text', TRUE,
         NULL, TRUE, 'account_id', 20, 'main',
         'Found in the Cloudflare dashboard URL after /accounts/', NULL, NULL
  UNION ALL SELECT 'cloudflare_r2', 'access_key_id', 'R2 Access Key ID', 'text', FALSE,
         NULL, TRUE, 'access_key_id', 30, 'main',
         'Only needed for S3 API access to buckets', NULL, NULL
  UNION ALL SELECT 'cloudflare_r2', 'secret_access_key', 'R2 Secret Access Key', 'password', FALSE,
         NULL, TRUE, 'secret_access_key', 40, 'main',
         'Only needed for S3 API access to buckets', NULL, NULL
  -- NVIDIA NIM — API-key only
  UNION ALL SELECT 'nvidia', 'api_key', 'NVIDIA API Key', 'password', TRUE,
         NULL, TRUE, 'api_key', 10, 'main',
         'Generate at https://org.ngc.nvidia.com/setup/api-key', NULL, NULL
  -- OpenAI / Anthropic — API-key only (in case a bare row replaced the seed)
  UNION ALL SELECT 'openai', 'api_key', 'OpenAI API Key', 'password', TRUE,
         '^sk-[A-Za-z0-9]{20,}$', TRUE, 'api_key', 10, 'main',
         'Generate at https://platform.openai.com/api-keys', NULL, NULL
  UNION ALL SELECT 'anthropic', 'api_key', 'Anthropic API Key', 'password', TRUE,
         '^sk-ant-[A-Za-z0-9-]{40,}$', TRUE, 'api_key', 10, 'main',
         'Generate at https://console.anthropic.com/settings/keys', NULL, NULL
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_auth_schemas a
       ON a.provider_id = p.id AND a.field_name = s.field_name
WHERE a.id IS NULL;
