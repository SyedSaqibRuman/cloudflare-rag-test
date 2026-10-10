-- --------------------------
-- 026_qdrant_weaviate_auth_schema.sql
-- Completes the vector-provider trio: qdrant and weaviate existed in the
-- catalog (providers + vector_search capabilities) but, like pinecone before
-- 025, had NO provider_auth_schemas rows — the credential wizard rendered no
-- fields, so connections could not be created from the UI.
--
-- Adds the fields their adapters consume
-- (mysql/adapters/vector/{qdrant,weaviate}.js):
--   qdrant   : host (cluster URL, e.g. https://xyz.cloud.qdrant.io:6333),
--              api_key (optional — required on Qdrant Cloud, absent on
--              unauthenticated local instances; sent as the `api-key` header)
--   weaviate : host (e.g. https://xyz.weaviate.cloud),
--              api_key (optional — required on Weaviate Cloud; sent as a
--              Bearer token)
-- The collection/class name is NOT a credential field — it comes from the
-- KB's vector resource (vector_external_id), matching Pinecone.
--
-- DML only — no DDL. Idempotent: INSERT ... SELECT ... LEFT JOIN ... WHERE NULL
-- (same pattern as 004/006/007/008/025). Checksummed by mysql/migrate.js —
-- NEVER edit after applying. Add 027.
-- --------------------------

INSERT INTO provider_auth_schemas
  (provider_id, field_name, field_label, field_type, is_required, validation_regex,
   is_encrypted, encryption_storage_path, display_order, field_group,
   field_help_text, select_options, field_placeholder)
SELECT p.id, s.field_name, s.field_label, s.field_type, s.is_required, s.validation_regex,
       s.is_encrypted, s.encryption_storage_path, s.display_order, s.field_group,
       s.field_help_text, s.select_options, NULL AS field_placeholder
FROM (
  SELECT 'qdrant' AS provider_key, 'host' AS field_name, 'Qdrant Host' AS field_label,
         'url' AS field_type, TRUE AS is_required, NULL AS validation_regex,
         TRUE AS is_encrypted, 'host' AS encryption_storage_path, 10 AS display_order,
         'main' AS field_group,
         'Cluster URL from the Qdrant Cloud console, or http://localhost:6333 for local' AS field_help_text,
         NULL AS select_options, 'https://xyz.cloud.qdrant.io:6333'
  UNION ALL SELECT 'qdrant', 'api_key', 'Qdrant API Key', 'password', FALSE, NULL,
         TRUE, 'api_key', 20, 'main',
         'Required for Qdrant Cloud; leave empty for unauthenticated local instances.',
         NULL, NULL
  UNION ALL SELECT 'weaviate', 'host', 'Weaviate Host', 'url', TRUE, NULL,
         TRUE, 'host', 10, 'main',
         'Cluster URL from the Weaviate Cloud console, or http://localhost:8080 for local',
         NULL, 'https://xyz.weaviate.cloud'
  UNION ALL SELECT 'weaviate', 'api_key', 'Weaviate API Key', 'password', FALSE, NULL,
         TRUE, 'api_key', 20, 'main',
         'Required for Weaviate Cloud; leave empty for unauthenticated local instances.',
         NULL, NULL
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_auth_schemas a
       ON a.provider_id = p.id AND a.field_name = s.field_name
WHERE a.id IS NULL;
