# API: Config

Manage runtime configuration such as the WordPress domain URL, AI model settings, Cloudflare resource selection (vector indexes, R2 buckets), and the system prompt. All config endpoints require the `x-company-name` header to specify which company's config to read or modify, and sit behind admin auth — attach the token from `POST /auth/login` via `Authorization: Bearer <token>` (required when `ADMIN_USERNAME` / `ADMIN_PASSWORD` are set in `.env`).

## Get Current Config

```
GET /cloudflare/config
```

Returns the current runtime configuration for the specified company.

**Required Header:** `x-company-name`

**Example:**
```bash
curl -H "x-company-name: popularcert" http://localhost:3000/cloudflare/config

# With admin token
curl -H "Authorization: Bearer <token>" -H "x-company-name: popularcert" http://localhost:3000/cloudflare/config
```

**Response (400 — missing header):**
```json
{
  "success": false,
  "error": "Company is required (x-company-name header, ?company=, or body.company)."
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

Resets the **entire** config store: removes all companies and recreates a single default company. This is a nuclear reset — use it carefully. To reset just one company, use `POST /cloudflare/companies/:name/reset` instead.

**Example:**
```bash
curl -X POST http://localhost:3000/cloudflare/config/reset

# With admin token
curl -X POST -H "Authorization: Bearer <token>" http://localhost:3000/cloudflare/config/reset
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
- Changes are persisted per company in the config store (MySQL `company_config` or `db/<company>.db`) and survive server restarts
- Use `POST /cloudflare/companies/:name/reset` to revert one company to defaults

### Example: Switch to a Larger LLM

```bash
# Switch primary LLM to 70B parameter model
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"key": "LLM_MODEL", "value": "@cf/meta/llama-3.3-70b-instruct-fp8"}'
```

### Example: Switch Embedding Model

```bash
# Switch to multilingual embedding model (dimensions auto-update to 1024)
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"key": "EMBEDDING_MODEL", "value": "@cf/baai/bge-m3"}'
```

> **Warning:** Changing the embedding model requires re-indexing existing vectors if the new model uses different dimensions. The old vectors will not be compatible with the new model's output.

---

## Resource Configuration

Vector indexes and R2 buckets are configurable at runtime without restarting the server. This allows switching which Cloudflare resources the `ask` and `ask-stream` APIs use.

### Supported Resource Keys

| Key | Purpose | Default | Validation |
|-----|---------|---------|------------|
| `VECTOR_INDEX` | Vectorize index for semantic search | Empty — set per company | Lowercase letters, numbers, hyphens only; 3–63 characters |
| `R2_BUCKET_NAME` | R2 bucket storing chunk data | Empty — set per company | Lowercase letters, numbers, hyphens only; 3–63 characters |

### How It Works

- Resource names are validated against Cloudflare naming rules before being applied
- Changes take effect immediately — no server restart required
- Each request reads the current config, so you can switch resources on the fly
- Values fall back to the hardcoded defaults in `config/schema.js` when unset (nothing is seeded from env)
- Changes are persisted per company in the config store (MySQL `company_config` or `db/<company>.db`) and survive server restarts
- Use `POST /cloudflare/companies/:name/reset` to revert one company to defaults

### Example: Switch Vector Index

```bash
# Switch to a different vector index
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -H "x-company-name: popularcert" \
  -d '{"key": "VECTOR_INDEX", "value": "production-index"}'
```

### Example: Switch R2 Bucket

```bash
# Switch to a different R2 bucket
curl -X PUT http://localhost:3000/cloudflare/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -H "x-company-name: popularcert" \
  -d '{"key": "R2_BUCKET_NAME", "value": "production-bucket"}'
```

### Example: List Available Resources

Before switching, you can discover available resources:

```bash
# List all vector indexes (company required)
curl -H "x-company-name: popularcert" http://localhost:3000/cloudflare/indexes

# List all R2 buckets (company required)
curl -H "x-company-name: popularcert" http://localhost:3000/cloudflare/buckets
```

> **Warning:** Ensure the selected vector index and R2 bucket contain matching data. Switching to an index that was not populated from the same bucket will produce incorrect or empty results.

---

## System Prompt Configuration

The system prompt controls how the AI assistant behaves, what rules it follows, and what information it can reference. The prompt is stored as a template with `{{VARIABLE}}` placeholders that are resolved at runtime from **custom variables**.

### There Are No Built-In Variables

