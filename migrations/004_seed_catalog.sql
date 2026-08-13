-- --------------------------
-- 004_seed_catalog.sql
-- Seed the global provider catalog (providers, auth schemas, capabilities,
-- resource types, models) plus the endpoints + pricing that depend on it.
-- The live DB has DDL but zero catalog rows, so 003 (endpoints/pricing only)
-- was a no-op there. This migration makes the catalog reproducible.
-- DML only — no DDL. Idempotent: rows already present are skipped.
-- Checksummed by mysql/migrate.js — NEVER edit after applying. Add 005.
-- Values copied verbatim from schema/v5.sql reference seed.
-- --------------------------

-- ============================================================
-- 1. PROVIDERS (schema/v5.sql:1094-1108)
-- ============================================================
INSERT INTO providers
  (provider_key, provider_name, primary_service_category, default_api_base_url,
   auth_type, auth_header_name, api_key_format_regex)
SELECT s.provider_key, s.provider_name, s.primary_service_category,
       s.default_api_base_url, s.auth_type, s.auth_header_name, s.api_key_format_regex
FROM (
  SELECT 'openai' AS provider_key, 'OpenAI' AS provider_name, 'ai' AS primary_service_category,
         'https://api.openai.com/v1' AS default_api_base_url, 'bearer_token' AS auth_type,
         'Authorization' AS auth_header_name, '^sk-[A-Za-z0-9]{20,}$' AS api_key_format_regex
  UNION ALL SELECT 'anthropic', 'Anthropic', 'ai', 'https://api.anthropic.com',
         'api_key', 'x-api-key', '^sk-ant-[A-Za-z0-9-]{40,}$'
  UNION ALL SELECT 'gemini', 'Google Gemini', 'ai', 'https://generativelanguage.googleapis.com/v1beta',
         'api_key', 'key', '^AIza[A-Za-z0-9_-]{35}$'
  UNION ALL SELECT 'groq', 'Groq', 'ai', 'https://api.groq.com/openai/v1',
         'bearer_token', 'Authorization', '^gsk_[A-Za-z0-9]{20,}$'
  UNION ALL SELECT 'mistral', 'Mistral AI', 'ai', 'https://api.mistral.ai',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'cloudflare', 'Cloudflare', 'ai', 'https://api.cloudflare.com/client/v4',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'cloudflare_vectorize', 'Cloudflare Vectorize', 'vector', 'https://api.cloudflare.com/client/v4',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'cloudflare_r2', 'Cloudflare R2', 'storage', 'https://{account}.r2.cloudflarestorage.com',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'cloudflare_d1', 'Cloudflare D1', 'database', 'https://api.cloudflare.com/client/v4',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'pinecone', 'Pinecone', 'vector', 'https://api.pinecone.io',
         'api_key', 'Api-Key', NULL
  UNION ALL SELECT 'weaviate', 'Weaviate', 'vector', NULL,
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'qdrant', 'Qdrant', 'vector', NULL,
         'api_key', 'api-key', NULL
  UNION ALL SELECT 'aws_s3', 'AWS S3', 'storage', 'https://s3.amazonaws.com',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'neo4j', 'Neo4j', 'graph', 'bolt://localhost:7687',
         'basic_auth', 'Authorization', NULL
) s
LEFT JOIN providers p ON p.provider_key = s.provider_key
WHERE p.id IS NULL;

-- ============================================================
-- 2. PROVIDER AUTH SCHEMAS (schema/v5.sql:1112-1148)
-- ============================================================
INSERT INTO provider_auth_schemas
  (provider_id, field_name, field_label, field_type, is_required, validation_regex,
   is_encrypted, encryption_storage_path, display_order, field_group,
   field_help_text, select_options)
SELECT p.id, s.field_name, s.field_label, s.field_type, s.is_required, s.validation_regex,
       s.is_encrypted, s.encryption_storage_path, s.display_order, s.field_group,
       s.field_help_text, s.select_options
