-- --------------------------
-- 028_openai_vector_store.sql
-- Makes OpenAI a configurable VECTOR provider: its hosted Vector Stores
-- (POST /v1/vector_stores) become bindable as a KB's vector index.
--
--   1. provider_capabilities: 'vector_search' + 'vector_index_resource' for
--      openai (the provider row + bearer auth schema already exist from 004).
--   2. provider_resource_types: a 'vector_index' template whose config_schema
--      carries the OpenAI-specific knobs. NOTE the resource contract differs
--      from Pinecone/Qdrant/Weaviate:
--        - vector_store_id is REQUIRED: OpenAI vector stores are opaque IDs
--          (vs_…), not admin-named indexes. The KB's vector_external_id must
--          be the vs_… id (or the adapter falls back to config.vector_store_id).
--        - No dimensions/metric: OpenAI stores embeddings internally (File
--          Search), so ingestion does NOT pre-embed — the adapter uploads raw
--          chunk text and lets OpenAI embed + rerank (search returns 0..1
--          scores + inline content text).
--
-- DML only — no DDL. Idempotent: INSERT ... SELECT ... LEFT JOIN ... WHERE NULL
-- (same pattern as 025/026/027). Checksummed by mysql/migrate.js — NEVER edit
-- after applying. Add 029 next.
-- --------------------------

-- 1. Capabilities (guarded: skip when the row already exists)
INSERT INTO provider_capabilities (provider_id, capability_key, is_supported, config)
SELECT p.id, s.capability_key, TRUE, s.config
FROM (
  SELECT 'openai' AS provider_key, 'vector_search' AS capability_key, NULL AS config
  UNION ALL SELECT 'openai', 'vector_index_resource', NULL
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_capabilities pc
  ON pc.provider_id = p.id AND pc.capability_key = s.capability_key
WHERE pc.id IS NULL;

-- 2. Resource template (same guarded pattern; config_schema is what the KB
--    wizard renders when binding an OpenAI vector resource)
INSERT INTO provider_resource_types
  (provider_id, resource_type, display_name, description, icon_name, display_color,
   is_required, config_schema, provision_endpoint_key, display_order)
SELECT p.id, s.resource_type, s.display_name, s.description, s.icon_name, s.display_color,
       s.is_required, s.config_schema, s.provision_endpoint_key, s.display_order
FROM (
  SELECT 'openai' AS provider_key,
         'vector_index' AS resource_type,
         'OpenAI Vector Store' AS display_name,
         'OpenAI hosted vector store (vs_… id) — chunks upload as text, OpenAI embeds and ranks them internally' AS description,
         'database' AS icon_name, '#10A37F' AS display_color, FALSE AS is_required,
         JSON_OBJECT(
            'vector_store_id', JSON_OBJECT('type','text','required',TRUE,'placeholder','vs_abc123',
                                           'help','Create one via POST /v1/vector_stores (or the dashboard) and paste its id here'),
            'max_num_results', JSON_OBJECT('type','number','required',FALSE,'default',10,
                                           'help','1-50: max chunks returned per search (adapters cap at 50 per the API)')
         ) AS config_schema,
         NULL AS provision_endpoint_key, 10 AS display_order
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_resource_types prt
  ON prt.provider_id = p.id AND prt.resource_type = s.resource_type
WHERE prt.id IS NULL;
