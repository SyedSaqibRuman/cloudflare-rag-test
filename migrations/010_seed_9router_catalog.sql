-- --------------------------
-- 010_seed_9router_catalog.sql
-- Seed the FULL 9Router provider catalog (92 providers) so the gateway matches
-- the provider set exposed by 9Router's open-sse/providers/registry. Base URLs,
-- auth headers, key schemas, and flagship models are taken from the 9Router
-- registry entries (transport.baseUrl minus the /chat/completions suffix, since
-- this repo's executor appends that path itself).
--
-- DML only -- no DDL. Idempotent: every INSERT uses the
-- INSERT ... SELECT ... LEFT JOIN ... WHERE NULL pattern, so rows already
-- present (including user-created providers) are left untouched.
-- Checksummed by mysql/migrate.js -- NEVER edit after applying. Add 011.
--
-- Groups: AI chat/LLM (56), embeddings (1), web search (12), TTS (10),
-- STT (3), image/video (9), self-hosted (1). OAuth-subscription providers
-- (claude, codex, cursor, antigravity, github, gemini-cli, ...) get an
-- oauth2/custom auth type and a `token` field so a pasted session token can be
-- stored -- they have no public API key.
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
  -- ---------- AI chat / LLM ----------
  SELECT 'azure' AS provider_key, 'Azure OpenAI' AS provider_name, 'ai' AS primary_service_category,
         'https://{resource}.openai.azure.com/openai' AS default_api_base_url, 'custom' AS auth_type,
         'Authorization' AS auth_header_name, NULL AS api_key_format_regex
  UNION ALL SELECT 'sambanova', 'SambaNova', 'ai', 'https://api.sambanova.ai/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'tencent', 'Tencent Hunyuan', 'ai', 'https://api.hunyuan.cloud.tencent.com/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'baidu', 'Baidu Qianfan', 'ai', 'https://qianfan.baidubce.com/v2',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'venice', 'Venice AI', 'ai', 'https://api.venice.ai/api/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'huggingface', 'Hugging Face', 'ai', 'https://api-inference.huggingface.co',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'poolside', 'Poolside', 'ai', 'https://inference.poolside.ai/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'chutes', 'Chutes AI', 'ai', 'https://llm.chutes.ai/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'featherless', 'Featherless', 'ai', 'https://api.featherless.ai/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'blackbox', 'Blackbox AI', 'ai', 'https://api.blackbox.ai/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'glm-cn', 'GLM (China)', 'ai', 'https://open.bigmodel.cn/api/coding/paas/v4',
         'api_key', 'x-api-key', NULL
  UNION ALL SELECT 'minimax-cn', 'MiniMax (China)', 'ai', 'https://api.minimaxi.com/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'alims-intl', 'Alibaba Studio', 'ai', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'alicode', 'Alibaba Coding', 'ai', 'https://coding.dashscope.aliyuncs.com/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'alicode-intl', 'Alibaba Coding Intl', 'ai', 'https://coding-intl.dashscope.aliyuncs.com/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'byteplus', 'BytePlus ModelArk', 'ai', 'https://ark.ap-southeast.bytepluses.com/api/coding/v3',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'volcengine-ark', 'Volcengine Ark', 'ai', 'https://ark.cn-beijing.volces.com/api/coding/v3',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'tokenrouter', 'TokenRouter', 'ai', 'https://api.tokenrouter.com/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'api-airforce', 'API.airforce', 'ai', 'https://api.airforce/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'bazaarlink', 'Bazaarlink', 'ai', 'https://bazaarlink.ai/api/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'bluesminds', 'BluesMinds', 'ai', 'https://api.bluesminds.com/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'kilo-gateway', 'Kilo Gateway', 'ai', 'https://api.kilo.ai/api/gateway',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'llm7', 'LLM7', 'ai', 'https://api.llm7.io/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'morph', 'Morph', 'ai', 'https://api.morphllm.com/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'nanobanana', 'NanoBanana', 'ai', 'https://api.nanobananaapi.ai/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'xiaomi-mimo', 'Xiaomi MiMo', 'ai', 'https://api.xiaomimimo.com/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'xiaomi-tokenplan', 'Xiaomi MiMo Token Plan', 'ai', 'https://token-plan-sgp.xiaomimimo.com/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'mimo-free', 'MiMo Code Free', 'ai', 'https://api.xiaomimimo.com/api/free-ai/openai',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'iflow', 'iFlow AI', 'ai', 'https://apis.iflow.cn/v1',
         'oauth2', 'Authorization', NULL
  UNION ALL SELECT 'qoder', 'Qoder', 'ai', 'https://api3.qoder.sh/algo/api/v2/service/pro/sse',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'zed', 'Zed', 'ai', 'https://cloud.zed.dev',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'commandcode', 'Command Code', 'ai', 'https://api.commandcode.ai/alpha',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'clinepass', 'ClinePass', 'ai', 'https://api.cline.bot/api/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'perplexity-agent', 'Perplexity Agent', 'ai', 'https://api.perplexity.ai/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'opencode', 'OpenCode Free', 'ai', 'https://opencode.ai',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'opencode-go', 'OpenCode Go', 'ai', 'https://opencode.ai/zen/go/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'vercel-ai-gateway', 'Vercel AI Gateway', 'ai', 'https://ai-gateway.vercel.sh/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'vertex', 'Vertex AI', 'ai', 'https://aiplatform.googleapis.com',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'vertex-partner', 'Vertex Partner', 'ai', 'https://aiplatform.googleapis.com',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'kiro', 'Kiro AI', 'ai', 'https://runtime.us-east-1.kiro.dev',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'grok-web', 'Grok Web', 'ai', 'https://grok.com',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'grok-cli', 'Grok CLI', 'ai', 'https://cli-chat-proxy.grok.com',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'ollama', 'Ollama Cloud', 'ai', 'https://ollama.com',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'ollama-local', 'Ollama Local', 'ai', 'http://localhost:11434',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'local-device', 'Local Device', 'ai', NULL,
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'jina-ai', 'Jina AI', 'ai', 'https://api.jina.ai/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'perplexity-web', 'Perplexity Web', 'ai', 'https://www.perplexity.ai',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'claude', 'Claude Code', 'ai', 'https://api.anthropic.com',
         'oauth2', 'Authorization', NULL
  UNION ALL SELECT 'codex', 'OpenAI Codex', 'ai', 'https://chatgpt.com/backend-api/codex',
         'oauth2', 'Authorization', NULL
  UNION ALL SELECT 'cursor', 'Cursor IDE', 'ai', 'https://api2.cursor.sh',
         'oauth2', 'Authorization', NULL
  UNION ALL SELECT 'antigravity', 'Antigravity', 'ai', 'https://cloudcode-pa.googleapis.com',
         'oauth2', 'Authorization', NULL
  UNION ALL SELECT 'github', 'GitHub Copilot', 'ai', 'https://api.githubcopilot.com',
         'oauth2', 'Authorization', NULL
  UNION ALL SELECT 'kimchi', 'Kimchi', 'ai', 'https://llm.kimchi.dev/openai/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'gemini-cli', 'Gemini CLI', 'ai', 'https://cloudcode-pa.googleapis.com/v1internal',
         'oauth2', 'Authorization', NULL
  UNION ALL SELECT 'cline', 'Cline', 'ai', 'https://api.cline.bot/api/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'kilocode', 'Kilo Code', 'ai', 'https://api.kilo.ai/api/openrouter',
         'bearer_token', 'Authorization', NULL
  -- ---------- Embeddings ----------
  UNION ALL SELECT 'voyage-ai', 'Voyage AI', 'ai', 'https://api.voyageai.com/v1',
         'bearer_token', 'Authorization', NULL
  -- ---------- Web search ----------
  UNION ALL SELECT 'brave-search', 'Brave Search', 'ai', 'https://api.search.brave.com',
         'custom', 'X-Subscription-Token', NULL
  UNION ALL SELECT 'tavily', 'Tavily', 'ai', 'https://api.tavily.com',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'serper', 'Serper', 'ai', 'https://google.serper.dev',
         'custom', 'X-API-KEY', NULL
  UNION ALL SELECT 'searxng', 'SearXNG', 'ai', 'http://localhost:8080',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'exa', 'Exa', 'ai', 'https://api.exa.ai',
         'custom', 'x-api-key', NULL
  UNION ALL SELECT 'linkup', 'Linkup', 'ai', 'https://api.linkup.so',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'searchapi', 'SearchAPI', 'ai', 'https://www.searchapi.io',
         'custom', 'api_key', NULL
  UNION ALL SELECT 'youcom', 'You.com Search', 'ai', 'https://ydc-index.io',
         'custom', 'X-API-Key', NULL
  UNION ALL SELECT 'google-pse', 'Google PSE', 'ai', 'https://www.googleapis.com/customsearch/v1',
         'custom', 'key', NULL
  UNION ALL SELECT 'firecrawl', 'Firecrawl', 'ai', 'https://api.firecrawl.dev',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'jina-reader', 'Jina Reader', 'ai', 'https://r.jina.ai',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'gitlab', 'GitLab', 'ai', 'https://gitlab.com',
         'custom', 'Authorization', NULL
  -- ---------- TTS ----------
  UNION ALL SELECT 'elevenlabs', 'ElevenLabs', 'ai', 'https://api.elevenlabs.io',
         'custom', 'xi-api-key', NULL
  UNION ALL SELECT 'playht', 'PlayHT', 'ai', 'https://api.play.ai',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'edge-tts', 'Edge TTS', 'ai', NULL,
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'google-tts', 'Google TTS', 'ai', NULL,
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'aws-polly', 'AWS Polly', 'ai', 'https://polly.us-east-1.amazonaws.com',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'cartesia', 'Cartesia', 'ai', 'https://api.cartesia.ai',
         'custom', 'X-API-Key', NULL
  UNION ALL SELECT 'coqui', 'Coqui TTS', 'ai', 'http://localhost:5002',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'tortoise', 'Tortoise TTS', 'ai', 'http://localhost:8080',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'inworld', 'Inworld TTS', 'ai', 'https://api.inworld.ai/tts/v1',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'selfhosted-tts', 'Self-hosted TTS', 'ai', 'http://localhost:8080',
         'custom', 'Authorization', NULL
  -- ---------- STT ----------
  UNION ALL SELECT 'assemblyai', 'AssemblyAI', 'ai', 'https://api.assemblyai.com',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'deepgram', 'Deepgram', 'ai', 'https://api.deepgram.com',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'selfhosted-stt', 'Self-hosted STT', 'ai', 'http://localhost:8080',
         'custom', 'Authorization', NULL
  -- ---------- Image / video ----------
  UNION ALL SELECT 'black-forest-labs', 'Black Forest Labs', 'ai', 'https://api.bfl.ml',
         'custom', 'X-Key', NULL
  UNION ALL SELECT 'stability-ai', 'Stability AI', 'ai', 'https://api.stability.ai',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'recraft', 'Recraft', 'ai', 'https://external.api.recraft.ai',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'runwayml', 'Runway', 'ai', 'https://api.dev.runwayml.com/v1',
         'bearer_token', 'Authorization', NULL
  UNION ALL SELECT 'fal-ai', 'fal.ai', 'ai', 'https://queue.fal.run',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'topaz', 'Topaz', 'ai', 'https://api.topazlabs.com',
         'custom', 'X-Api-Key', NULL
  UNION ALL SELECT 'comfyui', 'ComfyUI', 'ai', 'http://localhost:8188',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'sdwebui', 'SD WebUI', 'ai', 'http://localhost:7860',
         'custom', 'Authorization', NULL
  UNION ALL SELECT 'mmf', 'MMF', 'ai', 'https://api.xiaomimimo.com/api/free-ai/openai',
         'custom', 'Authorization', NULL
  -- ---------- Self-hosted ----------
  UNION ALL SELECT 'selfhosted-embedding', 'Self-hosted Embedding', 'ai', 'http://localhost:8080/v1',
         'custom', 'Authorization', NULL
) s
LEFT JOIN providers p ON p.provider_key = s.provider_key
WHERE p.id IS NULL;