FROM (
  SELECT 'openai' AS provider_key, 'api_key' AS field_name, 'OpenAI API Key' AS field_label,
         'password' AS field_type, TRUE AS is_required, '^sk-[A-Za-z0-9]{20,}$' AS validation_regex,
         TRUE AS is_encrypted, 'api_key' AS encryption_storage_path, 10 AS display_order,
         'main' AS field_group, NULL AS field_help_text, NULL AS select_options
  UNION ALL SELECT 'anthropic', 'api_key', 'Anthropic API Key', 'password', TRUE,
         '^sk-ant-[A-Za-z0-9-]{40,}$', TRUE, 'api_key', 10, 'main', NULL, NULL
  UNION ALL SELECT 'cloudflare', 'api_token', 'Cloudflare API Token', 'password', TRUE, NULL,
         TRUE, 'api_token', 10, 'main', 'Generate at https://dash.cloudflare.com/profile/api-tokens', NULL
  UNION ALL SELECT 'cloudflare', 'account_id', 'Cloudflare Account ID', 'text', TRUE, NULL,
         TRUE, 'account_id', 20, 'main', 'Found in the Cloudflare dashboard URL after /accounts/', NULL
  UNION ALL SELECT 'cloudflare', 'zone_id', 'Zone ID (optional)', 'text', FALSE, NULL,
         TRUE, 'zone_id', 30, 'advanced', 'Only needed for zone-scoped resources', NULL
  UNION ALL SELECT 'aws_s3', 'access_key_id', 'AWS Access Key ID', 'text', TRUE, NULL,
         TRUE, 'access_key_id', 10, 'main', NULL, NULL
  UNION ALL SELECT 'aws_s3', 'secret_access_key', 'AWS Secret Access Key', 'password', TRUE, NULL,
         TRUE, 'secret_access_key', 20, 'main', NULL, NULL
  UNION ALL SELECT 'aws_s3', 'region', 'AWS Region', 'select', TRUE, NULL,
         FALSE, 'region', 30, 'main', NULL,
         JSON_ARRAY(
            JSON_OBJECT('value','us-east-1','label','US East (N. Virginia)'),
            JSON_OBJECT('value','us-east-2','label','US East (Ohio)'),
            JSON_OBJECT('value','us-west-1','label','US West (N. California)'),
            JSON_OBJECT('value','us-west-2','label','US West (Oregon)'),
            JSON_OBJECT('value','eu-west-1','label','Europe (Ireland)'),
            JSON_OBJECT('value','eu-central-1','label','Europe (Frankfurt)'),
            JSON_OBJECT('value','ap-southeast-1','label','Asia Pacific (Singapore)'),
            JSON_OBJECT('value','ap-northeast-1','label','Asia Pacific (Tokyo)')
         )
  UNION ALL SELECT 'neo4j', 'uri', 'Neo4j URI', 'url', TRUE, NULL,
         TRUE, 'uri', 10, 'main', 'bolt://localhost:7687 or neo4j+s://xxx.databases.neo4j.io', NULL
  UNION ALL SELECT 'neo4j', 'username', 'Username', 'text', TRUE, NULL,
         TRUE, 'username', 20, 'main', 'Default: neo4j', NULL
  UNION ALL SELECT 'neo4j', 'password', 'Password', 'password', TRUE, NULL,
         TRUE, 'password', 30, 'main', NULL, NULL
  UNION ALL SELECT 'gemini', 'api_key', 'Google AI API Key', 'password', TRUE,
         '^AIza[A-Za-z0-9_-]{35}$', TRUE, 'api_key', 10, 'main', NULL, NULL
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_auth_schemas a
       ON a.provider_id = p.id AND a.field_name = s.field_name
WHERE a.id IS NULL;

-- ============================================================
-- 3. PROVIDER CAPABILITIES (schema/v5.sql:1151-1183)
-- ============================================================
INSERT INTO provider_capabilities
  (provider_id, capability_key, is_supported, config)
SELECT p.id, s.capability_key, s.is_supported, s.config
FROM (
  SELECT 'openai' AS provider_key, 'chat' AS capability_key, TRUE AS is_supported, JSON_OBJECT('default_max_tokens',4096) AS config
  UNION ALL SELECT 'openai', 'streaming', TRUE, NULL
  UNION ALL SELECT 'openai', 'embeddings', TRUE, JSON_OBJECT('default_dimensions',1536)
  UNION ALL SELECT 'openai', 'function_calling', TRUE, JSON_OBJECT('max_tools',128)
  UNION ALL SELECT 'openai', 'vision', TRUE, JSON_OBJECT('max_image_size_mb',20)
  UNION ALL SELECT 'openai', 'audio_output', TRUE, NULL
  UNION ALL SELECT 'openai', 'reasoning', TRUE, JSON_OBJECT('series',JSON_ARRAY('o1','o3'))
  UNION ALL SELECT 'anthropic', 'chat', TRUE, NULL
  UNION ALL SELECT 'anthropic', 'streaming', TRUE, NULL
  UNION ALL SELECT 'anthropic', 'function_calling', TRUE, JSON_OBJECT('max_tools',64)
  UNION ALL SELECT 'anthropic', 'vision', TRUE, NULL
  UNION ALL SELECT 'anthropic', 'reasoning', TRUE, JSON_OBJECT('mode','extended_thinking')
  UNION ALL SELECT 'cloudflare', 'chat', TRUE, NULL
  UNION ALL SELECT 'cloudflare', 'streaming', TRUE, NULL
  UNION ALL SELECT 'cloudflare', 'embeddings', TRUE, NULL
  UNION ALL SELECT 'cloudflare', 'vector_index_resource', TRUE, JSON_OBJECT('max_indexes_per_account',100)
  UNION ALL SELECT 'cloudflare', 'object_bucket_resource', TRUE, JSON_OBJECT('s3_compatible',TRUE)
  UNION ALL SELECT 'cloudflare', 'sql_database_resource', TRUE, JSON_OBJECT('engine','sqlite-compatible')
  UNION ALL SELECT 'cloudflare', 'kv_namespace_resource', TRUE, NULL
  UNION ALL SELECT 'cloudflare_vectorize', 'vector_search', TRUE, JSON_OBJECT('max_dimensions',1536)
  UNION ALL SELECT 'cloudflare_vectorize', 'vector_index_resource', TRUE, NULL
  UNION ALL SELECT 'cloudflare_r2', 'object_storage', TRUE, NULL
  UNION ALL SELECT 'cloudflare_r2', 'object_bucket_resource', TRUE, JSON_OBJECT('s3_compatible',TRUE)
  UNION ALL SELECT 'cloudflare_d1', 'sql_database_resource', TRUE, JSON_OBJECT('engine','sqlite-compatible')
  UNION ALL SELECT 'pinecone', 'vector_search', TRUE, NULL
  UNION ALL SELECT 'pinecone', 'vector_index_resource', TRUE, NULL
  UNION ALL SELECT 'neo4j', 'graph_database_resource', TRUE, NULL
  UNION ALL SELECT 'neo4j', 'graph_storage', TRUE, JSON_OBJECT('supports_cypher',TRUE)
  UNION ALL SELECT 'qdrant', 'vector_search', TRUE, NULL
  UNION ALL SELECT 'qdrant', 'vector_index_resource', TRUE, NULL
  UNION ALL SELECT 'aws_s3', 'object_storage', TRUE, NULL
  UNION ALL SELECT 'aws_s3', 'object_bucket_resource', TRUE, NULL
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_capabilities c
       ON c.provider_id = p.id AND c.capability_key = s.capability_key
WHERE c.id IS NULL;

-- ============================================================
-- 4. PROVIDER RESOURCE TYPES (schema/v5.sql:1195-1254)
-- ============================================================
INSERT INTO provider_resource_types
  (provider_id, resource_type, display_name, description, icon_name, display_color,
   is_required, config_schema, provision_endpoint_key, display_order)
SELECT p.id, s.resource_type, s.display_name, s.description, s.icon_name, s.display_color,
       s.is_required, s.config_schema, s.provision_endpoint_key, s.display_order
FROM (
  SELECT 'cloudflare' AS provider_key, 'vector_index' AS resource_type, 'Vector Index' AS display_name,
         'Serverless vector database for similarity search' AS description,
         'cube' AS icon_name, '#FF6B35' AS display_color, FALSE AS is_required,
         JSON_OBJECT(
            'index_name', JSON_OBJECT('type','text','required',TRUE,'placeholder','my-embeddings'),
            'dimensions', JSON_OBJECT('type','numeric','required',TRUE,'default',1536,'min',1,'max',4096),
            'metric',    JSON_OBJECT('type','select','required',TRUE,'default','cosine','options',JSON_ARRAY('cosine','euclidean','dot-product'))
         ) AS config_schema,
         'vectorize' AS provision_endpoint_key, 10 AS display_order
  UNION ALL SELECT 'cloudflare', 'object_bucket', 'R2 Bucket', 'S3-compatible object storage with free egress',
         'archive-box', '#F6821F', FALSE,
         JSON_OBJECT(
            'bucket_name', JSON_OBJECT('type','text','required',TRUE,'pattern','^[a-z0-9][a-z0-9-]{2,62}$'),
            'location_hint', JSON_OBJECT('type','select','required',FALSE,'default','auto','options',JSON_ARRAY('auto','enam','weur','apac')),
            'lifecycle_days', JSON_OBJECT('type','numeric','required',FALSE,'default',90)
         ),
         'r2', 20
  UNION ALL SELECT 'cloudflare', 'sql_database', 'D1 Database', 'Serverless SQLite-compatible SQL database',
         'database', '#F38020', FALSE,
         JSON_OBJECT(
            'database_name', JSON_OBJECT('type','text','required',TRUE),
            'region', JSON_OBJECT('type','select','required',FALSE,'default','auto','options',JSON_ARRAY('auto','enam','weur','apac'))
         ),
         'd1', 30
  UNION ALL SELECT 'cloudflare', 'kv_namespace', 'KV Namespace', 'Globally distributed low-latency key-value store',
         'key', '#FAAD3F', FALSE,
         JSON_OBJECT(
            'namespace_title', JSON_OBJECT('type','text','required',TRUE)
         ),
         'kv', 40
  UNION ALL SELECT 'pinecone', 'vector_index', 'Pinecone Index', 'Managed vector index',
         NULL, NULL, FALSE,
         JSON_OBJECT(
            'index_name', JSON_OBJECT('type','text','required',TRUE),
            'dimension',  JSON_OBJECT('type','numeric','required',TRUE,'default',1536),
            'metric',     JSON_OBJECT('type','select','required',TRUE,'default','cosine','options',JSON_ARRAY('cosine','euclidean','dotproduct')),
            'cloud',      JSON_OBJECT('type','select','required',TRUE,'default','aws','options',JSON_ARRAY('aws','gcp','azure')),
            'region',     JSON_OBJECT('type','select','required',TRUE,'default','us-east-1','options',JSON_ARRAY('us-east-1','us-west-2','eu-west-1'))
         ),
         NULL, 10
  UNION ALL SELECT 'neo4j', 'graph_database', 'Neo4j Graph Database', 'Cypher-queryable property graph database',
         NULL, NULL, TRUE,
         JSON_OBJECT(
            'database_name', JSON_OBJECT('type','text','required',TRUE,'placeholder','neo4j'),
            'memory_config', JSON_OBJECT('type','json','required',FALSE,'placeholder','{"page_cache_size_mb": 512}')
         ),
         NULL, 10
  UNION ALL SELECT 'openai', 'none', 'No Resources', NULL,
         NULL, NULL, FALSE, NULL, NULL, 99
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_resource_types t
       ON t.provider_id = p.id AND t.resource_type = s.resource_type
WHERE t.id IS NULL;

-- ============================================================
-- 5. PROVIDER MODELS (schema/v5.sql:1257-1269)
-- ============================================================
INSERT INTO provider_models
  (provider_id, model_key, model_name, model_family, category,
   supports_streaming, supports_function_calling, supports_vision,
   max_context_window, max_output_tokens)
SELECT p.id, s.model_key, s.model_name, s.model_family, s.category,
       s.supports_streaming, s.supports_function_calling, s.supports_vision,
       s.max_context_window, s.max_output_tokens
FROM (
  SELECT 'openai' AS provider_key, 'gpt-4o' AS model_key, 'GPT-4o' AS model_name, 'gpt-4o' AS model_family, 'chat' AS category,
         TRUE AS supports_streaming, TRUE AS supports_function_calling, TRUE AS supports_vision, 128000 AS max_context_window, 4096 AS max_output_tokens
  UNION ALL SELECT 'openai', 'gpt-4o-mini', 'GPT-4o Mini', 'gpt-4o', 'chat', TRUE, TRUE, TRUE, 128000, 16384
  UNION ALL SELECT 'openai', 'o1', 'o1', 'o1', 'chat', FALSE, FALSE, FALSE, 200000, 32768
  UNION ALL SELECT 'openai', 'text-embedding-3-large', 'Text Embedding 3 Large', 'embedding-3', 'embedding', FALSE, FALSE, FALSE, 8191, NULL
  UNION ALL SELECT 'openai', 'text-embedding-3-small', 'Text Embedding 3 Small', 'embedding-3', 'embedding', FALSE, FALSE, FALSE, 8191, NULL
  UNION ALL SELECT 'anthropic', 'claude-3-5-sonnet', 'Claude 3.5 Sonnet', 'claude-3', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'anthropic', 'claude-3-opus', 'Claude 3 Opus', 'claude-3', 'chat', TRUE, TRUE, TRUE, 200000, 4096
  UNION ALL SELECT 'anthropic', 'claude-3-haiku', 'Claude 3 Haiku', 'claude-3', 'chat', TRUE, TRUE, TRUE, 200000, 4096
  UNION ALL SELECT 'gemini', 'gemini-2.5-pro', 'Gemini 2.5 Pro', 'gemini-2', 'chat', TRUE, TRUE, TRUE, 2000000, 8192
  UNION ALL SELECT 'gemini', 'gemini-2.5-flash', 'Gemini 2.5 Flash', 'gemini-2', 'chat', TRUE, TRUE, TRUE, 1000000, 8192
  UNION ALL SELECT 'groq', 'llama-3.1-70b-versatile', 'Llama 3.1 70B', 'llama-3', 'chat', TRUE, TRUE, FALSE, 131072, 8192
  UNION ALL SELECT 'mistral', 'mistral-large-latest', 'Mistral Large', 'mistral-large', 'chat', TRUE, TRUE, FALSE, 128000, 8192
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_models m
       ON m.provider_id = p.id AND m.model_key = s.model_key
WHERE m.id IS NULL;

-- ============================================================
-- 6. PROVIDER ENDPOINTS (schema/v5.sql:1186-1191)
-- ============================================================
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

-- ============================================================
-- 7. PROVIDER MODEL PRICING (schema/v5.sql:1272-1285)
-- ============================================================
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
