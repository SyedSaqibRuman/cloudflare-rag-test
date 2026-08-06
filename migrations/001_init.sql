-- ============================================================
-- 001_init — MySQL schema for the AI Gateway & RAG platform
-- DDL only (tables, views, stored procedures). No seed data.
--
-- Derived verbatim from schema/v5.sql (the frozen v5 reference).
-- Never edit schema/v5.sql — evolve the platform with new
-- migration files (002_..., 003_..., ...) instead.
--
-- Requires MySQL 8.0+ (credential_usage_logs uses partitioning WITH
-- foreign keys, which MariaDB does not support — on MariaDB, drop the
-- PARTITION BY RANGE clause from that table before applying).
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_key VARCHAR(100) NOT NULL UNIQUE,
    company_name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(255),
    email VARCHAR(255) NOT NULL,
    billing_email VARCHAR(255),
    website VARCHAR(500),
    
    plan_tier ENUM('free','starter','pro','enterprise','custom') DEFAULT 'free',
    status ENUM('active','suspended','trial','cancelled') DEFAULT 'active',
    is_active BOOLEAN DEFAULT TRUE,
    
    max_credentials       INT UNSIGNED     DEFAULT 50,
    max_storage_gb        DECIMAL(10,2)    DEFAULT 10.00,
    max_monthly_requests  BIGINT UNSIGNED  DEFAULT 100000,
    max_knowledge_bases   INT UNSIGNED     DEFAULT 10,
    max_assistants        INT UNSIGNED     DEFAULT 25,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    
    INDEX idx_company_key (company_key),
    INDEX idx_status (status, is_active),
    INDEX idx_alive (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_environments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_id INT UNSIGNED NOT NULL,
    
    env_key VARCHAR(50) NOT NULL,
    env_name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    is_production BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order TINYINT UNSIGNED DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    
    UNIQUE KEY uk_company_env (company_id, env_key),
    INDEX idx_company (company_id, is_active),
    INDEX idx_alive (deleted_at),
    
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- MODULE 2: PROVIDER CATALOG (Global, NOT tenant-scoped)
-- ============================================================
--
-- Everything below is global metadata owned by the platform,
-- never duplicated per tenant.
--

-- -----------------------------------------------------
-- providers
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS providers (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    provider_key VARCHAR(50) NOT NULL UNIQUE,
    provider_name VARCHAR(100) NOT NULL,
    
    primary_service_category ENUM(
        'ai','embedding','vector','storage','graph',
        'image','speech','search','database','email','analytics'
    ) NOT NULL,
    
    website_url VARCHAR(500),
    documentation_url VARCHAR(500),
    logo_url VARCHAR(500),
    
    default_api_base_url VARCHAR(500),
    auth_type ENUM('api_key','bearer_token','oauth2','basic_auth','custom') DEFAULT 'bearer_token',
    auth_header_name VARCHAR(100) DEFAULT 'Authorization',
    api_key_format_regex VARCHAR(255),
    
    -- Default behavior
    default_config JSON,                         -- Pre-fill values for new credentials of this provider
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_provider_key (provider_key),
    INDEX idx_primary_service (primary_service_category),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- v5 NEW: provider_auth_schemas
-- Defines what fields a credential form for this provider needs.
-- Drives data-driven UI: the admin form is generated from these rows.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_auth_schemas (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    provider_id INT UNSIGNED NOT NULL,
    
    field_name VARCHAR(100) NOT NULL,
        -- Examples:
        --   'api_key'            (OpenAI)
        --   'api_token'          (Cloudflare)
        --   'access_key_id'      (AWS S3)
        --   'secret_access_key'  (AWS S3)
        --   'region'             (AWS S3)
        --   'account_id'         (Cloudflare)
        --   'api_key' + 'endpoint' (Azure OpenAI requires BOTH)
        --   'tenant_id'          (Azure)
        --   'subscription_id'    (Azure)
        --   'project_id'         (GCP)
        --   'service_account_json'(GCP)
        --   'username' + 'password' (Neo4j basics)
        --   'uri' + 'user' + 'password' (Neo4j URI-based)
    
    field_label VARCHAR(200) NOT NULL,           -- 'API Key', 'Secret Access Key'
    field_type ENUM(
        'text',           -- Single-line text input
        'password',       -- Masked text input
        'textarea',       -- Multi-line (for JSON blobs)
        'select',         -- Dropdown with predefined choices
        'url',            -- URL-validated text input
        'email',          -- Email-validated input
        'numeric',        -- Numeric input
        'json',           -- JSON editor
        'file'            -- File upload (for service-account.json)
    ) NOT NULL,
    
    field_placeholder VARCHAR(255),
    field_help_text VARCHAR(1000),               -- Tooltip / guidance
    field_default_value TEXT,
    
    -- Validation
    is_required BOOLEAN DEFAULT TRUE,
    validation_regex VARCHAR(500),               -- '^(sk-)|(sk-ant-)'
    validation_min_length INT UNSIGNED,
    validation_max_length INT UNSIGNED,
    
    -- Encryption & storage
    is_encrypted BOOLEAN DEFAULT TRUE,           -- Store as part of encrypted_credentials JSON
    encryption_storage_path VARCHAR(100),        -- Logical key inside encrypted JSON: 'api_key', 'secret', 'account_id'
    
    -- UI ordering & grouping
    display_order SMALLINT UNSIGNED DEFAULT 0,
    field_group VARCHAR(50) DEFAULT 'main',      -- 'main','advanced','optional'
    field_width ENUM('full','half','third','quarter') DEFAULT 'full',
    
    -- For 'select' type: predefined choices
    select_options JSON,                         -- [{"value":"us-east-1","label":"US East (N. Virginia)"}]
    
    -- Conditional display
    show_when JSON,                              -- e.g., {"field":"auth_type","value":"api_key"}
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_provider_field (provider_id, field_name),
    INDEX idx_provider_group (provider_id, field_group, display_order),
    
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- provider_endpoints
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_endpoints (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    provider_id INT UNSIGNED NOT NULL,
    
    endpoint_key VARCHAR(50) NOT NULL,
    endpoint_name VARCHAR(100) NOT NULL,
    endpoint_url VARCHAR(500) NOT NULL,
    http_method ENUM('GET','POST','PUT','DELETE','PATCH') DEFAULT 'POST',
    default_timeout_seconds INT UNSIGNED DEFAULT 30,
    
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_provider_endpoint (provider_id, endpoint_key),
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
    INDEX idx_provider (provider_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- provider_models
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_models (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    provider_id INT UNSIGNED NOT NULL,
    
    model_key VARCHAR(100) NOT NULL,
    model_name VARCHAR(200) NOT NULL,
    model_family VARCHAR(100),
    
    category ENUM('chat','embedding','reranker','image','tts','stt','vision') NOT NULL,
    
    supports_streaming BOOLEAN DEFAULT FALSE,
    supports_function_calling BOOLEAN DEFAULT FALSE,
    supports_vision BOOLEAN DEFAULT FALSE,
    max_context_window INT UNSIGNED,
    max_output_tokens INT UNSIGNED,
    
    is_active BOOLEAN DEFAULT TRUE,
    is_deprecated BOOLEAN DEFAULT FALSE,
    deprecation_date DATE,
    release_date DATE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_provider_model (provider_id, model_key),
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
    INDEX idx_category (category),
    INDEX idx_model_key (model_key),
    INDEX idx_active (is_active, is_deprecated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS provider_model_pricing (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    provider_model_id INT UNSIGNED NOT NULL,
    
    effective_from DATE NOT NULL,
    effective_to DATE DEFAULT NULL,
    
    input_price_per_million DECIMAL(12,6) DEFAULT NULL,
    output_price_per_million DECIMAL(12,6) DEFAULT NULL,
    cached_input_price_per_million DECIMAL(12,6) DEFAULT NULL,
    image_price DECIMAL(12,6) DEFAULT NULL,
    audio_input_price_per_million DECIMAL(12,6) DEFAULT NULL,
    audio_output_price_per_million DECIMAL(12,6) DEFAULT NULL,
    request_price DECIMAL(12,6) DEFAULT NULL,
    
    price_currency VARCHAR(10) DEFAULT 'USD',
    billing_unit VARCHAR(50) DEFAULT 'tokens',
    tier_name VARCHAR(50) DEFAULT 'standard',
    min_units BIGINT UNSIGNED DEFAULT NULL,
    rate_limit_notes VARCHAR(500),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_model_effective (provider_model_id, effective_from, effective_to),
    INDEX idx_current (provider_model_id, effective_to),
    
    FOREIGN KEY (provider_model_id) REFERENCES provider_models(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- provider_capabilities
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_capabilities (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    provider_id INT UNSIGNED NOT NULL,
    
    capability_key VARCHAR(50) NOT NULL,
    is_supported BOOLEAN DEFAULT TRUE,
    config JSON,
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_provider_capability (provider_id, capability_key),
    INDEX idx_capability (capability_key, is_supported),
    INDEX idx_provider (provider_id),
    
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------
-- v5 NEW: provider_resource_types
-- Template of what resource types each provider exposes
-- and whether they are required/optional for that provider.
-- Drives the "Provision Resource" UI wizard.
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_resource_types (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    provider_id INT UNSIGNED NOT NULL,
    
    resource_type VARCHAR(50) NOT NULL,
        -- Must match the ENUM in provider_resources.resource_type
        -- 'vector_index','object_bucket','sql_database','kv_namespace',
        -- 'graph_database','embedding_index','search_index','cache_namespace'
    
    display_name VARCHAR(100) NOT NULL,           -- 'Vector Index'
    description VARCHAR(500),
    
    icon_name VARCHAR(50),                       -- For UI: 'cube','database','graph'
    display_color VARCHAR(20),                   -- Hex color: '#FF6B35'
    
    -- Schema-less resource-config template (provisions UI form pre-fill)
    -- e.g., for vector_index:
    --   {"dimensions": {"type":"numeric","default":1536,"min":1,"max":4096},
    --    "metric":    {"type":"select","options":["cosine","euclidean","dot-product"]}}
    config_schema JSON,
    
    -- Provisioning behavior
    is_required BOOLEAN DEFAULT FALSE,           -- Must every credential of this provider create one?
    is_default_enabled BOOLEAN DEFAULT TRUE,     -- Whether new resources of this type can be default
    max_per_credential INT UNSIGNED DEFAULT NULL,
    
    -- Provisioning API hints (where to send create requests)
    provision_endpoint_key VARCHAR(50),           -- FK to provider_endpoints.endpoint_key
    provision_method ENUM('POST','PUT','GET') DEFAULT 'POST',
    provision_payload_schema JSON,
    
    -- Health-check endpoint hint
    health_check_endpoint_key VARCHAR(50),
    health_check_interval_seconds INT UNSIGNED DEFAULT 300,
    
    -- Display
    display_order SMALLINT UNSIGNED DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_provider_resource_type (provider_id, resource_type),
    INDEX idx_provider (provider_id, display_order),
    
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- MODULE 3: TENANT (Company-owned)
-- ============================================================
--
-- Every table below has `company_id` cascade-on-delete.
-- These rows are tenant-private; never shared.
--

CREATE TABLE IF NOT EXISTS credentials (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    company_id INT UNSIGNED NOT NULL,
    provider_id INT UNSIGNED NOT NULL,
    environment_id INT UNSIGNED DEFAULT NULL,
    
    credential_key VARCHAR(100) NOT NULL,
    credential_name VARCHAR(200) NOT NULL,
    description TEXT,
    
    -- Encrypted JSON blob: {"api_key":"xxx","secret":"yyy","account_id":"zzz"}
    -- Schema sourced from provider_auth_schemas for this provider.
    encrypted_credentials TEXT NOT NULL,
    encryption_version INT UNSIGNED DEFAULT 1,
    
    config JSON,
    
    endpoint_override_url VARCHAR(500) DEFAULT NULL,
    endpoint_override_headers JSON DEFAULT NULL,
    
    credential_type ENUM('primary','secondary','fallback','rotating') DEFAULT 'primary',
    priority TINYINT UNSIGNED DEFAULT 100,
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    
    last_verified_at DATETIME DEFAULT NULL,
    last_verification_status ENUM('success','failed','pending','expired') DEFAULT NULL,
    verification_error TEXT,
    verified_by VARCHAR(100) DEFAULT NULL,
    last_test_latency_ms INT UNSIGNED DEFAULT NULL,
    
    last_rotated_at DATETIME DEFAULT NULL,
    next_rotation_at DATETIME DEFAULT NULL,
    rotation_policy ENUM('never','manual','30_days','60_days','90_days','180_days','365_days') DEFAULT 'manual',
    auto_rotate_enabled BOOLEAN DEFAULT FALSE,
    
    created_source ENUM('admin','onboarding','oauth_exchange','api_import','migration') DEFAULT 'admin',
    expires_at DATETIME DEFAULT NULL,
    
    rate_limit_requests INT UNSIGNED DEFAULT NULL,
    rate_limit_window VARCHAR(20) DEFAULT NULL,
    
    created_by VARCHAR(100) DEFAULT NULL,
    updated_by VARCHAR(100) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    
    UNIQUE KEY uk_credential_key (credential_key),
    UNIQUE KEY uk_company_provider_env_cred (company_id, provider_id, environment_id, credential_key),
    
    INDEX idx_company (company_id),
    INDEX idx_provider_env (provider_id, environment_id, is_active),
    INDEX idx_company_provider (company_id, provider_id),
    INDEX idx_expires (expires_at),
    INDEX idx_rotation (next_rotation_at, auto_rotate_enabled),
    INDEX idx_default (company_id, provider_id, environment_id, is_default),
    INDEX idx_verification (last_verified_at, last_verification_status),
    INDEX idx_alive (deleted_at),
    
    FOREIGN KEY (company_id)     REFERENCES companies(id)            ON DELETE CASCADE,
    FOREIGN KEY (provider_id)    REFERENCES providers(id)            ON DELETE RESTRICT,
    FOREIGN KEY (environment_id) REFERENCES company_environments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credential_model_access (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    credential_id BIGINT UNSIGNED NOT NULL,
    provider_model_id INT UNSIGNED NOT NULL,
    company_id INT UNSIGNED NOT NULL,
    
    rate_limit_per_min INT UNSIGNED DEFAULT NULL,
    rate_limit_per_day INT UNSIGNED DEFAULT NULL,
    monthly_quota_tokens BIGINT UNSIGNED DEFAULT NULL,
    monthly_quota_used_tokens BIGINT UNSIGNED DEFAULT 0,
    
    is_enabled BOOLEAN DEFAULT TRUE,
    is_default_for_category BOOLEAN DEFAULT FALSE,
    
    notes VARCHAR(500),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    
    UNIQUE KEY uk_credential_model (credential_id, provider_model_id),
    
    INDEX idx_company (company_id, is_enabled),
    INDEX idx_credential (credential_id, is_enabled),
    INDEX idx_default (credential_id, is_default_for_category),
    INDEX idx_alive (deleted_at),
    
    FOREIGN KEY (credential_id)     REFERENCES credentials(id)     ON DELETE CASCADE,
    FOREIGN KEY (provider_model_id) REFERENCES provider_models(id) ON DELETE CASCADE,
    FOREIGN KEY (company_id)        REFERENCES companies(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS provider_resources (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    credential_id BIGINT UNSIGNED NOT NULL,
    company_id INT UNSIGNED NOT NULL,
    provider_id INT UNSIGNED NOT NULL,
    environment_id INT UNSIGNED DEFAULT NULL,
    
    resource_type ENUM(
        'vector_index','object_bucket','sql_database',
        'kv_namespace','graph_database','embedding_index',
        'search_index','cache_namespace'
    ) NOT NULL,
    
    resource_key VARCHAR(100) NOT NULL,
    resource_name VARCHAR(200) NOT NULL,
    
    external_resource_id VARCHAR(255) DEFAULT NULL,
    external_resource_url VARCHAR(500) DEFAULT NULL,
    external_region VARCHAR(50) DEFAULT NULL,
    
    description TEXT,
    config JSON,
    
    status ENUM('provisioning','active','syncing','error','archived') DEFAULT 'provisioning',
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    
    last_health_check_at DATETIME DEFAULT NULL,
    last_health_status ENUM('healthy','degraded','unhealthy','unknown') DEFAULT 'unknown',
    health_check_error TEXT,
    
    provisioned_at DATETIME DEFAULT NULL,
    last_synced_at DATETIME DEFAULT NULL,
    
    created_by VARCHAR(100) DEFAULT NULL,
    updated_by VARCHAR(100) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    
    UNIQUE KEY uk_company_resource_key (company_id, resource_key),
    UNIQUE KEY uk_external (provider_id, external_resource_id),
    
    INDEX idx_credential (credential_id),
    INDEX idx_company_type (company_id, resource_type, is_active),
    INDEX idx_provider (provider_id),
    INDEX idx_status (status, is_active),
    INDEX idx_external (external_resource_id),
    INDEX idx_alive (deleted_at),
    
    FOREIGN KEY (credential_id) REFERENCES credentials(id)            ON DELETE CASCADE,
    FOREIGN KEY (company_id)    REFERENCES companies(id)               ON DELETE CASCADE,
    FOREIGN KEY (provider_id)   REFERENCES providers(id)               ON DELETE RESTRICT,
    FOREIGN KEY (environment_id) REFERENCES company_environments(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_bases (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_id INT UNSIGNED NOT NULL,
    
    kb_key VARCHAR(100) NOT NULL,
    kb_name VARCHAR(200) NOT NULL,
    description TEXT,
    
    vector_resource_id BIGINT UNSIGNED DEFAULT NULL,
    graph_resource_id BIGINT UNSIGNED DEFAULT NULL,
    storage_resource_id BIGINT UNSIGNED DEFAULT NULL,
    
    embedding_model_id INT UNSIGNED DEFAULT NULL,
    embedding_model_provider VARCHAR(50),
    chunk_size INT UNSIGNED DEFAULT 512,
    chunk_overlap INT UNSIGNED DEFAULT 50,
    
    retrieval_top_k INT UNSIGNED DEFAULT 10,
    retrieval_score_threshold DECIMAL(5,4) DEFAULT 0.7,
    enable_graph_rag BOOLEAN DEFAULT FALSE,
    enable_hybrid_search BOOLEAN DEFAULT TRUE,
    
    status ENUM('active','indexing','error','archived') DEFAULT 'active',
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    
    UNIQUE KEY uk_company_kb (company_id, kb_key),
    INDEX idx_company (company_id, is_active),
    INDEX idx_status (status),
    INDEX idx_alive (deleted_at),
    
    FOREIGN KEY (company_id)          REFERENCES companies(id)          ON DELETE CASCADE,
    FOREIGN KEY (vector_resource_id)  REFERENCES provider_resources(id) ON DELETE SET NULL,
    FOREIGN KEY (graph_resource_id)   REFERENCES provider_resources(id) ON DELETE SET NULL,
    FOREIGN KEY (storage_resource_id) REFERENCES provider_resources(id) ON DELETE SET NULL,
    FOREIGN KEY (embedding_model_id)  REFERENCES provider_models(id)    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assistants (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_id INT UNSIGNED NOT NULL,
    
    assistant_key VARCHAR(100) NOT NULL,
    assistant_name VARCHAR(200) NOT NULL,
    description TEXT,
    
    credential_id BIGINT UNSIGNED NOT NULL,
    model_id INT UNSIGNED DEFAULT NULL,
    model_key VARCHAR(100) DEFAULT NULL,
    credential_model_access_id BIGINT UNSIGNED DEFAULT NULL,
    
    system_prompt TEXT,
    temperature DECIMAL(3,2) DEFAULT 0.7,
    max_tokens INT UNSIGNED DEFAULT 4096,
    enable_function_calling BOOLEAN DEFAULT TRUE,
    enable_streaming BOOLEAN DEFAULT TRUE,
    tools JSON,
    
    primary_kb_id BIGINT UNSIGNED DEFAULT NULL,
    kb_ids JSON,
    
    enable_graph_context BOOLEAN DEFAULT FALSE,
    graph_resource_id BIGINT UNSIGNED DEFAULT NULL,
    
    is_active BOOLEAN DEFAULT TRUE,
    is_public BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    
    UNIQUE KEY uk_company_assistant (company_id, assistant_key),
    INDEX idx_company (company_id, is_active),
    INDEX idx_alive (deleted_at),
    
    FOREIGN KEY (company_id)        REFERENCES companies(id)            ON DELETE CASCADE,
    FOREIGN KEY (credential_id)     REFERENCES credentials(id)         ON DELETE RESTRICT,
    FOREIGN KEY (model_id)          REFERENCES provider_models(id)      ON DELETE SET NULL,
    FOREIGN KEY (credential_model_access_id) REFERENCES credential_model_access(id) ON DELETE SET NULL,
    FOREIGN KEY (primary_kb_id)     REFERENCES knowledge_bases(id)     ON DELETE SET NULL,
    FOREIGN KEY (graph_resource_id) REFERENCES provider_resources(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chatbots (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_id INT UNSIGNED NOT NULL,
    assistant_id BIGINT UNSIGNED NOT NULL,
    
    chatbot_key VARCHAR(100) NOT NULL,
    chatbot_name VARCHAR(200) NOT NULL,
    
    web_widget_enabled BOOLEAN DEFAULT FALSE,
    api_endpoint_path VARCHAR(200),
    
    welcome_message TEXT,
    placeholder_text VARCHAR(200),
    theme_config JSON,
    
    enable_history BOOLEAN DEFAULT TRUE,
    max_history_messages INT UNSIGNED DEFAULT 20,
    
    rate_limit_per_user INT UNSIGNED DEFAULT 60,
    rate_limit_window VARCHAR(20) DEFAULT 'minute',
    
    status ENUM('draft','live','paused','archived') DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    
    UNIQUE KEY uk_company_chatbot (company_id, chatbot_key),
    INDEX idx_company (company_id, status),
    INDEX idx_alive (deleted_at),
    
    FOREIGN KEY (company_id)   REFERENCES companies(id)    ON DELETE CASCADE,
    FOREIGN KEY (assistant_id) REFERENCES assistants(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_workflows (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_id INT UNSIGNED NOT NULL,
    
    workflow_key VARCHAR(100) NOT NULL,
    workflow_name VARCHAR(200) NOT NULL,
    description TEXT,
    
    definition JSON NOT NULL,
    primary_assistant_id BIGINT UNSIGNED DEFAULT NULL,
    
    trigger_type ENUM('manual','webhook','schedule','event','chatbot') DEFAULT 'manual',
    trigger_config JSON,
    
    status ENUM('draft','active','paused','archived') DEFAULT 'draft',
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,
    
    UNIQUE KEY uk_company_workflow (company_id, workflow_key),
    INDEX idx_company (company_id, is_active),
    INDEX idx_alive (deleted_at),
    
    FOREIGN KEY (company_id)           REFERENCES companies(id)    ON DELETE CASCADE,
    FOREIGN KEY (primary_assistant_id) REFERENCES assistants(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- MODULE 4: OPERATIONS (Auditing & Usage)
-- ============================================================
--
-- Append-heavy tables. Log data, never edited.
--

CREATE TABLE IF NOT EXISTS credential_usage_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    credential_id BIGINT UNSIGNED NOT NULL,
    company_id INT UNSIGNED NOT NULL,
    provider_resource_id BIGINT UNSIGNED DEFAULT NULL,
    
    action VARCHAR(100) NOT NULL,
    endpoint VARCHAR(500),
    model_used VARCHAR(100),
    resource_type VARCHAR(50),
    request_method VARCHAR(10),
    response_status INT,
    
    input_units BIGINT UNSIGNED DEFAULT NULL,
    output_units BIGINT UNSIGNED DEFAULT NULL,
    duration_ms INT UNSIGNED,
    cost_usd DECIMAL(12,6),
    
    error_code VARCHAR(100),
    error_message TEXT,
    
    user_id VARCHAR(100),
    client_ip VARCHAR(45),
    user_agent VARCHAR(500),
    trace_id VARCHAR(100),
    request_id VARCHAR(100),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_credential_time (credential_id, created_at),
    INDEX idx_company_time (company_id, created_at),
    INDEX idx_resource_time (provider_resource_id, created_at),
    INDEX idx_created_at (created_at),
    INDEX idx_status (response_status),
    INDEX idx_trace (trace_id),
    INDEX idx_cost_company_day (company_id, created_at, cost_usd),
    
    FOREIGN KEY (credential_id)        REFERENCES credentials(id)       ON DELETE CASCADE,
    FOREIGN KEY (company_id)           REFERENCES companies(id)          ON DELETE CASCADE,
    FOREIGN KEY (provider_resource_id) REFERENCES provider_resources(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
    PARTITION p202608 VALUES LESS THAN (202609),
    PARTITION p202609 VALUES LESS THAN (202610),
    PARTITION p202610 VALUES LESS THAN (202611),
    PARTITION p202611 VALUES LESS THAN (202612),
    PARTITION p202612 VALUES LESS THAN (202701),
    PARTITION p202701 VALUES LESS THAN (202702),
    PARTITION p202702 VALUES LESS THAN (202703),
    PARTITION p202703 VALUES LESS THAN (202704),
    PARTITION p202704 VALUES LESS THAN (202705),
    PARTITION p202705 VALUES LESS THAN (202706),
    PARTITION p202706 VALUES LESS THAN (202707),
    PARTITION p202707 VALUES LESS THAN (202708),
    PARTITION p_future VALUES LESS THAN MAXVALUE
  );

-- -----------------------------------------------------
-- v5 NEW: audit_logs
-- Generalized audit trail for any entity in any tenant table.
-- Separate from credential_usage_logs (which is operational metrics).
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    
    company_id INT UNSIGNED DEFAULT NULL,         -- NULL = platform-level audit (admin actions)
    actor_type ENUM('user','system','api_key','admin','webhook') NOT NULL,
    actor_id VARCHAR(100),                        -- user@example.com, system:rotation-bot, etc.
    actor_ip VARCHAR(45),
    
    action VARCHAR(100) NOT NULL,
        -- 'credential.created','credential.updated','credential.rotated',
        -- 'credential.deleted','credential.restored',
        -- 'resource.provisioned','resource.deleted',
        -- 'model_access.granted','model_access.revoked',
        -- 'company.created','company.suspended',
        -- 'provider.added','provider.disabled'
    
    entity_type VARCHAR(50) NOT NULL,             -- 'credential','provider_resource','assistant',...
    entity_id BIGINT UNSIGNED,
    
    -- Change tracking
    before_state JSON,                            -- Snapshot before
    after_state JSON,                             -- Snapshot after
    diff JSON,                                    -- Computed differences
    
    -- Context
    request_id VARCHAR(100),
    trace_id VARCHAR(100),
    reason VARCHAR(500),                          -- 'admin action','scheduled rotation','user request'
    
    -- Compliance flagging
    is_sensitive BOOLEAN DEFAULT FALSE,           -- Triggers extra logging/alerting
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_company_time (company_id, created_at),
    INDEX idx_entity (entity_type, entity_id, created_at),
    INDEX idx_actor (actor_type, actor_id, created_at),
    INDEX idx_action (action, created_at),
    INDEX idx_sensitive (is_sensitive, created_at),
    INDEX idx_created_at (created_at)
    -- No FK on entity_id since it could reference any tenant table
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
    PARTITION p202608 VALUES LESS THAN (202609),
    PARTITION p202609 VALUES LESS THAN (202610),
    PARTITION p202610 VALUES LESS THAN (202611),
    PARTITION p202611 VALUES LESS THAN (202612),
    PARTITION p202612 VALUES LESS THAN (202701),
    PARTITION p202701 VALUES LESS THAN (202702),
    PARTITION p202702 VALUES LESS THAN (202703),
    PARTITION p202703 VALUES LESS THAN (202704),
    PARTITION p202704 VALUES LESS THAN (202705),
    PARTITION p202705 VALUES LESS THAN (202706),
    PARTITION p202706 VALUES LESS THAN (202707),
    PARTITION p202707 VALUES LESS THAN (202708),
    PARTITION p_future VALUES LESS THAN MAXVALUE
  );


-- ============================================================
-- VIEWS
-- ============================================================

CREATE OR REPLACE VIEW v_credentials_full AS
SELECT 
    c.id AS credential_id,
    c.credential_key,
    c.credential_name,
    c.credential_type,
    c.priority,
    c.is_active,
    c.is_default,
    c.last_verified_at,
    c.last_verification_status,
    c.expires_at,
    
    co.id AS company_id,
    co.company_key,
    co.company_name,
    
    p.id AS provider_id,
    p.provider_key,
    p.provider_name,
    p.primary_service_category,
    
    ce.env_key,
    ce.env_name,
    ce.is_production,
    
    COALESCE(c.endpoint_override_url, p.default_api_base_url) AS effective_endpoint_url
FROM credentials c
JOIN companies         co ON c.company_id     = co.id   AND co.deleted_at IS NULL
JOIN providers         p  ON c.provider_id    = p.id    AND p.is_active = TRUE
JOIN company_environments ce ON c.environment_id = ce.id AND ce.deleted_at IS NULL
WHERE c.is_active = TRUE AND c.deleted_at IS NULL;

CREATE OR REPLACE VIEW v_provider_capabilities AS
SELECT 
    pc.provider_id,
    p.provider_key,
    pc.capability_key,
    pc.is_supported,
    pc.config
FROM provider_capabilities pc
JOIN providers p ON pc.provider_id = p.id
WHERE pc.is_active = TRUE AND p.is_active = TRUE;

-- v5 NEW: drives the dynamic credential form
CREATE OR REPLACE VIEW v_provider_auth_form AS
SELECT 
    pas.provider_id,
    p.provider_key,
    pas.field_name,
    pas.field_label,
    pas.field_type,
    pas.field_placeholder,
    pas.field_help_text,
    pas.field_default_value,
    pas.is_required,
    pas.validation_regex,
    pas.validation_min_length,
    pas.validation_max_length,
    pas.is_encrypted,
    pas.encryption_storage_path,
    pas.display_order,
    pas.field_group,
    pas.field_width,
    pas.select_options,
    pas.show_when
FROM provider_auth_schemas pas
JOIN providers p ON pas.provider_id = p.id
WHERE pas.is_active = TRUE AND p.is_active = TRUE;

-- v5 NEW: drives the dynamic resource provisioning wizard
CREATE OR REPLACE VIEW v_provider_resource_templates AS
SELECT 
    prt.provider_id,
    p.provider_key,
    prt.resource_type,
    prt.display_name,
    prt.description,
    prt.icon_name,
    prt.display_color,
    prt.config_schema,
    prt.is_required,
    prt.is_default_enabled,
    prt.max_per_credential,
    prt.provision_endpoint_key,
    prt.provision_method,
    prt.provision_payload_schema,
    prt.health_check_endpoint_key,
    prt.health_check_interval_seconds,
    prt.display_order
FROM provider_resource_types prt
JOIN providers p ON prt.provider_id = p.id
WHERE prt.is_active = TRUE AND p.is_active = TRUE
ORDER BY prt.provider_id, prt.display_order;

CREATE OR REPLACE VIEW v_model_pricing_current AS
SELECT 
    pm.provider_id,
    p.provider_key,
    pm.model_key,
    pm.model_name,
    pm.category,
    pmp.input_price_per_million,
    pmp.output_price_per_million,
    pmp.cached_input_price_per_million,
    pmp.image_price,
    pmp.billing_unit,
    pmp.price_currency,
    pmp.tier_name,
    pmp.effective_from,
    pmp.effective_to
FROM provider_models pm
JOIN providers p ON pm.provider_id = p.id
LEFT JOIN provider_model_pricing pmp
       ON pmp.provider_model_id = pm.id
      AND pmp.effective_to IS NULL
WHERE pm.is_active = TRUE AND pm.is_deprecated = FALSE;

CREATE OR REPLACE VIEW v_credential_models AS
SELECT 
    cma.credential_id,
    cma.provider_model_id,
    pm.model_key,
    pm.model_name,
    pm.category,
    p.provider_key,
    cma.company_id,
    cma.is_enabled,
    cma.is_default_for_category,
    cma.rate_limit_per_min,
    cma.monthly_quota_tokens,
    cma.monthly_quota_used_tokens,
    pmp.input_price_per_million,
    pmp.output_price_per_million
FROM credential_model_access cma
JOIN provider_models pm ON cma.provider_model_id = pm.id
JOIN providers p        ON pm.provider_id = p.id
LEFT JOIN provider_model_pricing pmp
       ON pmp.provider_model_id = pm.id
      AND pmp.effective_to IS NULL
WHERE cma.is_enabled = TRUE AND cma.deleted_at IS NULL
  AND pm.is_active = TRUE;

CREATE OR REPLACE VIEW v_company_resources AS
SELECT 
    pr.id AS resource_id,
    pr.resource_type,
    pr.resource_key,
    pr.resource_name,
    pr.external_resource_id,
    pr.external_resource_url,
    pr.external_region,
    pr.status,
    pr.is_default,
    pr.is_active,
    pr.last_health_status,
    pr.config,
    
    co.id AS company_id,
    co.company_key,
    
    p.id AS provider_id,
    p.provider_key,
    p.provider_name,
    p.primary_service_category,
    
    c.id AS credential_id,
    c.credential_key,
    
    ce.env_key,
    ce.env_name
FROM provider_resources pr
JOIN companies         co ON pr.company_id     = co.id AND co.deleted_at IS NULL
JOIN providers         p  ON pr.provider_id    = p.id  AND p.is_active = TRUE
JOIN credentials       c  ON pr.credential_id  = c.id  AND c.is_active = TRUE AND c.deleted_at IS NULL
LEFT JOIN company_environments ce ON pr.environment_id = ce.id AND ce.deleted_at IS NULL
WHERE pr.is_active = TRUE AND pr.deleted_at IS NULL;

CREATE OR REPLACE VIEW v_company_usage_summary AS
SELECT 
    co.id AS company_id,
    co.company_key,
    co.company_name,
    DATE(l.created_at) AS usage_date,
    l.model_used,
    p.provider_key,
    COUNT(*) AS request_count,
    SUM(l.input_units)  AS total_input_units,
    SUM(l.output_units) AS total_output_units,
    SUM(l.cost_usd)     AS total_cost_usd,
    AVG(l.duration_ms)  AS avg_duration_ms
FROM credential_usage_logs l
JOIN companies co ON l.company_id = co.id AND co.deleted_at IS NULL
LEFT JOIN credentials c ON l.credential_id = c.id
LEFT JOIN providers  p  ON c.provider_id   = p.id
WHERE l.response_status BETWEEN 200 AND 299
GROUP BY co.id, co.company_key, co.company_name, DATE(l.created_at), l.model_used, p.provider_key;


-- ============================================================
-- STORED PROCEDURES
-- ============================================================

DELIMITER //

CREATE PROCEDURE GetCompanyCredential(
    IN p_company_key VARCHAR(100),
    IN p_provider_key VARCHAR(50),
    IN p_env_key VARCHAR(50),
    OUT p_credential_id BIGINT UNSIGNED,
    OUT p_encrypted_credentials TEXT,
    OUT p_config JSON,
    OUT p_endpoint_url VARCHAR(500)
)
BEGIN
    SELECT 
        c.id, c.encrypted_credentials, c.config,
        COALESCE(c.endpoint_override_url, p.default_api_base_url)
    INTO p_credential_id, p_encrypted_credentials, p_config, p_endpoint_url
    FROM credentials c
    JOIN companies co ON c.company_id = co.id AND co.deleted_at IS NULL
    JOIN providers p ON c.provider_id = p.id AND p.is_active = TRUE
    LEFT JOIN company_environments ce ON c.environment_id = ce.id AND ce.deleted_at IS NULL
    WHERE co.company_key = p_company_key
      AND p.provider_key = p_provider_key
      AND (p_env_key IS NULL OR ce.env_key = p_env_key)
      AND c.is_active = TRUE AND c.deleted_at IS NULL
    ORDER BY c.is_default DESC, c.priority ASC, c.last_verified_at DESC, c.created_at DESC
    LIMIT 1;
END //

CREATE PROCEDURE IsModelAllowedForCredential(
    IN p_credential_id BIGINT UNSIGNED,
    IN p_model_key VARCHAR(100),
    OUT p_is_allowed TINYINT,
    OUT p_provider_model_id INT UNSIGNED,
    OUT p_input_price DECIMAL(12,6),
    OUT p_output_price DECIMAL(12,6),
    OUT p_monthly_quota_remaining BIGINT UNSIGNED
)
BEGIN
    SELECT 1, pm.id, pmp.input_price_per_million, pmp.output_price_per_million,
           CASE WHEN cma.monthly_quota_tokens IS NULL THEN NULL
                ELSE cma.monthly_quota_tokens - cma.monthly_quota_used_tokens END
    INTO p_is_allowed, p_provider_model_id, p_input_price, p_output_price, p_monthly_quota_remaining
    FROM credential_model_access cma
    JOIN provider_models pm ON cma.provider_model_id = pm.id
    JOIN providers p ON pm.provider_id = p.id
    LEFT JOIN provider_model_pricing pmp ON pmp.provider_model_id = pm.id AND pmp.effective_to IS NULL
    WHERE cma.credential_id = p_credential_id
      AND pm.model_key = p_model_key
      AND cma.is_enabled = TRUE AND cma.deleted_at IS NULL
      AND pm.is_active = TRUE;
END //

CREATE PROCEDURE ResolveDispatch(
    IN p_company_key VARCHAR(100),
    IN p_provider_key VARCHAR(50),
    IN p_model_key VARCHAR(100),
    IN p_env_key VARCHAR(50),
    OUT p_credential_id BIGINT UNSIGNED,
    OUT p_endpoint_url VARCHAR(500),
    OUT p_input_price DECIMAL(12,6),
    OUT p_output_price DECIMAL(12,6),
    OUT p_remaining_tokens BIGINT UNSIGNED
)
BEGIN
    CALL GetCompanyCredential(p_company_key, p_provider_key, p_env_key,
        p_credential_id, @creds_dummy, @cfg_dummy, p_endpoint_url);
    CALL IsModelAllowedForCredential(p_credential_id, p_model_key,
        @allowed, @pmid_dummy, p_input_price, p_output_price, p_remaining_tokens);
END //

DELIMITER ;

