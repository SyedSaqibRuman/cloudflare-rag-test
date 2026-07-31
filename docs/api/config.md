# API: Config

Manage runtime configuration such as the WordPress domain URL, AI model settings, Cloudflare resource selection (vector indexes, R2 buckets), and the system prompt. All config endpoints require the `x-company-name` header to specify which company's config to read or modify.

## Get Current Config

```
GET /cloudflare/config
```

Returns the current runtime configuration for the specified company.

**Required Header:** `x-company-name`

**Example:**
```bash
curl -H "x-company-name: popularcert" http://localhost:3000/cloudflare/config

# With API key
curl -H "x-api-key: YOUR_ADMIN_API_KEY" -H "x-company-name: popularcert" http://localhost:3000/cloudflare/config
```

**Response (400 — missing header):**
```json
{
  "success": false,
  "error": "x-company-name header is required."
}
```

**Response (200):**
```json
{
  "success": true,
  "config": {
    "GENERAL": {
      "BASE_URL": "https://popularcert.com",
      "CONTACT_US_URL": "https://popularcert.com/contact-us/",
      "LOCATIONS_URL": "https://popularcert.com/locations/",
      "SERVICES_URL": "https://popularcert.com/services/",
      "CONSULTANT_NAME": "Sarah",
      "COMPANY_NAME": "Popularcert"
    },
    "MODELS": {
      "EMBEDDING_MODEL": "@cf/baai/bge-base-en-v1.5",
      "EMBEDDING_DIMENSIONS": 768,
      "LLM_MODEL": "@cf/meta/llama-3.1-8b-instruct-fp8",
      "SMALL_LLM": "@cf/meta/llama-3.2-3b-instruct",
      "RERANKING_MODEL": "@cf/baai/bge-reranker-base"
    },
    "STORAGE": {
      "VECTOR_INDEX": "my-vector-index",
      "R2_BUCKET_NAME": "my-r2-bucket"
    }
  }
}
```

---

## Update Config (Generic)

```
PUT /cloudflare/config
```

Update any supported configuration key for a company. Supports three request formats.

**Required Header:** `x-company-name`

**1. Update WordPress URL (legacy shorthand):**
```bash
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{"baseUrl": "https://new-site.com"}'
```

**2. Update multiple models at once:**
```bash
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{"models": {"LLM_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8", "EMBEDDING_MODEL": "@cf/baai/bge-large-en-v1.5"}}'
```

**3. Update a single key:**
```bash
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{"key": "LLM_MODEL", "value": "@cf/meta/llama-3.2-3b-instruct"}'
```

**Request Body (any format):**
```json
{
  "baseUrl": "https://new-site.com",
  "models": {
    "LLM_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8",
    "EMBEDDING_MODEL": "@cf/baai/bge-large-en-v1.5"
  },
  "key": "LLM_MODEL",
  "value": "@cf/meta/llama-3.2-3b-instruct"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `baseUrl` | string | WordPress domain URL (must include protocol) |
| `models` | object | One or more model keys to update (see [Model Configuration](#model-configuration)) |
| `key` | string | A single config key to update |
| `value` | string | The value for the single key |

Resource keys (`VECTOR_INDEX`, `R2_BUCKET_NAME`) can be updated using the `key`/`value` format (see [Resource Configuration](#resource-configuration)).

**Response (200):**
```json
{
  "success": true,
  "message": "Config updated.",
  "config": {
    "BASE_URL": "https://new-site.com",
    "LLM_MODEL": "@cf/meta/llama-3.3-70b-instruct-fp8"
  }
}
```

**Response (400 — validation error):**
```json
{
  "success": false,
  "errors": ["LLM_MODEL 'invalid-model' is not in the allowed list: ..."]
}
```

---

## Reset Config

```
POST /cloudflare/config/reset
```

Resets the entire runtime config to environment defaults, removes all companies, recreates a single default company, and deletes the persisted `runtime-config.json` file. This is a nuclear reset.

**Example:**
```bash
curl -X POST http://localhost:3000/cloudflare/config/reset

