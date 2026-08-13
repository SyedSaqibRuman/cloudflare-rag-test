-- --------------------------
-- 003_platform_seed.sql
-- Seed provider_endpoints + provider_model_pricing from the schema/v5.sql
-- reference data (v5 seeded these; migrations never did). DML only — no DDL.
-- Idempotent: rows already present are skipped, so re-running is a no-op.
-- Checksummed by mysql/migrate.js — NEVER edit after applying. Add 004.
-- --------------------------

-- CATALOG: provider_endpoints (from schema/v5.sql:1186-1191)
INSERT INTO provider_endpoints
  (provider_id, endpoint_key, endpoint_name, endpoint_url, is_default)
SELECT p.id, s.endpoint_key, s.endpoint_name, s.endpoint_url, s.is_default
FROM (
  SELECT 'cloudflare' AS provider_key, 'workers_ai' AS endpoint_key, 'Workers AI'  AS endpoint_name,
         'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run' AS endpoint_url, TRUE AS is_default
  UNION ALL SELECT 'cloudflare', 'vectorize', 'Vectorize',
         'https://api.cloudflare.com/client/v4/accounts/{account_id}/vectorize', FALSE
  UNION ALL SELECT 'cloudflare', 'r2', 'R2 Storage',
         'https://api.cloudflare.com/client/v4/accounts/{account_id}/r2', FALSE
  UNION ALL SELECT 'cloudflare', 'd1', 'D1 Database',
         'https://api.cloudflare.com/client/v4/accounts/{account_id}/d1', FALSE
  UNION ALL SELECT 'cloudflare', 'kv', 'KV Store',
         'https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv', FALSE
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_endpoints pe
       ON pe.provider_id = p.id AND pe.endpoint_key = s.endpoint_key
WHERE pe.id IS NULL;

-- CATALOG: provider_model_pricing (from schema/v5.sql:1272-1285)
INSERT INTO provider_model_pricing
  (provider_model_id, effective_from, effective_to, input_price_per_million, output_price_per_million)
SELECT pm.id, s.effective_from, s.effective_to, s.input_price_per_million, s.output_price_per_million
FROM (
  SELECT 'gpt-4o' AS model_key, '2024-05-13' AS effective_from, '2024-08-31' AS effective_to, 10.00 AS input_price_per_million, 30.00 AS output_price_per_million
  UNION ALL SELECT 'gpt-4o',                 '2024-09-01', NULL,          5.00, 15.00
  UNION ALL SELECT 'gpt-4o-mini',            '2024-07-18', NULL,          0.15,  0.60
  UNION ALL SELECT 'o1',                     '2024-09-12', NULL,         15.00, 60.00
  UNION ALL SELECT 'text-embedding-3-large', '2024-01-25', NULL,          0.13, NULL
  UNION ALL SELECT 'text-embedding-3-small', '2024-01-25', NULL,          0.02, NULL
  UNION ALL SELECT 'claude-3-5-sonnet',      '2024-10-22', NULL,          3.00, 15.00
  UNION ALL SELECT 'claude-3-opus',          '2024-02-29', NULL,         15.00, 75.00
  UNION ALL SELECT 'claude-3-haiku',         '2024-03-07', NULL,          0.25,  1.25
  UNION ALL SELECT 'gemini-2.5-pro',         '2025-03-01', NULL,          1.25,  5.00
  UNION ALL SELECT 'gemini-2.5-flash',       '2025-03-01', NULL,          0.075, 0.30
  UNION ALL SELECT 'llama-3.1-70b-versatile','2024-07-01', NULL,          0.59,  0.79
  UNION ALL SELECT 'mistral-large-latest',   '2024-04-01', NULL,          2.00,  6.00
) s
JOIN provider_models pm ON pm.model_key = s.model_key
LEFT JOIN provider_model_pricing pp
       ON pp.provider_model_id = pm.id AND pp.effective_from = DATE(s.effective_from)
WHERE pp.id IS NULL;