`{{VARIABLE}}` placeholders used to be filled automatically from company config and the wall clock — `{{CONSULTANT_NAME}}`, `{{COMPANY_NAME}}`, `{{CONTACT_US_URL}}`, `{{LOCATIONS_URL}}`, `{{SERVICES_URL}}`, `{{BASE_URL}}`, `{{COMPANY_WEBSITE}}`, `{{ASSISTANT_NAME}}`, `{{CURRENT_DATE}}`, `{{CURRENT_YEAR}}`. **Those are gone.** Company config fields are no longer injected into prompts implicitly; every placeholder must be defined as data.

Two tiers supply values, assistant winning on conflict:

| Tier | Storage | Managed at |
|---|---|---|
| Company | `PROMPT_VARIABLES` config key (array of `{key, value}`) | Config → Prompt → Default System Prompt |
| Assistant | `assistants.assistant_variables` | Assistants → edit → Prompt tab |

Rules:

- Keys are uppercase identifiers (`[A-Z][A-Z0-9_]*`, ≤ 64 chars); matching is case-insensitive, so `{{brand}}` resolves a `BRAND` variable.
- At most 50 variables per tier; values ≤ 2000 characters.
- **An unmatched placeholder is left literal** in the resolved prompt and listed in the `missing` array — it is never silently blanked, so gaps are visible instead of quietly deleting prompt text.
- `CURRENT_DATE` / `CURRENT_YEAR` are no longer auto-computed. Define them as custom variables if you want a value, and remember a stored date goes stale.

Existing tenants predate this change — run `node scripts/backfill-prompt-variables.mjs` (dry run by default, `--apply` to write) to materialize their former built-ins as `PROMPT_VARIABLES` so prompts resolve exactly as before.

### Get Current Prompt

```
GET /cloudflare/prompt
```

Returns the template, the resolved preview, the merged variable map, each tier separately, and any unresolved placeholders.

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
      "COMPANY_NAME": "Popularcert"
    },
    "companyVariables": [
      { "key": "CONSULTANT_NAME", "value": "Sarah" },
      { "key": "COMPANY_NAME", "value": "Popularcert" }
    ],
    "assistantVariables": [],
    "missing": []
  }
}
```

| Field | Description |
|---|---|
| `variables` | Merged map (company ⊕ assistant, assistant wins) — what the LLM receives |
| `companyVariables` | The company's `PROMPT_VARIABLES` tier |
| `assistantVariables` | The selected assistant's own variables |
| `missing` | Placeholders the template uses that no tier defines (kept literal) |

### Update Prompt

```
PUT /cloudflare/prompt
```

Updates the system prompt template and, optionally, its variables in the same write.

**Required Header:** `x-company-name`

**Example:**
```bash
curl -X PUT http://localhost:3000/cloudflare/prompt \
  -H "Content-Type: application/json" \
  -H "x-company-name: popularcert" \
  -d '{"template": "You are {{CONSULTANT_NAME}}...", "variables": [{"key": "CONSULTANT_NAME", "value": "Sarah"}]}'
```

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `template` | string | Yes | The system prompt template with `{{VARIABLE}}` placeholders |
| `variables` | array | No | `[{key, value}]` replacing `PROMPT_VARIABLES`. Omit to keep the current set. |

**Response (200):**
```json
{
  "success": true,
  "message": "System prompt updated.",
  "prompt": {
    "template": "You are {{CONSULTANT_NAME}}...",
    "resolved": "You are Sarah...",
    "variables": { "CONSULTANT_NAME": "Sarah" },
    "companyVariables": [{ "key": "CONSULTANT_NAME", "value": "Sarah" }],
    "assistantVariables": [],
    "missing": []
  }
}
```

**Response (400):**
```json
{
  "success": false,
  "error": "PROMPT_VARIABLES key 'bad key!' is invalid — use letters, digits and underscores, starting with a letter (e.g. BRAND_NAME)."
}
```

### How It Works

- The template is stored per company as `SYSTEM_PROMPT`; its variables as `PROMPT_VARIABLES` (a JSON array) in the config store (MySQL `company_config` or `db/<company>.db`)
- Both are returned by `GET /cloudflare/config` under the `PROMPT` section
- Placeholders resolve at request time from the merged tiers; the ask pipeline (`query/prompts.js`) applies the same merge as the Config page preview
- Editing a variable's value updates the live prompt without a restart
- Use `POST /cloudflare/prompt/reset` to revert both the template **and** the default variable set
