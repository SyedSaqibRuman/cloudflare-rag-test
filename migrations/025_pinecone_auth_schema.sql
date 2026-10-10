-- --------------------------
-- 025_pinecone_auth_schema.sql
-- The pinecone provider existed in the catalog (004/006/008) with a
-- vector_search capability and a vector_index resource template, but had NO
-- provider_auth_schemas rows — the credential wizard rendered zero fields, so
-- a Pinecone connection could not be created from the UI.
--
-- Adds the four fields the PineconeAdapter consumes
-- (mysql/adapters/vector/pinecone.js):
--   api_key      secret, "Api-Key" header auth (pc-… user key or pcsk_… serverless key)
--   environment  legacy pod-based env (e.g. us-east1-gcp) — only needed when
--                the adapter must derive the data-plane host
--   namespace    optional serverless namespace scoping for upsert/query
--   host         explicit data-plane host override — REQUIRED for modern
--                serverless keys (pcsk_…), which carry no project segment to
--                derive https://<index>-<project>.svc.<env>.pinecone.io from
--
-- DML only — no DDL. Idempotent: INSERT ... SELECT ... LEFT JOIN ... WHERE NULL
-- (same pattern as 004/006/007/008). Checksummed by mysql/migrate.js — NEVER
-- edit after applying. Add 026.
-- --------------------------

INSERT INTO provider_auth_schemas
  (provider_id, field_name, field_label, field_type, is_required, validation_regex,
   is_encrypted, encryption_storage_path, display_order, field_group,
   field_help_text, select_options, field_placeholder)
SELECT p.id, s.field_name, s.field_label, s.field_type, s.is_required, s.validation_regex,
       s.is_encrypted, s.encryption_storage_path, s.display_order, s.field_group,
       s.field_help_text, s.select_options, s.field_placeholder
FROM (
  SELECT 'pinecone' AS provider_key, 'api_key' AS field_name, 'Pinecone API Key' AS field_label,
         'password' AS field_type, TRUE AS is_required, NULL AS validation_regex,
         TRUE AS is_encrypted, 'api_key' AS encryption_storage_path, 10 AS display_order,
         'main' AS field_group,
         'Generate at https://app.pinecone.io (API Keys section)' AS field_help_text,
         NULL AS select_options, NULL AS field_placeholder
  UNION ALL SELECT 'pinecone', 'host', 'Data-Plane Host', 'url', FALSE, NULL,
         TRUE, 'host', 20, 'main',
         'Serverless keys (pcsk_…) require this: the https://<index>-xxx.svc.<env>.pinecone.io URL shown on the index page. Legacy keys may leave it empty.',
         NULL, 'https://my-index-abc123.svc.pinecone.io'
  UNION ALL SELECT 'pinecone', 'environment', 'Environment (legacy pods)', 'text', FALSE, NULL,
         TRUE, 'environment', 30, 'main',
         'Legacy pod-based environment (e.g. us-east1-gcp). Leave empty for serverless indexes.',
         NULL, 'us-east1-gcp'
  UNION ALL SELECT 'pinecone', 'namespace', 'Namespace (optional)', 'text', FALSE, NULL,
         TRUE, 'namespace', 40, 'advanced',
         'Scopes all upserts and queries to one namespace. Leave empty for the default namespace.',
         NULL, ''
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_auth_schemas a
       ON a.provider_id = p.id AND a.field_name = s.field_name
WHERE a.id IS NULL;
