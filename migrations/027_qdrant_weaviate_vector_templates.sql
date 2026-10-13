-- --------------------------
-- 027_qdrant_weaviate_vector_templates.sql
-- Gives Qdrant and Weaviate `vector_index` resource templates so the KB wizard
-- / provider detail page can bind KBs to their indexes — previously only
-- Pinecone (004) had one, so the wizard showed no bindable resource for them.
-- These are "register-existing" templates: both services auto-create the
-- collection/class on first upsert (adapters' ensureIndex), so no provision
-- endpoint is attached (provision_endpoint_key NULL — the admin registers the
-- external name, the adapter ensures it exists).
--
-- DML only — no DDL. Idempotent: INSERT ... SELECT ... LEFT JOIN ... WHERE NULL
-- (same pattern as 004/006). Checksummed by mysql/migrate.js — NEVER edit after
-- applying. Add 028.
-- --------------------------

INSERT INTO provider_resource_types
  (provider_id, resource_type, display_name, description, icon_name, display_color,
   is_required, config_schema, provision_endpoint_key, display_order)
SELECT p.id, s.resource_type, s.display_name, s.description, s.icon_name, s.display_color,
       s.is_required, s.config_schema, s.provision_endpoint_key, s.display_order
FROM (
  SELECT 'qdrant' AS provider_key, 'vector_index' AS resource_type, 'Qdrant Collection' AS display_name,
         'Qdrant collection storing the KB''s vectors (auto-created on first ingest)' AS description,
         'database' AS icon_name, '#DC382D' AS display_color, FALSE AS is_required,
         JSON_OBJECT(
            'collection_name', JSON_OBJECT('type','text','required',TRUE,'placeholder','my-kb-vectors'),
            'distance', JSON_OBJECT('type','select','required',FALSE,'default','Cosine','options',JSON_ARRAY('Cosine','Euclid','Dot'))
         ) AS config_schema,
         NULL AS provision_endpoint_key, 10 AS display_order
  UNION ALL SELECT 'weaviate', 'vector_index', 'Weaviate Class', 'Weaviate class storing the KB''s vectors (auto-created on first ingest)',
         'database', '#705FDC', FALSE,
         JSON_OBJECT(
            'class_name', JSON_OBJECT('type','text','required',TRUE,'placeholder','MyKbVectors'),
            'vectorizer', JSON_OBJECT('type','select','required',FALSE,'default','none','options',JSON_ARRAY('none'))
         ),
         NULL, 10
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_resource_types t
       ON t.provider_id = p.id AND t.resource_type = s.resource_type
WHERE t.id IS NULL;