-- ============================================================
-- 2. PROVIDER AUTH SCHEMAS (single key field per provider; Azure and
--    AWS Polly get extra fields). `token` fields are for OAuth/subscription
--    providers where a pasted session token is the credential.
-- ============================================================
INSERT INTO provider_auth_schemas
  (provider_id, field_name, field_label, field_type, is_required, validation_regex,
   is_encrypted, encryption_storage_path, display_order, field_group,
   field_help_text, select_options, field_placeholder)
SELECT p.id, s.field_name, s.field_label, s.field_type, s.is_required, s.validation_regex,
       s.is_encrypted, s.encryption_storage_path, s.display_order, s.field_group,
       s.field_help_text, s.select_options, s.field_placeholder
FROM (
  -- Azure OpenAI: API key + resource name
  SELECT 'azure' AS provider_key, 'api_key' AS field_name, 'Azure OpenAI API Key' AS field_label,
         'password' AS field_type, TRUE AS is_required, NULL AS validation_regex,
         TRUE AS is_encrypted, 'api_key' AS encryption_storage_path, 10 AS display_order,
         'main' AS field_group, 'Generate at https://portal.azure.com (Azure OpenAI service keys)' AS field_help_text,
         NULL AS select_options, NULL AS field_placeholder
  UNION ALL SELECT 'azure', 'resource', 'Azure Resource Name', 'text', TRUE, NULL,
         TRUE, 'resource', 20, 'main', 'The {resource} in https://{resource}.openai.azure.com', NULL, NULL
  -- Standard api_key fields
  UNION ALL SELECT 'sambanova', 'api_key', 'SambaNova API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://cloud.sambanova.ai/apis', NULL, NULL
  UNION ALL SELECT 'tencent', 'api_key', 'Tencent Hunyuan API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://console.cloud.tencent.com/hunyuan/api-key', NULL, NULL
  UNION ALL SELECT 'baidu', 'api_key', 'Baidu Qianfan API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://console.bce.baidu.com/qianfan', NULL, NULL
  UNION ALL SELECT 'venice', 'api_key', 'Venice API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://venice.ai/settings/api', NULL, NULL
  UNION ALL SELECT 'huggingface', 'api_key', 'Hugging Face Token', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://huggingface.co/settings/tokens', NULL, NULL
  UNION ALL SELECT 'poolside', 'api_key', 'Poolside API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://platform.poolside.ai/api-keys', NULL, NULL
  UNION ALL SELECT 'chutes', 'api_key', 'Chutes API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://chutes.ai/app/api', NULL, NULL
  UNION ALL SELECT 'featherless', 'api_key', 'Featherless API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://featherless.ai/account/api-keys', NULL, NULL
  UNION ALL SELECT 'blackbox', 'api_key', 'Blackbox API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://www.blackbox.ai/api-management', NULL, NULL
  UNION ALL SELECT 'glm-cn', 'api_key', 'GLM (China) API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://open.bigmodel.cn/usercenter/apikeys', NULL, NULL
  UNION ALL SELECT 'minimax-cn', 'api_key', 'MiniMax (China) API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://platform.minimaxi.com/user-center/basic-information', NULL, NULL
  UNION ALL SELECT 'alims-intl', 'api_key', 'Alibaba Studio API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://modelstudio.console.alibabacloud.com', NULL, NULL
  UNION ALL SELECT 'alicode', 'api_key', 'Alibaba Coding API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://bailian.console.aliyun.com', NULL, NULL
  UNION ALL SELECT 'alicode-intl', 'api_key', 'Alibaba Coding Intl API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://www.alibabacloud.com/product/coding', NULL, NULL
  UNION ALL SELECT 'byteplus', 'api_key', 'BytePlus API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://console.byteplus.com/ark', NULL, NULL
  UNION ALL SELECT 'volcengine-ark', 'api_key', 'Volcengine Ark API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://console.volcengine.com/ark', NULL, NULL
  UNION ALL SELECT 'tokenrouter', 'api_key', 'TokenRouter API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://www.tokenrouter.com', NULL, NULL
  UNION ALL SELECT 'api-airforce', 'api_key', 'API.airforce API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://api.airforce', NULL, NULL
  UNION ALL SELECT 'bazaarlink', 'api_key', 'Bazaarlink API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://bazaarlink.ai', NULL, NULL
  UNION ALL SELECT 'bluesminds', 'api_key', 'BluesMinds API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://bluesminds.com', NULL, NULL
  UNION ALL SELECT 'kilo-gateway', 'api_key', 'Kilo Gateway API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://kilo.ai/dashboard?tab=apiKeys', NULL, NULL
  UNION ALL SELECT 'llm7', 'api_key', 'LLM7 API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://llm7.io', NULL, NULL
  UNION ALL SELECT 'morph', 'api_key', 'Morph API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://morphllm.com', NULL, NULL
  UNION ALL SELECT 'nanobanana', 'api_key', 'NanoBanana API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://nanobananaapi.ai/dashboard', NULL, NULL
  UNION ALL SELECT 'xiaomi-mimo', 'api_key', 'Xiaomi MiMo API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://platform.xiaomimimo.com/console/api-keys', NULL, NULL
  UNION ALL SELECT 'xiaomi-tokenplan', 'api_key', 'MiMo Token Plan API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Token Plan keys start with tp-; get one at https://mimo.xiaomi.com', NULL, NULL
  UNION ALL SELECT 'mimo-free', 'api_key', 'MiMo Free API Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Free channel - a key may not be required', NULL, NULL
  UNION ALL SELECT 'iflow', 'token', 'iFlow Token', 'password', FALSE, NULL,
         TRUE, 'token', 10, 'main', 'OAuth subscription - paste a session token if available', NULL, NULL
  UNION ALL SELECT 'qoder', 'token', 'Qoder Personal Access Token', 'password', TRUE, NULL,
         TRUE, 'token', 10, 'main', 'PAT (pt-...) from https://qoder.com/account/integrations', NULL, NULL
  UNION ALL SELECT 'zed', 'token', 'Zed Access Token', 'password', TRUE, NULL,
         TRUE, 'token', 10, 'main', 'OAuth subscription - paste the access token from zed.dev', NULL, NULL
  UNION ALL SELECT 'commandcode', 'api_key', 'Command Code API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'CLI key (user_...) from https://commandcode.ai/studio', NULL, NULL
  UNION ALL SELECT 'clinepass', 'api_key', 'ClinePass API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://app.cline.bot', NULL, NULL
  UNION ALL SELECT 'perplexity-agent', 'api_key', 'Perplexity API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://www.perplexity.ai/settings/api', NULL, NULL
  UNION ALL SELECT 'opencode', 'api_key', 'OpenCode Free Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'No auth required for the free tier', NULL, NULL
  UNION ALL SELECT 'opencode-go', 'api_key', 'OpenCode Go API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://opencode.ai/auth', NULL, NULL
  UNION ALL SELECT 'vercel-ai-gateway', 'api_key', 'Vercel AI Gateway API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://vercel.com/dashboard/~/ai-gateway', NULL, NULL
  UNION ALL SELECT 'vertex', 'api_key', 'Vertex AI API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'GCP service account key; generate at https://console.cloud.google.com/iam-admin/serviceaccounts', NULL, NULL
  UNION ALL SELECT 'vertex-partner', 'api_key', 'Vertex Partner API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'GCP service account key; generate at https://console.cloud.google.com/iam-admin/serviceaccounts', NULL, NULL
  UNION ALL SELECT 'kiro', 'token', 'Kiro Token', 'password', TRUE, NULL,
         TRUE, 'token', 10, 'main', 'OAuth subscription - paste the Kiro session token from kiro.dev', NULL, NULL
  UNION ALL SELECT 'grok-web', 'token', 'Grok Web SSO Cookie', 'password', TRUE, NULL,
         TRUE, 'token', 10, 'main', 'Paste the sso= cookie value from grok.com (SuperGrok subscription)', NULL, NULL
  UNION ALL SELECT 'grok-cli', 'token', 'Grok CLI Token', 'password', TRUE, NULL,
         TRUE, 'token', 10, 'main', 'OAuth subscription - sign in via device code at https://grok.com/supergrok', NULL, NULL
  UNION ALL SELECT 'ollama', 'api_key', 'Ollama Cloud API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://ollama.com/settings/keys', NULL, NULL
  UNION ALL SELECT 'ollama-local', 'api_key', 'Ollama Local Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Local server at http://localhost:11434 - key is not checked', NULL, NULL
  UNION ALL SELECT 'local-device', 'api_key', 'Local Device Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'On-device TTS - no key required', NULL, NULL
  UNION ALL SELECT 'jina-ai', 'api_key', 'Jina AI API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://jina.ai (10M free tokens on signup)', NULL, NULL
  UNION ALL SELECT 'perplexity-web', 'token', 'Perplexity Session Cookie', 'password', TRUE, NULL,
         TRUE, 'token', 10, 'main', 'Paste the __Secure-next-auth.session-token cookie value from perplexity.ai (Pro/Max)', NULL, NULL
  UNION ALL SELECT 'claude', 'token', 'Claude Code Token', 'password', FALSE, NULL,
         TRUE, 'token', 10, 'main', 'OAuth subscription - paste the Claude Code session token', NULL, NULL
  UNION ALL SELECT 'codex', 'token', 'Codex Token', 'password', FALSE, NULL,
         TRUE, 'token', 10, 'main', 'OAuth subscription - paste the ChatGPT Codex session token', NULL, NULL
  UNION ALL SELECT 'cursor', 'token', 'Cursor Access Token', 'password', FALSE, NULL,
         TRUE, 'token', 10, 'main', 'OAuth subscription - paste the Cursor session token', NULL, NULL
  UNION ALL SELECT 'antigravity', 'token', 'Antigravity Token', 'password', FALSE, NULL,
         TRUE, 'token', 10, 'main', 'OAuth subscription - paste the Google Antigravity token', NULL, NULL
  UNION ALL SELECT 'github', 'token', 'GitHub Copilot Token', 'password', FALSE, NULL,
         TRUE, 'token', 10, 'main', 'OAuth subscription - paste the GitHub Copilot session token', NULL, NULL
  UNION ALL SELECT 'kimchi', 'api_key', 'Kimchi API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://app.kimchi.dev', NULL, NULL
  UNION ALL SELECT 'gemini-cli', 'token', 'Gemini CLI Token', 'password', FALSE, NULL,
         TRUE, 'token', 10, 'main', 'OAuth subscription - paste the Google Gemini CLI access token', NULL, NULL
  UNION ALL SELECT 'cline', 'api_key', 'Cline API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://cline.bot', NULL, NULL
  UNION ALL SELECT 'kilocode', 'api_key', 'Kilo Code API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://kilocode.ai', NULL, NULL
  UNION ALL SELECT 'voyage-ai', 'api_key', 'Voyage AI API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://dash.voyageai.com/api-keys', NULL, NULL
  -- Search
  UNION ALL SELECT 'brave-search', 'api_key', 'Brave Search API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://api.search.brave.com', NULL, NULL
  UNION ALL SELECT 'tavily', 'api_key', 'Tavily API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://app.tavily.com', NULL, NULL
  UNION ALL SELECT 'serper', 'api_key', 'Serper API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://serper.dev', NULL, NULL
  UNION ALL SELECT 'searxng', 'api_key', 'SearXNG Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Self-hosted at http://localhost:8080 - key usually not required', NULL, NULL
  UNION ALL SELECT 'exa', 'api_key', 'Exa API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://dashboard.exa.ai', NULL, NULL
  UNION ALL SELECT 'linkup', 'api_key', 'Linkup API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://app.linkup.so/api-keys', NULL, NULL
  UNION ALL SELECT 'searchapi', 'api_key', 'SearchAPI Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://www.searchapi.io/dashboard', NULL, NULL
  UNION ALL SELECT 'youcom', 'api_key', 'You.com API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://api.you.com', NULL, NULL
  UNION ALL SELECT 'google-pse', 'api_key', 'Google PSE API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://programmablesearchengine.google.com', NULL, NULL
  UNION ALL SELECT 'firecrawl', 'api_key', 'Firecrawl API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://firecrawl.dev', NULL, NULL
  UNION ALL SELECT 'jina-reader', 'api_key', 'Jina Reader API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://jina.ai', NULL, NULL
  UNION ALL SELECT 'gitlab', 'token', 'GitLab Personal Access Token', 'password', FALSE, NULL,
         TRUE, 'token', 10, 'main', 'OAuth subscription - paste a GitLab PAT for Duo', NULL, NULL
  -- TTS
  UNION ALL SELECT 'elevenlabs', 'api_key', 'ElevenLabs API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://elevenlabs.io', NULL, NULL
  UNION ALL SELECT 'playht', 'api_key', 'PlayHT API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://play.ai', NULL, NULL
  UNION ALL SELECT 'edge-tts', 'api_key', 'Edge TTS Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Local python lib - no key required', NULL, NULL
  UNION ALL SELECT 'google-tts', 'api_key', 'Google TTS Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Local gTTS - no key required', NULL, NULL
  UNION ALL SELECT 'aws-polly', 'access_key_id', 'AWS Access Key ID', 'text', TRUE, NULL,
         TRUE, 'access_key_id', 10, 'main', NULL, NULL, NULL
  UNION ALL SELECT 'aws-polly', 'secret_access_key', 'AWS Secret Access Key', 'password', TRUE, NULL,
         TRUE, 'secret_access_key', 20, 'main', NULL, NULL, NULL
  UNION ALL SELECT 'cartesia', 'api_key', 'Cartesia API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://play.cartesia.ai', NULL, NULL
  UNION ALL SELECT 'coqui', 'api_key', 'Coqui Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Local server at http://localhost:5002 - no key required', NULL, NULL
  UNION ALL SELECT 'tortoise', 'api_key', 'Tortoise Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Local server - no key required', NULL, NULL
  UNION ALL SELECT 'inworld', 'api_key', 'Inworld API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://platform.inworld.ai/api-keys', NULL, NULL
  UNION ALL SELECT 'selfhosted-tts', 'api_key', 'Self-hosted TTS Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Local server - any non-empty value works; base URL lives in the provider row', NULL, NULL
  -- STT
  UNION ALL SELECT 'assemblyai', 'api_key', 'AssemblyAI API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://www.assemblyai.com', NULL, NULL
  UNION ALL SELECT 'deepgram', 'api_key', 'Deepgram API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://console.deepgram.com', NULL, NULL
  UNION ALL SELECT 'selfhosted-stt', 'api_key', 'Self-hosted STT Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Local server - any non-empty value works', NULL, NULL
  -- Image / video
  UNION ALL SELECT 'black-forest-labs', 'api_key', 'BFL API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://api.bfl.ml', NULL, NULL
  UNION ALL SELECT 'stability-ai', 'api_key', 'Stability AI API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://platform.stability.ai', NULL, NULL
  UNION ALL SELECT 'recraft', 'api_key', 'Recraft API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://recraft.ai', NULL, NULL
  UNION ALL SELECT 'runwayml', 'api_key', 'Runway API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://dev.runwayml.com', NULL, NULL
  UNION ALL SELECT 'fal-ai', 'api_key', 'fal.ai API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://fal.ai/dashboard/keys', NULL, NULL
  UNION ALL SELECT 'topaz', 'api_key', 'Topaz API Key', 'password', TRUE, NULL,
         TRUE, 'api_key', 10, 'main', 'Generate at https://topazlabs.com/account', NULL, NULL
  UNION ALL SELECT 'comfyui', 'api_key', 'ComfyUI Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Local server at http://localhost:8188 - no key required', NULL, NULL
  UNION ALL SELECT 'sdwebui', 'api_key', 'SD WebUI Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Local server at http://localhost:7860 - no key required', NULL, NULL
  UNION ALL SELECT 'mmf', 'api_key', 'MMF Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Free channel - a key may not be required', NULL, NULL
  -- Self-hosted
  UNION ALL SELECT 'selfhosted-embedding', 'api_key', 'Self-hosted Embedding Key (optional)', 'password', FALSE, NULL,
         TRUE, 'api_key', 10, 'main', 'Local server - any non-empty value works; give it the OpenAI base (/v1) URL', NULL, NULL
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_auth_schemas a
       ON a.provider_id = p.id AND a.field_name = s.field_name
WHERE a.id IS NULL;

-- ============================================================
-- 3. PROVIDER CAPABILITIES
-- ============================================================
INSERT INTO provider_capabilities (provider_id, capability_key, is_supported, config)
SELECT p.id, s.capability_key, s.is_supported, s.config
FROM (
  -- chat + streaming
  SELECT 'azure' AS provider_key, 'chat' AS capability_key, TRUE AS is_supported, NULL AS config
  UNION ALL SELECT 'azure', 'streaming', TRUE, NULL
  UNION ALL SELECT 'sambanova', 'chat', TRUE, NULL
  UNION ALL SELECT 'sambanova', 'streaming', TRUE, NULL
  UNION ALL SELECT 'tencent', 'chat', TRUE, NULL
  UNION ALL SELECT 'tencent', 'streaming', TRUE, NULL
  UNION ALL SELECT 'baidu', 'chat', TRUE, NULL
  UNION ALL SELECT 'baidu', 'streaming', TRUE, NULL
  UNION ALL SELECT 'venice', 'chat', TRUE, NULL
  UNION ALL SELECT 'venice', 'streaming', TRUE, NULL
  UNION ALL SELECT 'venice', 'embeddings', TRUE, NULL
  UNION ALL SELECT 'huggingface', 'image_generation', TRUE, NULL
  UNION ALL SELECT 'huggingface', 'speech_to_text', TRUE, NULL
  UNION ALL SELECT 'poolside', 'chat', TRUE, NULL
  UNION ALL SELECT 'poolside', 'streaming', TRUE, NULL
  UNION ALL SELECT 'chutes', 'chat', TRUE, NULL
  UNION ALL SELECT 'chutes', 'streaming', TRUE, NULL
  UNION ALL SELECT 'featherless', 'chat', TRUE, NULL
  UNION ALL SELECT 'featherless', 'streaming', TRUE, NULL
  UNION ALL SELECT 'blackbox', 'chat', TRUE, NULL
  UNION ALL SELECT 'blackbox', 'streaming', TRUE, NULL
  UNION ALL SELECT 'glm-cn', 'chat', TRUE, NULL
  UNION ALL SELECT 'glm-cn', 'streaming', TRUE, NULL
  UNION ALL SELECT 'minimax-cn', 'chat', TRUE, NULL
  UNION ALL SELECT 'minimax-cn', 'streaming', TRUE, NULL
  UNION ALL SELECT 'alims-intl', 'chat', TRUE, NULL
  UNION ALL SELECT 'alims-intl', 'streaming', TRUE, NULL
  UNION ALL SELECT 'alicode', 'chat', TRUE, NULL
  UNION ALL SELECT 'alicode', 'streaming', TRUE, NULL
  UNION ALL SELECT 'alicode-intl', 'chat', TRUE, NULL
  UNION ALL SELECT 'alicode-intl', 'streaming', TRUE, NULL
  UNION ALL SELECT 'byteplus', 'chat', TRUE, NULL
  UNION ALL SELECT 'byteplus', 'streaming', TRUE, NULL
  UNION ALL SELECT 'volcengine-ark', 'chat', TRUE, NULL
  UNION ALL SELECT 'volcengine-ark', 'streaming', TRUE, NULL
  UNION ALL SELECT 'tokenrouter', 'chat', TRUE, NULL
  UNION ALL SELECT 'tokenrouter', 'streaming', TRUE, NULL
  UNION ALL SELECT 'api-airforce', 'chat', TRUE, NULL
  UNION ALL SELECT 'api-airforce', 'streaming', TRUE, NULL
  UNION ALL SELECT 'bazaarlink', 'chat', TRUE, NULL
  UNION ALL SELECT 'bazaarlink', 'streaming', TRUE, NULL
  UNION ALL SELECT 'bluesminds', 'chat', TRUE, NULL
  UNION ALL SELECT 'bluesminds', 'streaming', TRUE, NULL
  UNION ALL SELECT 'kilo-gateway', 'chat', TRUE, NULL
  UNION ALL SELECT 'kilo-gateway', 'streaming', TRUE, NULL
  UNION ALL SELECT 'llm7', 'chat', TRUE, NULL
  UNION ALL SELECT 'llm7', 'streaming', TRUE, NULL
  UNION ALL SELECT 'morph', 'chat', TRUE, NULL
  UNION ALL SELECT 'morph', 'streaming', TRUE, NULL
  UNION ALL SELECT 'nanobanana', 'image_generation', TRUE, NULL
  UNION ALL SELECT 'xiaomi-mimo', 'chat', TRUE, NULL
  UNION ALL SELECT 'xiaomi-mimo', 'streaming', TRUE, NULL
  UNION ALL SELECT 'xiaomi-tokenplan', 'chat', TRUE, NULL
  UNION ALL SELECT 'xiaomi-tokenplan', 'streaming', TRUE, NULL
  UNION ALL SELECT 'mimo-free', 'chat', TRUE, NULL
  UNION ALL SELECT 'iflow', 'chat', TRUE, NULL
  UNION ALL SELECT 'qoder', 'chat', TRUE, NULL
  UNION ALL SELECT 'zed', 'chat', TRUE, NULL
  UNION ALL SELECT 'commandcode', 'chat', TRUE, NULL
  UNION ALL SELECT 'clinepass', 'chat', TRUE, NULL
  UNION ALL SELECT 'clinepass', 'streaming', TRUE, NULL
  UNION ALL SELECT 'perplexity-agent', 'chat', TRUE, NULL
  UNION ALL SELECT 'perplexity-agent', 'streaming', TRUE, NULL
  UNION ALL SELECT 'perplexity-agent', 'web_search', TRUE, NULL
  UNION ALL SELECT 'opencode', 'chat', TRUE, NULL
  UNION ALL SELECT 'opencode-go', 'chat', TRUE, NULL
  UNION ALL SELECT 'opencode-go', 'streaming', TRUE, NULL
  UNION ALL SELECT 'vercel-ai-gateway', 'chat', TRUE, NULL
  UNION ALL SELECT 'vercel-ai-gateway', 'streaming', TRUE, NULL
  UNION ALL SELECT 'vercel-ai-gateway', 'embeddings', TRUE, NULL
  UNION ALL SELECT 'vertex', 'chat', TRUE, NULL
  UNION ALL SELECT 'vertex-partner', 'chat', TRUE, NULL
  UNION ALL SELECT 'kiro', 'chat', TRUE, NULL
  UNION ALL SELECT 'grok-web', 'chat', TRUE, NULL
  UNION ALL SELECT 'grok-cli', 'chat', TRUE, NULL
  UNION ALL SELECT 'ollama', 'chat', TRUE, NULL
  UNION ALL SELECT 'ollama', 'streaming', TRUE, NULL
  UNION ALL SELECT 'ollama-local', 'chat', TRUE, NULL
  UNION ALL SELECT 'jina-ai', 'embeddings', TRUE, JSON_OBJECT('default_dimensions',1024)
  UNION ALL SELECT 'perplexity-web', 'chat', TRUE, NULL
  UNION ALL SELECT 'claude', 'chat', TRUE, NULL
  UNION ALL SELECT 'codex', 'chat', TRUE, NULL
  UNION ALL SELECT 'cursor', 'chat', TRUE, NULL
  UNION ALL SELECT 'antigravity', 'chat', TRUE, NULL
  UNION ALL SELECT 'github', 'chat', TRUE, NULL
  UNION ALL SELECT 'kimchi', 'chat', TRUE, NULL
  UNION ALL SELECT 'gemini-cli', 'chat', TRUE, NULL
  UNION ALL SELECT 'cline', 'chat', TRUE, NULL
  UNION ALL SELECT 'kilocode', 'chat', TRUE, NULL
  UNION ALL SELECT 'voyage-ai', 'embeddings', TRUE, NULL
  -- web search
  UNION ALL SELECT 'brave-search', 'web_search', TRUE, NULL
  UNION ALL SELECT 'tavily', 'web_search', TRUE, NULL
  UNION ALL SELECT 'serper', 'web_search', TRUE, NULL
  UNION ALL SELECT 'searxng', 'web_search', TRUE, NULL
  UNION ALL SELECT 'exa', 'web_search', TRUE, NULL
  UNION ALL SELECT 'linkup', 'web_search', TRUE, NULL
  UNION ALL SELECT 'searchapi', 'web_search', TRUE, NULL
  UNION ALL SELECT 'youcom', 'web_search', TRUE, NULL
  UNION ALL SELECT 'google-pse', 'web_search', TRUE, NULL
  UNION ALL SELECT 'firecrawl', 'web_search', TRUE, NULL
  UNION ALL SELECT 'jina-reader', 'web_search', TRUE, NULL
  -- TTS
  UNION ALL SELECT 'elevenlabs', 'text_to_speech', TRUE, NULL
  UNION ALL SELECT 'playht', 'text_to_speech', TRUE, NULL
  UNION ALL SELECT 'edge-tts', 'text_to_speech', TRUE, NULL
  UNION ALL SELECT 'google-tts', 'text_to_speech', TRUE, NULL
  UNION ALL SELECT 'aws-polly', 'text_to_speech', TRUE, NULL
  UNION ALL SELECT 'cartesia', 'text_to_speech', TRUE, NULL
  UNION ALL SELECT 'coqui', 'text_to_speech', TRUE, NULL
  UNION ALL SELECT 'tortoise', 'text_to_speech', TRUE, NULL
  UNION ALL SELECT 'inworld', 'text_to_speech', TRUE, NULL
  UNION ALL SELECT 'selfhosted-tts', 'text_to_speech', TRUE, NULL
  UNION ALL SELECT 'local-device', 'text_to_speech', TRUE, NULL
  -- STT
  UNION ALL SELECT 'assemblyai', 'speech_to_text', TRUE, NULL
  UNION ALL SELECT 'deepgram', 'speech_to_text', TRUE, NULL
  UNION ALL SELECT 'selfhosted-stt', 'speech_to_text', TRUE, NULL
  -- image / video
  UNION ALL SELECT 'black-forest-labs', 'image_generation', TRUE, NULL
  UNION ALL SELECT 'stability-ai', 'image_generation', TRUE, NULL
  UNION ALL SELECT 'recraft', 'image_generation', TRUE, NULL
  UNION ALL SELECT 'runwayml', 'image_generation', TRUE, NULL
  UNION ALL SELECT 'fal-ai', 'image_generation', TRUE, NULL
  UNION ALL SELECT 'topaz', 'image_generation', TRUE, NULL
  UNION ALL SELECT 'comfyui', 'image_generation', TRUE, NULL
  UNION ALL SELECT 'sdwebui', 'image_generation', TRUE, NULL
  -- self-hosted
  UNION ALL SELECT 'selfhosted-embedding', 'embeddings', TRUE, NULL
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_capabilities c
       ON c.provider_id = p.id AND c.capability_key = s.capability_key
WHERE c.id IS NULL;

-- ============================================================
-- 4. PROVIDER MODELS (flagship per provider -- ids from the 9Router registry)
-- ============================================================
INSERT INTO provider_models
  (provider_id, model_key, model_name, model_family, category, supports_streaming,
   supports_function_calling, supports_vision, max_context_window, max_output_tokens)
SELECT p.id, s.model_key, s.model_name, s.model_family, s.category, s.supports_streaming,
       s.supports_function_calling, s.supports_vision, s.max_context_window, s.max_output_tokens
FROM (
  SELECT 'azure' AS provider_key, 'gpt-4o' AS model_key, 'GPT-4o' AS model_name,
         'gpt' AS model_family, 'chat' AS category, TRUE AS supports_streaming,
         TRUE AS supports_function_calling, TRUE AS supports_vision,
         128000 AS max_context_window, 16384 AS max_output_tokens
  UNION ALL SELECT 'sambanova', 'MiniMax-M2.7', 'MiniMax M2.7', 'minimax', 'chat', TRUE, TRUE, FALSE, 196608, 8192
  UNION ALL SELECT 'tencent', 'hunyuan-turbos-latest', 'Hunyuan TurboS Latest', 'hunyuan', 'chat', TRUE, TRUE, FALSE, 200000, 8192
  UNION ALL SELECT 'tencent', 'hunyuan-t1-latest', 'Hunyuan T1 Latest', 'hunyuan', 'chat', TRUE, TRUE, FALSE, 256000, 8192
  UNION ALL SELECT 'baidu', 'deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 'chat', TRUE, TRUE, FALSE, 1048576, 32768
  UNION ALL SELECT 'venice', 'venice-uncensored-1-2', 'Venice Uncensored 1.2', 'venice', 'chat', TRUE, TRUE, TRUE, 128000, 8192
  UNION ALL SELECT 'venice', 'zai-org-glm-5', 'GLM-5 (Venice)', 'glm', 'chat', TRUE, TRUE, FALSE, 200000, 8192
  UNION ALL SELECT 'venice', 'text-embedding-3-large', 'Text Embedding 3 Large', 'openai-embed', 'embedding', FALSE, FALSE, FALSE, 8192, NULL
  UNION ALL SELECT 'huggingface', 'black-forest-labs/FLUX.1-schnell', 'FLUX.1 Schnell', 'flux', 'image', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'huggingface', 'openai/whisper-large-v3', 'Whisper Large v3', 'whisper', 'stt', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'poolside', 'poolside/laguna-s-2.1', 'Laguna S 2.1', 'laguna', 'chat', TRUE, TRUE, FALSE, 128000, 8192
  UNION ALL SELECT 'featherless', 'deepseek-ai/DeepSeek-V4-Pro', 'DeepSeek V4 Pro', 'deepseek', 'chat', TRUE, TRUE, FALSE, 128000, 32768
  UNION ALL SELECT 'blackbox', 'claude-sonnet-4.6', 'Claude Sonnet 4.6', 'claude', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'glm-cn', 'glm-5.2', 'GLM 5.2', 'glm', 'chat', TRUE, TRUE, FALSE, 200000, 8192
  UNION ALL SELECT 'minimax-cn', 'MiniMax-M2.7', 'MiniMax M2.7', 'minimax', 'chat', TRUE, TRUE, FALSE, 200704, 8192
  UNION ALL SELECT 'minimax-cn', 'MiniMax-M3', 'MiniMax M3', 'minimax', 'chat', TRUE, TRUE, FALSE, 1048576, 8192
  UNION ALL SELECT 'alims-intl', 'qwen3.5-plus', 'Qwen3.5 Plus', 'qwen', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'alicode', 'qwen3.5-plus', 'Qwen3.5 Plus', 'qwen', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'alicode-intl', 'qwen3.5-plus', 'Qwen3.5 Plus', 'qwen', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'byteplus', 'seed-2-0-pro-260328', 'Seed 2.0 Pro', 'seed', 'chat', TRUE, TRUE, FALSE, 200000, 8192
  UNION ALL SELECT 'volcengine-ark', 'Doubao-Seed-2.0-Code', 'Doubao-Seed 2.0 Code', 'doubao', 'chat', TRUE, TRUE, FALSE, 200000, 8192
  UNION ALL SELECT 'tokenrouter', 'anthropic/claude-opus-5', 'Claude Opus 5', 'claude', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'api-airforce', 'anthropic/claude-3.7-sonnet', 'Claude 3.7 Sonnet (Free)', 'claude', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'bazaarlink', 'claude-opus-4.7', 'Claude Opus 4.7', 'claude', 'chat', TRUE, TRUE, TRUE, 1000000, 8192
  UNION ALL SELECT 'bluesminds', 'gpt-4.1', 'GPT-4.1', 'gpt', 'chat', TRUE, TRUE, TRUE, 1048576, 32768
  UNION ALL SELECT 'kilo-gateway', 'kilo-auto/free', 'Kilo Auto Free', 'kilo', 'chat', TRUE, TRUE, FALSE, 256000, 8192
  UNION ALL SELECT 'llm7', 'gpt-5.5', 'GPT-5.5', 'gpt', 'chat', TRUE, TRUE, TRUE, 1050000, 32768
  UNION ALL SELECT 'morph', 'morph-v3-large', 'Morph v3 Large', 'morph', 'chat', TRUE, TRUE, FALSE, 128000, 8192
  UNION ALL SELECT 'nanobanana', 'nanobanana-flash', 'NanoBanana Flash', 'nano-banana', 'image', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'xiaomi-mimo', 'mimo-v2.5-pro', 'MiMo V2.5 Pro', 'mimo', 'chat', TRUE, TRUE, FALSE, 1050000, 8192
  UNION ALL SELECT 'xiaomi-tokenplan', 'mimo-v2.5-pro', 'MiMo V2.5 Pro', 'mimo', 'chat', TRUE, TRUE, FALSE, 1050000, 8192
  UNION ALL SELECT 'mimo-free', 'mimo-auto', 'MiMo Auto', 'mimo', 'chat', TRUE, FALSE, FALSE, 128000, 8192
  UNION ALL SELECT 'iflow', 'qwen3-coder-plus', 'Qwen3 Coder Plus', 'qwen', 'chat', TRUE, TRUE, FALSE, 131072, 8192
  UNION ALL SELECT 'qoder', 'ultimate', 'Ultimate', 'qwen', 'chat', TRUE, TRUE, FALSE, 128000, 8192
  UNION ALL SELECT 'commandcode', 'deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 'chat', TRUE, TRUE, FALSE, 128000, 32768
  UNION ALL SELECT 'clinepass', 'cline-pass/glm-5.2', 'GLM-5.2 (ClinePass)', 'glm', 'chat', TRUE, TRUE, FALSE, 200000, 8192
  UNION ALL SELECT 'perplexity-agent', 'perplexity/sonar', 'Perplexity Sonar', 'sonar', 'chat', TRUE, TRUE, FALSE, 127000, 4096
  UNION ALL SELECT 'opencode-go', 'glm-5.2', 'GLM 5.2', 'glm', 'chat', TRUE, TRUE, FALSE, 200000, 8192
  UNION ALL SELECT 'vercel-ai-gateway', 'anthropic/claude-sonnet-4.6', 'Claude Sonnet 4.6', 'claude', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'vertex', 'gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview', 'gemini', 'chat', TRUE, TRUE, TRUE, 1048576, 65536
  UNION ALL SELECT 'vertex-partner', 'deepseek-ai/deepseek-v3.2-maas', 'DeepSeek V3.2 (Vertex)', 'deepseek', 'chat', TRUE, TRUE, FALSE, 128000, 32768
  UNION ALL SELECT 'kiro', 'claude-opus-5', 'Claude Opus 5', 'claude', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'grok-web', 'grok-4', 'Grok 4', 'grok', 'chat', TRUE, TRUE, FALSE, 131072, 32768
  UNION ALL SELECT 'grok-cli', 'grok-4.5', 'Grok 4.5', 'grok', 'chat', TRUE, TRUE, FALSE, 500000, 64000
  UNION ALL SELECT 'ollama', 'gpt-oss:120b', 'GPT OSS 120B', 'gpt-oss', 'chat', TRUE, TRUE, FALSE, 128000, 8192
  UNION ALL SELECT 'jina-ai', 'jina-embeddings-v3', 'Jina Embeddings v3', 'jina', 'embedding', FALSE, FALSE, FALSE, 8192, NULL
  UNION ALL SELECT 'jina-ai', 'jina-embeddings-v2-base-en', 'Jina Embeddings v2 Base EN', 'jina', 'embedding', FALSE, FALSE, FALSE, 8192, NULL
  UNION ALL SELECT 'jina-ai', 'jina-embeddings-v2-base-code', 'Jina Embeddings v2 Base Code', 'jina', 'embedding', FALSE, FALSE, FALSE, 8192, NULL
  UNION ALL SELECT 'perplexity-web', 'pplx-auto', 'Perplexity Auto', 'sonar', 'chat', TRUE, TRUE, FALSE, 127000, 4096
  UNION ALL SELECT 'claude', 'claude-opus-5', 'Claude Opus 5', 'claude', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'codex', 'gpt-5.5', 'GPT-5.5', 'gpt', 'chat', TRUE, TRUE, TRUE, 400000, 32768
  UNION ALL SELECT 'cursor', 'claude-4.5-sonnet', 'Claude 4.5 Sonnet', 'claude', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'antigravity', 'gemini-3.6-flash-high', 'Gemini 3.6 Flash (High)', 'gemini', 'chat', TRUE, TRUE, TRUE, 1048576, 65536
  UNION ALL SELECT 'github', 'gpt-5.4', 'GPT-5.4', 'gpt', 'chat', TRUE, TRUE, TRUE, 400000, 32768
  UNION ALL SELECT 'kimchi', 'minimax-m3', 'MiniMax-M3', 'minimax', 'chat', TRUE, TRUE, FALSE, 1048576, 8192
  UNION ALL SELECT 'gemini-cli', 'gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview', 'gemini', 'chat', TRUE, TRUE, TRUE, 1048576, 65536
  UNION ALL SELECT 'cline', 'anthropic/claude-opus-4.7', 'Claude Opus 4.7', 'claude', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'kilocode', 'anthropic/claude-sonnet-4-20250514', 'Claude Sonnet 4', 'claude', 'chat', TRUE, TRUE, TRUE, 200000, 8192
  UNION ALL SELECT 'voyage-ai', 'voyage-3-large', 'Voyage 3 Large', 'voyage', 'embedding', FALSE, FALSE, FALSE, 32000, NULL
  UNION ALL SELECT 'voyage-ai', 'voyage-3.5', 'Voyage 3.5', 'voyage', 'embedding', FALSE, FALSE, FALSE, 32000, NULL
  UNION ALL SELECT 'voyage-ai', 'voyage-3.5-lite', 'Voyage 3.5 Lite', 'voyage', 'embedding', FALSE, FALSE, FALSE, 32000, NULL
  -- TTS / STT / image models
  UNION ALL SELECT 'elevenlabs', 'eleven_multilingual_v2', 'Eleven Multilingual v2', 'eleven', 'tts', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'playht', 'PlayHT2.0-Turbo', 'PlayHT 2.0 Turbo', 'playht', 'tts', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'cartesia', 'sonic-2', 'Sonic 2', 'sonic', 'tts', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'inworld', 'inworld-tts-1.5-mini', 'Inworld TTS 1.5 Mini', 'inworld', 'tts', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'inworld', 'inworld-tts-1.5-max', 'Inworld TTS 1.5 Max', 'inworld', 'tts', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'deepgram', 'nova-3', 'Nova 3', 'nova', 'stt', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'black-forest-labs', 'flux-1.1-pro', 'FLUX 1.1 Pro', 'flux', 'image', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'stability-ai', 'stable-image-ultra', 'Stable Image Ultra', 'stable-image', 'image', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'recraft', 'recraft-v3', 'Recraft V3', 'recraft', 'image', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'runwayml', 'gen3a_turbo', 'Gen-3 Alpha Turbo', 'gen3', 'image', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'fal-ai', 'fal-ai/flux/dev', 'FLUX Dev', 'flux', 'image', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'comfyui', 'flux-dev', 'FLUX Dev', 'flux', 'image', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'comfyui', 'sdxl', 'SDXL', 'sdxl', 'image', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'sdwebui', 'stable-diffusion-v1-5', 'Stable Diffusion v1.5', 'sd', 'image', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'sdwebui', 'sdxl-base-1.0', 'SDXL Base 1.0', 'sdxl', 'image', FALSE, FALSE, FALSE, NULL, NULL
  UNION ALL SELECT 'mmf', 'mimo-auto', 'MiMo Auto', 'mimo', 'chat', TRUE, FALSE, FALSE, 128000, 8192
) s
JOIN providers p ON p.provider_key = s.provider_key
LEFT JOIN provider_models m
       ON m.provider_id = p.id AND m.model_key = s.model_key
WHERE m.id IS NULL;
