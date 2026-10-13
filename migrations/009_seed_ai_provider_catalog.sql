-- --------------------------
-- 009_seed_ai_provider_catalog.sql
-- Seed the remaining AI providers so the catalog matches the 9Router-style
-- provider set (base URL + auth header + key schema + default models per
-- provider). DML only — no DDL. Idempotent: every INSERT uses the
-- INSERT ... SELECT ... LEFT JOIN ... WHERE NULL pattern, so rows already
-- present (including user-created providers) are left untouched.
-- Checksummed by mysql/migrate.js — NEVER edit after applying. Add 010.
--
-- Providers added: deepseek, xai, nvidia, perplexity, together, fireworks,
-- cerebras, cohere, openrouter, minimax, glm, kimi, nebius, siliconflow,
-- hyperbolic. Each gets one flagship chat model; cohere also gets an
-- embedding model (embeddings capability). auth schemas are the standard
-- single api_key password field.
-- --------------------------

-- ============================================================
-- 1. PROVIDERS
-- ============================================================
INSERT INTO providers
  (provider_key, provider_name, primary_service_category, default_api_base_url,
   auth_type, auth_header_name, api_key_format_regex)
SELECT s.provider_key, s.provider_name, s.primary_service_category,
       s.default_api_base_url, s.auth_type, s.auth_header_name, s.api_key_format_regex
FROM (
  SELECT 'deepseek' AS provider_key, 'DeepSeek' AS provider_name, 'ai' AS primary_service_category,
         'https://api.deepseek.com' AS default_api_base_url, 'bearer_token' AS auth_type,
         'Authorization' AS auth_header_name, '^sk-[A-Za-z0-9]{20,}$' AS api_key_format_regex
  UNION ALL SELECT 'xai', 'xAI', 'ai', 'https://api.x.ai/v1',
         'bearer_token', 'Authorization', '^xai-[A-Za-z0-9]{20,}$'
  UNION ALL SELECT 'nvidia', 'NVIDIA NIM', 'ai', 'https://integrate.api.nvidia.com/v1',
         'bearer_token', 'Authorization', '^nvapi-[A-Za-z0-9-]{20,}$'
  UNION ALL SELECT 'perplexity', 'Perplexity', 'ai', 'https://api.perplexity.ai',
         'bearer_token', 'Authorization', '^pplx-[A-Za-z0-9]{20,}$'
  UNION ALL SELECT 'together', 'Together AI', 'ai', 'https://api.together.xyz/v1',
         'bearer_token', 'Authorization', '^[A-Za-z0-9]{32,}$'
  UNION ALL SELECT 'fireworks', 'Fireworks AI', 'ai', 'https://api.fireworks.ai/inference/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'cerebras', 'Cerebras', 'ai', 'https://api.cerebras.ai/v1',
         'bearer_token', 'Authorization', '^cerebras_[A-Za-z0-9]{20,}$'
  UNION ALL SELECT 'cohere', 'Cohere', 'ai', 'https://api.cohere.ai',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'openrouter', 'OpenRouter', 'ai', 'https://openrouter.ai/api/v1',
         'bearer_token', 'Authorization', '^sk-or-v1-[A-Za-z0-9-]{20,}$'
  UNION ALL SELECT 'minimax', 'MiniMax', 'ai', 'https://api.minimax.io',
         'api_key', 'x-api-key', NULL
  UNION ALL SELECT 'glm', 'Z.ai GLM', 'ai', 'https://api.z.ai/api',
         'api_key', 'x-api-key', NULL
  UNION ALL SELECT 'kimi', 'Kimi (Moonshot)', 'ai', 'https://api.kimi.com/coding',
         'api_key', 'x-api-key', '^sk-[A-Za-z0-9]{20,}$'
  UNION ALL SELECT 'nebius', 'Nebius AI', 'ai', 'https://api.studio.nebius.ai/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'siliconflow', 'SiliconFlow', 'ai', 'https://api.siliconflow.com/v1',
         'bearer_token', 'Authorization', '^sk-[A-Za-z0-9]{20,}$'
  UNION ALL SELECT 'hyperbolic', 'Hyperbolic', 'ai', 'https://api.hyperbolic.xyz/v1',
         'bearer_token', 'Authorization', NULL
) s
LEFT JOIN providers p ON p.provider_key = s.provider_key
WHERE p.id IS NULL;

