-- --------------------------
-- 008_reseed_catalog.sql
-- Re-seed the global provider catalog for a database where the seed rows were
-- deleted after migrations 004/006 applied (their INSERT..LEFT JOIN..WHERE NULL
-- guards only work while the migration runs — a deleted provider row is never
-- re-created afterwards, leaving the catalog with only the handful of
-- providers that were re-added via the API).
--
-- DML only — no DDL. Idempotent: every INSERT uses the same
-- INSERT ... SELECT ... LEFT JOIN ... WHERE NULL pattern as 004/006, so rows
-- already present (including user-created providers) are left untouched.
-- ALSO: drops the legacy generic `api_key` auth-schema field on
-- cloudflare_worker_ai (added by the old wizard flow) now that the
-- provider-specific fields (api_token, account_id, base_url) exist.
-- Checksummed by mysql/migrate.js — NEVER edit after applying. Add 009.
-- --------------------------

-- ============================================================
-- 1. PROVIDERS (mirrors 004 §1 — values from schema/v5.sql:1094-1108)
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
-- 2. PROVIDER AUTH SCHEMAS (mirrors 004 §2 + 007 §1 — schema/v5.sql:1112-1148)
-- ============================================================
INSERT INTO provider_auth_schemas
  (provider_id, field_name, field_label, field_type, is_required, validation_regex,
   is_encrypted, encryption_storage_path, display_order, field_group,
   field_help_text, select_options, field_placeholder)
SELECT p.id, s.field_name, s.field_label, s.field_type, s.is_required, s.validation_regex,
       s.is_encrypted, s.encryption_storage_path, s.display_order, s.field_group,
       s.field_help_text, s.select_options, s.field_placeholder
FROM (
  SELECT 'openai' AS provider_key, 'api_key' AS field_name, 'OpenAI API Key' AS field_label,
         'password' AS field_type, TRUE AS is_required, '^sk-[A-Za-z0-9]{20,}$' AS validation_regex,
         TRUE AS is_encrypted, 'api_key' AS encryption_storage_path, 10 AS display_order,
         'main' AS field_group, 'Generate at https://platform.openai.com/api-keys' AS field_help_text,
         NULL AS select_options, NULL AS field_placeholder
  UNION ALL SELECT 'anthropic', 'api_key', 'Anthropic API Key', 'password', TRUE,
         '^sk-ant-[A-Za-z0-9-]{40,}$', TRUE, 'api_key', 10, 'main',
         'Generate at https://console.anthropic.com/settings/keys', NULL, NULL
  UNION ALL SELECT 'gemini', 'api_key', 'Google AI API Key', 'password', TRUE,
         '^AIza[A-Za-z0-9_-]{35}$', TRUE, 'api_key', 10, 'main',
         'Generate at https://aistudio.google.com/app/apikey', NULL, NULL
  UNION ALL SELECT 'cloudflare', 'api_token', 'Cloudflare API Token', 'password', TRUE, NULL,
         TRUE, 'api_token', 10, 'main', 'Generate at https://dash.cloudflare.com/profile/api-tokens', NULL, NULL
  UNION ALL SELECT 'cloudflare', 'account_id', 'Cloudflare Account ID', 'text', TRUE, NULL,
         TRUE, 'account_id', 20, 'main', 'Found in the Cloudflare dashboard URL after /accounts/', NULL, NULL
  UNION ALL SELECT 'cloudflare', 'zone_id', 'Zone ID (optional)', 'text', FALSE, NULL,
         TRUE, 'zone_id', 30, 'advanced', 'Only needed for zone-scoped resources', NULL, NULL
  UNION ALL SELECT 'cloudflare_vectorize', 'api_token', 'Cloudflare API Token', 'password', TRUE, NULL,
         TRUE, 'api_token', 10, 'main', 'Generate at https://dash.cloudflare.com/profile/api-tokens', NULL, NULL
  UNION ALL SELECT 'cloudflare_vectorize', 'account_id', 'Cloudflare Account ID', 'text', TRUE, NULL,
         TRUE, 'account_id', 20, 'main', 'Found in the Cloudflare dashboard URL after /accounts/', NULL, NULL
  UNION ALL SELECT 'cloudflare_r2', 'api_token', 'Cloudflare API Token', 'password', TRUE, NULL,
         TRUE, 'api_token', 10, 'main', 'Generate at https://dash.cloudflare.com/profile/api-tokens', NULL, NULL
  UNION ALL SELECT 'cloudflare_r2', 'account_id', 'Cloudflare Account ID', 'text', TRUE, NULL,
         TRUE, 'account_id', 20, 'main', 'Found in the Cloudflare dashboard URL after /accounts/', NULL, NULL
  UNION ALL SELECT 'cloudflare_r2', 'access_key_id', 'R2 Access Key ID', 'text', FALSE, NULL,
         TRUE, 'access_key_id', 30, 'main', 'Only needed for S3 API access to buckets', NULL, NULL
  UNION ALL SELECT 'cloudflare_r2', 'secret_access_key', 'R2 Secret Access Key', 'password', FALSE, NULL,
         TRUE, 'secret_access_key', 40, 'main', 'Only needed for S3 API access to buckets', NULL, NULL
  UNION ALL SELECT 'aws_s3', 'access_key_id', 'AWS Access Key ID', 'text', TRUE, NULL,
         TRUE, 'access_key_id', 10, 'main', NULL, NULL, NULL
  UNION ALL SELECT 'aws_s3', 'secret_access_key', 'AWS Secret Access Key', 'password', TRUE, NULL,
         TRUE, 'secret_access_key', 20, 'main', NULL, NULL, NULL
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
         ), NULL
  UNION ALL SELECT 'neo4j', 'uri', 'Neo4j URI', 'url', TRUE, NULL,
         TRUE, 'uri', 10, 'main', 'bolt://localhost:7687 or neo4j+s://xxx.databases.neo4j.io', NULL, NULL
  UNION ALL SELECT 'neo4j', 'username', 'Username', 'text', TRUE, NULL,
         TRUE, 'username', 20, 'main', 'Default: neo4j', NULL, NULL
  UNION ALL SELECT 'neo4j', 'password', 'Password', 'password', TRUE, NULL,
         TRUE, 'password', 30, 'main', NULL, NULL, NULL
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_auth_schemas a
       ON a.provider_id = p.id AND a.field_name = s.field_name
WHERE a.id IS NULL;

-- ============================================================
-- 3. PROVIDER CAPABILITIES (mirrors 004 §3 — schema/v5.sql:1151-1183)
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
-- 4. PROVIDER RESOURCE TYPES (mirrors 004 §4 — schema/v5.sql:1195-1254)
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
-- 5. CLEANUP — drop the legacy generic `api_key` field on
--    cloudflare_worker_ai (it now has api_token / account_id / base_url).
--    Only removes the generic field; the provider-specific fields stay.
-- ============================================================
DELETE a FROM provider_auth_schemas a
JOIN providers p ON p.id = a.provider_id
WHERE p.provider_key = 'cloudflare_worker_ai'
  AND a.field_name = 'api_key';