# With API key
curl -X POST -H "x-api-key: YOUR_ADMIN_API_KEY" http://localhost:3000/cloudflare/config/reset
```

**Response (200):**
```json
{
  "success": true,
  "message": "Config reset to env defaults.",
  "config": {
    "BASE_URL": "https://popularcert.com",
    "CONTACT_US_URL": "https://popularcert.com/contact-us/",
    "LOCATIONS_URL": "https://popularcert.com/locations/",
    "SERVICES_URL": "https://popularcert.com/services/",
    "COMPANY_NAME": "Popularcert",
    "CONSULTANT_NAME": "Sarah",
    "EMBEDDING_MODEL": "@cf/baai/bge-base-en-v1.5",
    "EMBEDDING_DIMENSIONS": 768,
    "LLM_MODEL": "@cf/meta/llama-3.1-8b-instruct-fp8",
    "SMALL_LLM": "@cf/meta/llama-3.2-3b-instruct",
    "RERANKING_MODEL": "@cf/baai/bge-reranker-base",
    "VECTOR_INDEX": "",
    "R2_BUCKET_NAME": ""
  }
}
```

---

## Model Configuration

AI models are configurable at runtime without restarting the server. Changes take effect immediately for all subsequent requests.

### Supported Model Keys

| Key | Purpose | Default | Allowed Values |
|-----|---------|---------|----------------|
| `EMBEDDING_MODEL` | Text embedding model | `@cf/baai/bge-base-en-v1.5` | `@cf/baai/bge-base-en-v1.5`, `@cf/baai/bge-large-en-v1.5`, `@cf/baai/bge-small-en-v1.5`, `@cf/baai/bge-m3`, `@cf/llmware/bge-small-en-v1.5` |
| `EMBEDDING_DIMENSIONS` | Vector dimensions | `768` | Positive integer (auto-set when `EMBEDDING_MODEL` changes) |
| `LLM_MODEL` | Primary LLM for responses | `@cf/meta/llama-3.1-8b-instruct-fp8` | `@cf/meta/llama-3.1-8b-instruct-fp8`, `@cf/meta/llama-3.3-70b-instruct-fp8`, `@cf/meta/llama-3.2-3b-instruct`, `@cf/meta/llama-3.1-70b-instruct`, `@cf/meta/llama-3.1-8b-instruct`, `@cf/meta/llama-4-scout-17b-16e-instruct` |
| `SMALL_LLM` | Query rewriting (lightweight) | `@cf/meta/llama-3.2-3b-instruct` | `@cf/meta/llama-3.2-3b-instruct`, `@cf/meta/llama-3.1-8b-instruct-fp8`, `@cf/meta/llama-3.2-1b-instruct` |
| `RERANKING_MODEL` | Cross-encoder reranking | `@cf/baai/bge-reranker-base` | `@cf/baai/bge-reranker-base`, `@cf/baai/bge-reranker-large` |

### How It Works

- Model values are validated against an allowlist before being applied
- When `EMBEDDING_MODEL` changes, `EMBEDDING_DIMENSIONS` is automatically updated to match
- Changes are persisted to `runtime-config.json` on disk and survive server restarts
- Use `POST /cloudflare/config/reset` to revert to environment defaults

### Example: Switch to a Larger LLM

```bash
# Switch primary LLM to 70B parameter model
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -d '{"key": "LLM_MODEL", "value": "@cf/meta/llama-3.3-70b-instruct-fp8"}'
```

### Example: Switch Embedding Model

```bash
# Switch to multilingual embedding model (dimensions auto-update to 1024)
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -d '{"key": "EMBEDDING_MODEL", "value": "@cf/baai/bge-m3"}'
```

> **Warning:** Changing the embedding model requires re-indexing existing vectors if the new model uses different dimensions. The old vectors will not be compatible with the new model's output.

---

## Resource Configuration

Vector indexes and R2 buckets are configurable at runtime without restarting the server. This allows switching which Cloudflare resources the `ask` and `ask-stream` APIs use.

### Supported Resource Keys

| Key | Purpose | Default | Validation |
|-----|---------|---------|------------|
| `VECTOR_INDEX` | Vectorize index for semantic search | From `VECTOR_INDEX` env var | Lowercase letters, numbers, hyphens only; 3–63 characters |
| `R2_BUCKET_NAME` | R2 bucket storing chunk data | From `R2_BUCKET_NAME` env var | Lowercase letters, numbers, hyphens only; 3–63 characters |

### How It Works

- Resource names are validated against Cloudflare naming rules before being applied
- Changes take effect immediately — no server restart required
- Each request reads the current config, so you can switch resources on the fly
- Values fall back to environment variables if not set in runtime config
- Changes are persisted to `runtime-config.json` on disk and survive server restarts
- Use `POST /cloudflare/config/reset` to revert to environment defaults

### Example: Switch Vector Index

```bash
# Switch to a different vector index
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -H "x-company-name: popularcert" \
  -d '{"key": "VECTOR_INDEX", "value": "production-index"}'