-- ============================================================
-- 2. PROVIDER AUTH SCHEMAS (single api_key password field each)
-- ============================================================
INSERT INTO provider_auth_schemas
  (provider_id, field_name, field_label, field_type, is_required, validation_regex,
   is_encrypted, encryption_storage_path, display_order, field_group,
   field_help_text, select_options, field_placeholder)
SELECT p.id, s.field_name, s.field_label, s.field_type, s.is_required, s.validation_regex,
       s.is_encrypted, s.encryption_storage_path, s.display_order, s.field_group,
       s.field_help_text, s.select_options, s.field_placeholder
FROM (
  SELECT 'deepseek' AS provider_key, 'api_key' AS field_name, 'DeepSeek API Key' AS field_label,
         'password' AS field_type, TRUE AS is_required, '^sk-[A-Za-z0-9]{20,}$' AS validation_regex,
         TRUE AS is_encrypted, 'api_key' AS encryption_storage_path, 10 AS display_order,
         'main' AS field_group, 'Generate at https://platform.deepseek.com/api_keys' AS field_help_text,
         NULL AS select_options, NULL AS field_placeholder
  UNION ALL SELECT 'xai', 'api_key', 'xAI API Key', 'password', TRUE,
         '^xai-[A-Za-z0-9]{20,}$', TRUE, 'api_key', 10, 'main',
         'Generate at https://console.x.ai/settings/api-keys', NULL, NULL
  UNION ALL SELECT 'nvidia', 'api_key', 'NVIDIA API Key', 'password', TRUE,
         '^nvapi-[A-Za-z0-9-]{20,}$', TRUE, 'api_key', 10, 'main',
         'Generate at https://org.ngc.nvidia.com/setup/api-key', NULL, NULL
  UNION ALL SELECT 'perplexity', 'api_key', 'Perplexity API Key', 'password', TRUE,
         '^pplx-[A-Za-z0-9]{20,}$', TRUE, 'api_key', 10, 'main',
         'Generate at https://www.perplexity.ai/settings/api', NULL, NULL
  UNION ALL SELECT 'together', 'api_key', 'Together API Key', 'password', TRUE,
         NULL, TRUE, 'api_key', 10, 'main',
         'Generate at https://api.together.xyz/settings/api-keys', NULL, NULL
  UNION ALL SELECT 'fireworks', 'api_key', 'Fireworks API Key', 'password', TRUE,
         NULL, TRUE, 'api_key', 10, 'main',
         'Generate at https://fireworks.ai/account/api-keys', NULL, NULL
  UNION ALL SELECT 'cerebras', 'api_key', 'Cerebras API Key', 'password', TRUE,
         NULL, TRUE, 'api_key', 10, 'main',
         'Generate at https://cloud.cerebras.ai/platform/account/api-keys', NULL, NULL
  UNION ALL SELECT 'cohere', 'api_key', 'Cohere API Key', 'password', TRUE,
         NULL, TRUE, 'api_key', 10, 'main',
         'Generate at https://dashboard.cohere.com/api-keys', NULL, NULL
  UNION ALL SELECT 'openrouter', 'api_key', 'OpenRouter API Key', 'password', TRUE,
         '^sk-or-v1-[A-Za-z0-9-]{20,}$', TRUE, 'api_key', 10, 'main',
         'Generate at https://openrouter.ai/settings/keys', NULL, NULL
  UNION ALL SELECT 'minimax', 'api_key', 'MiniMax API Key', 'password', TRUE,
         NULL, TRUE, 'api_key', 10, 'main',
         'Generate at https://platform.minimaxi.com/user-center/basic-information', NULL, NULL
  UNION ALL SELECT 'glm', 'api_key', 'GLM API Key', 'password', TRUE,
         NULL, TRUE, 'api_key', 10, 'main',
         'Generate at https://z.ai/console/keys', NULL, NULL
  UNION ALL SELECT 'kimi', 'api_key', 'Kimi API Key', 'password', TRUE,
         '^sk-[A-Za-z0-9]{20,}$', TRUE, 'api_key', 10, 'main',
         'Generate at https://platform.moonshot.cn/console/api-keys', NULL, NULL
  UNION ALL SELECT 'nebius', 'api_key', 'Nebius API Key', 'password', TRUE,
         NULL, TRUE, 'api_key', 10, 'main',
         'Generate at https://studio.nebius.ai/settings/api-keys', NULL, NULL
  UNION ALL SELECT 'siliconflow', 'api_key', 'SiliconFlow API Key', 'password', TRUE,
         NULL, TRUE, 'api_key', 10, 'main',
         'Generate at https://cloud.siliconflow.cn/account/ak', NULL, NULL
  UNION ALL SELECT 'hyperbolic', 'api_key', 'Hyperbolic API Key', 'password', TRUE,
         NULL, TRUE, 'api_key', 10, 'main',
         'Generate at https://app.hyperbolic.xyz/settings', NULL, NULL
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_auth_schemas a
       ON a.provider_id = p.id AND a.field_name = s.field_name
WHERE a.id IS NULL;

-- ============================================================
-- 3. PROVIDER CAPABILITIES (chat + streaming; cohere also embeddings)
-- ============================================================
INSERT INTO provider_capabilities (provider_id, capability_key, is_supported, config)
SELECT p.id, s.capability_key, s.is_supported, s.config
FROM (
  SELECT 'deepseek' AS provider_key, 'chat' AS capability_key, TRUE AS is_supported, NULL AS config
  UNION ALL SELECT 'deepseek', 'streaming', TRUE, NULL
  UNION ALL SELECT 'xai', 'chat', TRUE, NULL
  UNION ALL SELECT 'xai', 'streaming', TRUE, NULL
  UNION ALL SELECT 'nvidia', 'chat', TRUE, NULL
  UNION ALL SELECT 'nvidia', 'streaming', TRUE, NULL
  UNION ALL SELECT 'perplexity', 'chat', TRUE, NULL
  UNION ALL SELECT 'perplexity', 'streaming', TRUE, NULL
  UNION ALL SELECT 'together', 'chat', TRUE, NULL
  UNION ALL SELECT 'together', 'streaming', TRUE, NULL
  UNION ALL SELECT 'fireworks', 'chat', TRUE, NULL
  UNION ALL SELECT 'fireworks', 'streaming', TRUE, NULL
  UNION ALL SELECT 'cerebras', 'chat', TRUE, NULL
  UNION ALL SELECT 'cerebras', 'streaming', TRUE, NULL
  UNION ALL SELECT 'cohere', 'chat', TRUE, NULL
  UNION ALL SELECT 'cohere', 'streaming', TRUE, NULL
  UNION ALL SELECT 'cohere', 'embeddings', TRUE, JSON_OBJECT('default_dimensions',1024)
  UNION ALL SELECT 'openrouter', 'chat', TRUE, NULL
  UNION ALL SELECT 'openrouter', 'streaming', TRUE, NULL
  UNION ALL SELECT 'minimax', 'chat', TRUE, NULL
  UNION ALL SELECT 'minimax', 'streaming', TRUE, NULL
  UNION ALL SELECT 'glm', 'chat', TRUE, NULL
  UNION ALL SELECT 'glm', 'streaming', TRUE, NULL
  UNION ALL SELECT 'kimi', 'chat', TRUE, NULL
  UNION ALL SELECT 'kimi', 'streaming', TRUE, NULL
  UNION ALL SELECT 'nebius', 'chat', TRUE, NULL
  UNION ALL SELECT 'nebius', 'streaming', TRUE, NULL
  UNION ALL SELECT 'siliconflow', 'chat', TRUE, NULL
  UNION ALL SELECT 'siliconflow', 'streaming', TRUE, NULL
  UNION ALL SELECT 'hyperbolic', 'chat', TRUE, NULL
  UNION ALL SELECT 'hyperbolic', 'streaming', TRUE, NULL
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_capabilities c
       ON c.provider_id = p.id AND c.capability_key = s.capability_key
WHERE c.id IS NULL;

-- ============================================================
-- 4. PROVIDER MODELS (one flagship chat model per provider + Cohere embedding)
-- ============================================================
INSERT INTO provider_models
  (provider_id, model_key, model_name, model_family, category, supports_streaming,
   supports_function_calling, supports_vision, max_context_window, max_output_tokens)
SELECT p.id, s.model_key, s.model_name, s.model_family, s.category, s.supports_streaming,
       s.supports_function_calling, s.supports_vision, s.max_context_window, s.max_output_tokens
FROM (
  SELECT 'deepseek' AS provider_key, 'deepseek-chat' AS model_key, 'DeepSeek V3' AS model_name,
         'deepseek' AS model_family, 'chat' AS category, TRUE AS supports_streaming,
         TRUE AS supports_function_calling, FALSE AS supports_vision,
         64000 AS max_context_window, 8192 AS max_output_tokens
  UNION ALL SELECT 'xai', 'grok-4', 'Grok 4', 'grok', 'chat', TRUE, TRUE, TRUE, 256000, 32768
  UNION ALL SELECT 'nvidia', 'nvidia/llama-3.1-nemotron-70b-instruct', 'Llama 3.1 Nemotron 70B',
         'llama', 'chat', TRUE, TRUE, FALSE, 131072, 8192
  UNION ALL SELECT 'perplexity', 'sonar-pro', 'Sonar Pro', 'sonar', 'chat', TRUE, TRUE, FALSE, 200000, 4096
  UNION ALL SELECT 'together', 'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B',
         'llama', 'chat', TRUE, TRUE, FALSE, 131072, 8192
  UNION ALL SELECT 'fireworks', 'accounts/fireworks/models/llama-v3p3-70b-instruct', 'Llama 3.3 70B',
         'llama', 'chat', TRUE, TRUE, FALSE, 131072, 8192
  UNION ALL SELECT 'cerebras', 'llama-3.3-70b', 'Llama 3.3 70B', 'llama', 'chat', TRUE, TRUE, FALSE, 131072, 8192
  UNION ALL SELECT 'cohere', 'command-r-plus', 'Command R+', 'command', 'chat', TRUE, TRUE, TRUE, 128000, 4096
  UNION ALL SELECT 'cohere', 'embed-english-v3', 'Embed English v3', 'embed', 'embedding', FALSE, FALSE, FALSE, 512, NULL
  UNION ALL SELECT 'openrouter', 'anthropic/claude-3.5-sonnet', 'Claude 3.5 Sonnet', 'claude', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'minimax', 'minimax-m2', 'MiniMax M2', 'minimax', 'chat', TRUE, TRUE, FALSE, 200000, 8192
  UNION ALL SELECT 'glm', 'glm-4.7', 'GLM-4.7', 'glm', 'chat', TRUE, TRUE, FALSE, 200000, 8192
  UNION ALL SELECT 'kimi', 'kimi-latest', 'Kimi', 'kimi', 'chat', TRUE, TRUE, FALSE, 131072, 8192
  UNION ALL SELECT 'nebius', 'meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 'llama', 'chat', TRUE, TRUE, FALSE, 131072, 8192
  UNION ALL SELECT 'siliconflow', 'deepseek-ai/DeepSeek-V3', 'DeepSeek V3', 'deepseek', 'chat', TRUE, TRUE, FALSE, 64000, 8192
  UNION ALL SELECT 'hyperbolic', 'meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B', 'llama', 'chat', TRUE, TRUE, FALSE, 131072, 8192
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_models m
       ON m.provider_id = p.id AND m.model_key = s.model_key
WHERE m.id IS NULL;