```

### Example: Switch R2 Bucket

```bash
# Switch to a different R2 bucket
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ADMIN_API_KEY" \
  -H "x-company-name: popularcert" \
  -d '{"key": "R2_BUCKET_NAME", "value": "production-bucket"}'
```

### Example: List Available Resources

Before switching, you can discover available resources:

```bash
# List all vector indexes
curl http://localhost:3000/cloudflare/indexes

# List all R2 buckets
curl http://localhost:3000/cloudflare/buckets
```

> **Warning:** Ensure the selected vector index and R2 bucket contain matching data. Switching to an index that was not populated from the same bucket will produce incorrect or empty results.

---

## System Prompt Configuration

The system prompt controls how the AI assistant behaves, what rules it follows, and what information it can reference. The prompt is stored as a template with `{{VARIABLE}}` placeholders that are resolved at runtime with live config values.

### Supported Variables

| Variable | Resolves To | Example |
|----------|-------------|---------|
| `{{CONSULTANT_NAME}}` | Assistant name | `Sarah` |
| `{{COMPANY_NAME}}` | Company name | `Popularcert` |
| `{{CONTACT_US_URL}}` | Contact page URL | `https://popularcert.com/contact-us/` |
| `{{LOCATIONS_URL}}` | Locations page URL | `https://popularcert.com/locations/` |
| `{{SERVICES_URL}}` | Services page URL | `https://popularcert.com/services/` |
| `{{BASE_URL}}` | Base URL | `https://popularcert.com` |

### Get Current Prompt

```
GET /cloudflare/prompt
```

Returns the current system prompt template, the resolved preview (with variables replaced), and available variables.

**Required Header:** `x-company-name`

**Example:**
```bash
curl -H "x-company-name: popularcert" http://localhost:3000/cloudflare/prompt
```

**Response (200):**
```json
{
  "success": true,
  "prompt": {
    "template": "You are {{CONSULTANT_NAME}}, an AI assistant for {{COMPANY_NAME}}...",
    "resolved": "You are Sarah, an AI assistant for Popularcert...",
    "variables": {
      "CONSULTANT_NAME": "Sarah",
      "COMPANY_NAME": "Popularcert",
      "CONTACT_US_URL": "https://popularcert.com/contact-us/",
      "LOCATIONS_URL": "https://popularcert.com/locations/",
      "SERVICES_URL": "https://popularcert.com/services/",
      "BASE_URL": "https://popularcert.com"
    }
  }
}
```

### Update Prompt

```
PUT /cloudflare/prompt
```

Updates the system prompt template. Accepts `{{VARIABLE}}` placeholders that are resolved at runtime.

**Required Header:** `x-company-name`

**Example:**
```bash
curl -X PUT http://localhost:3000/cloudflare/prompt \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{"template": "You are {{CONSULTANT_NAME}}, an AI assistant for {{COMPANY_NAME}}. Be professional and concise. Contact: {{CONTACT_US_URL}}"}'
```

**Request Body:**
```json
{
  "template": "You are {{CONSULTANT_NAME}}, an AI assistant for {{COMPANY_NAME}}..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `template` | string | Yes | The system prompt template with `{{VARIABLE}}` placeholders |

**Response (200):**
```json
{
  "success": true,
  "message": "System prompt updated.",
  "prompt": {
    "template": "You are {{CONSULTANT_NAME}}, an AI assistant for {{COMPANY_NAME}}...",
    "resolved": "You are Sarah, an AI assistant for Popularcert..."
  }
}
```

**Response (400):**
```json
{
  "success": false,
  "error": "template must be a non-empty string."
}
```

### How It Works

- The template is stored in `runtime-config.json` as `SYSTEM_PROMPT`
- Variables like `{{CONSULTANT_NAME}}` are replaced with live config values at request time
- If a config value changes (e.g., consultant name), the prompt updates automatically without restarting
- Use `POST /cloudflare/prompt/reset` to revert to the default template
