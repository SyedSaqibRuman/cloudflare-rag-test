# Architecture

## Overview

```
User Question
      ↓
Intent Detection (fast path / greeting / blocked)
      ↓
Query Rewriting (configurable LLM — standalone query)
      ↓
Embedding Generation (configurable model)
      ↓
Vector Search (Cloudflare Vectorize)
      ↓
Hybrid Scoring (85% vector + 15% keyword)
      ↓
Deduplication
      ↓
Reranking (configurable reranker model)
      ↓
Chunk Retrieval (Cloudflare R2)
      ↓
Context Building (max 4000 chars)
      ↓
LLM Response (configurable LLM)
      ↓
Final Answer
```

---

## End-to-End Setup Flow

This section walks through the complete journey from creating a company to asking questions — the path every new tenant follows.

### Step 1 — Create Company

```
#companies → [Create Company]

  Company name: [ popularcert ]
  Company key:  [ popularcert ] (auto-generated, /^[a-z0-9-]+$/)

  POST /cloudflare/companies
  Body: { name: "popularcert" }

  → MySQL: companies row + 3 default environments (Development, Staging, Production)
  → Credentials: EMPTY (no Cloudflare keys yet)

  Note: SQLite (db/<company>.db) is a legacy compatibility backend. The
  canonical v5 flow uses MySQL exclusively (CONFIG_STORE=mysql in .env).
```

### Step 2 — Add Provider (Catalog)

```
#catalog → [Add OpenAI Compatible]

  Provider key:  cloudflare
  Provider name: Cloudflare AI
  Category:      ai
  Auth type:     bearer_token
  Base URL:      https://api.cloudflare.com/client/v4

  POST /gateway/providers
  Body: { providerKey, providerName, category, authType }

  → MySQL: providers + auth_schemas + capabilities + models
  → Registry cache invalidated
```

### Step 3 — Add Credential (Gateway Connection)

```
#catalog/cloudflare → Connections → [Add Connection]

  Provider:     Cloudflare AI (pre-selected)
  Name:         Production Cloudflare
  Key:          cloudflare-prod
  Environment:  Production
  API Token:    ********************************
  Account ID:   ********************************

  POST /gateway/companies/popularcert/credentials
  Body: { providerKey, credentialKey, fields: { api_token, account_id } }

  → MySQL: credentials row (encrypted_credentials = AES-256-GCM blob)
  → RAG config store (synced by rag-sync.js):
      CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
      R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
```

### Step 4 — Provision Resources (Vector Index + R2 Bucket)

```
#catalog/cloudflare → Resources Card

  Vector Index: [+ Create "popularcert-vectors"]
  R2 Bucket:    [+ Create "popularcert-docs"]

  POST /gateway/companies/popularcert/resources
  Body: { resourceType, resourceName, config }

  → MySQL: provider_resources
  → Live Cloudflare API: Vectorize index + R2 bucket created
```

### Step 5 — Create Knowledge Base

```
#kbs → [Create Knowledge Base]

  KB Key:          iso-docs
  KB Name:         ISO Certification Docs
  Embedding Model: bge-base-en-v1.5 (from catalog)
  Vector Store:    popularcert-vectors (from resources)
  Object Storage:  popularcert-docs (from resources)
  Chunk Size:      512
  Retrieval Top-K: 10

  POST /gateway/kbs
  Body: { kbKey, kbName, embeddingModelId, vectorResourceId,
          storageResourceId, chunkSize, retrievalTopK }

  → MySQL: knowledge_bases
     embedding_model_id → provider_models row
     vector_resource_id → provider_resources row (vector_index)
     storage_resource_id → provider_resources row (object_bucket)
     status: "ready"

  Authorization chain (enforced at runtime):
     Embedding Model
         ↓
     Provider Model
         ↓
     Credential Model Access  ← prevents unauthorized model usage
         ↓
     Credential
         ↓
     Provider
```

### Step 6 — Create Assistant

```
#assistants → [Create Assistant]

  Assistant Key:   iso-assistant
  Assistant Name:  ISO Certification Bot
  Credential:      cloudflare-prod (from Step 3)
  Model:           @cf/meta/llama-3.1-8b-instruct
  Primary KB:      iso-docs (from Step 5)
  System Prompt:   "You are an ISO certification expert..."
  Temperature:     0.3
  Max Tokens:      4096

  POST /gateway/assistants
  Body: { assistantKey, credentialId, modelId, primaryKbId,
          systemPrompt, temperature, maxTokens }

  → MySQL: assistants
     credential_id → credentials row (API keys)
     model_id → provider_models row (LLM model)
     primary_kb_id → knowledge_bases row
     model_key (denormalized for fast lookup)

  Authorization chain (enforced at runtime):
     Assistant
         ↓
     Credential
         ↓
     Credential Model Access  ← prevents unauthorized model usage
         ↓
     Provider Model
```

### Step 7 — Select Assistant for Company

```
#config → Models tab → Assistant dropdown

  Assistant: [ iso-assistant ]

  This overrides the entire pipeline persona:
  • System prompt from assistant
  • LLM model from assistant's credential
  • Retrieval index from assistant's primary KB
  • Temperature / max tokens from assistant

  PUT /cloudflare/companies/popularcert
  Body: { ASSISTANT_KEY: "iso-assistant" }

  → Runtime Config (memory singleton):
      ASSISTANT_KEY → on next /ask:
        resolveAssistant("iso-assistant")
        → overrides persona, model, retrieval index

  Note: ASSISTANT_KEY is the legacy runtime compatibility setting for
  selecting a company's default assistant. The canonical v5 flow treats
  the assistant as the single source of truth for persona, model, KB,
  and parameters. ASSISTANT_KEY exists only so the legacy config page
  can select an assistant without the gateway's company-assistant table.
```

### Step 8 — Run Ingestion

```
#kbs/iso-docs → [Start Ingestion]

  Ingestion Scope:
    ○ Entire website    → { scope: "all", contentTypes: ["page", "post"] }
    ○ Selected pages    → { scope: "selected", items: [{ type: "page", id: 123 }] }
    ○ Limit documents   → { scope: "limit", limit: 100, contentTypes: ["page", "post"] }

  POST /gateway/kbs/iso-docs/ingest
  Body: { scope: { scope: "all", contentTypes: ["page", "post"] } }

  Returns:
  { jobId: "ing_01...", status: "started" }

  The ingestion runs as a background job (standalone job tracked in
  standaloneJobs Map). Status is polled via:
  GET /gateway/kbs/iso-docs/status
```

```
ingest.js → main()
  │
  ├── KB status → "indexing"
  │
  ├── resolveKbAdapters(kb, company)
  │     ├── storage_resource_id → resolveResourceConnection()
  │     │   → createStoreAdapter("cloudflare", creds, bucket)
  │     ├── embedding_model_id → resolveEmbeddingModel()
  │     │   → createEmbeddingAdapter("cloudflare", creds, model)
  │     └── vector_resource_id → resolveResourceConnection()
  │         → createVectorAdapter("cloudflare", creds, index)
  │
  └── runIngestion({ store, index, ... })
        │
        ├── WordPress Source Fetcher
        │   GET /wp-json/wp/v2/pages|posts (per_page=100, pagination)
        │
        ├── Registry (skip unchanged posts)
        │   isStale(post, modified)?
        │
        ├── Cleaner
        │   HTML → Markdown (turndown) → strip boilerplate
        │
        ├── Chunker
        │   Split by chunk_size (512) → filter < 40 chars
        │
        ├── ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
        │   │ Object Store (R2)│    │ Embedding Model  │    │ Graph Extractor  │
        │   │ uploadChunk()    │    │ embed(texts)     │    │ (optional, async)│
        │   └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
        │            │                       │                       │
        │            │              ┌────────▼─────────┐             │
        │            │              │ Vector Store     │             │
        │            │              │ upsert(chunks)   │             │
        │            │              └────────┬─────────┘             │
        │            │                       │                       │
        │            └───────────┬───────────┴───────────────────────┘
        │                        ▼
        │              Registry.record()
        │              (mark as processed)
        │
        ├── On completion:
        │   KB status → "active"
        │   Audit: kb.ingest.completed + statistics
        │
        │   Ingestion Statistics:
        │   {
        │     documentsDiscovered: 1250,
        │     documentsProcessed:  840,
        │     documentsSkipped:    390,
        │     chunksCreated:       6210,
        │     vectorsUpserted:     6210,
        │     durationMs:          182340
        │   }
        │
        ├── On failure: KB status → "error" + audit
        └── On abort:   KB status unchanged (clean exit)
```

### Step 9 — Ask Questions (RAG)

```
POST /ask
Header: x-company-name: popularcert
Body: { "question": "What ISO certifications do you offer?" }
```

```
RAG Pipeline (query/)
  │
  ├── 1. Intent check (intent.js)
  │      → not greeting/vague/blocked → proceed
  │
  ├── 2. Resolve assistant (assistant.js)
  │      → ASSISTANT_KEY = "iso-assistant"
  │      → overrides: system_prompt, model, temperature,
  │        vector index, primary KB
  │
  ├── 3. Rewrite followup (llm.js)
  │      → if history, rewrite with SMALL_LLM
  │
  ├── 4. Cache check (cache.js)
  │      → MD5: "popularcert:rewritten question"
  │      → hit? return cached answer
  │
  ├── 5. Embed question (cloudflare_embeddings.js)
  │      → CF REST API → 768-dim vector
  │
  ├── 6. Vector query (vectorize.js)
  │      → top 10 from Vectorize
  │      → filter: ≥75% of top score AND ≥0.5 abs
  │
  ├── 7. Hybrid scoring (scoring.js)
  │      → 85% vector + 15% keyword
  │
  ├── 8. Dedupe + rerank (reranker.js)
  │      → dedupe by post_id/url/r2_key
  │      → if >3 matches: rerank with RERANKING_MODEL
  │      → top 5
  │
  ├── 9. Fetch chunks from R2 (via store adapter)
  │      → metadata.r2_key → R2 GET
  │      → build context (max 4000 chars, [Source N] labels)
  │
  ├── 10. LLM call (answer.js)
  │       → model from assistant override
  │       → system_prompt from assistant
  │       → context + question → answer + sources
  │
  └── 11. Cache result (cache.js)
          → MD5 key → 60-min TTL
```

### Entity Relationship

```
Company
  ├── Environments (Development / Staging / Production)
  │     └── Credentials (encrypted at rest, per-environment)
  │           └── Provider (from catalog)
  │                 └── Credential Model Access (authorization boundary)
  │                       └── Provider Model
  │
  ├── Resources (Vectorize index, R2 bucket, Neo4j DB)
  │     └── Provider (from catalog)
  │           └── Credential (API keys for live provisioning)
  │
  ├── Knowledge Bases
  │     ├── Embedding Model → Provider Model
  │     │     └── (authorized via Credential Model Access)
  │     ├── Vector Store → Provider Resource
  │     ├── Object Storage → Provider Resource
  │     └── Graph Store → Provider Resource (optional)
  │
  └── Assistants
        ├── Credential → Provider (API keys)
        ├── Model → Provider Model (LLM)
        │     └── (authorized via Credential Model Access)
        ├── Primary KB → Knowledge Base
        └── Graph Resource → Provider Resource (optional)
```

### Key Principles

> **The Knowledge Base controls infrastructure.** Each KB binds to specific
> provider resources (vector index, R2 bucket, embedding model). The
> ingestion pipeline never knows whether it's using Cloudflare, S3,
> Pinecone, or OpenAI — it receives provider-agnostic adapters from
> `resolveKbAdapters()`. Adding a new provider means adding an adapter
> class + factory case — zero changes to the pipeline.

> **Credential Model Access is the authorization boundary.** A KB or
> Assistant cannot use a model unless the credential has a
> `credential_model_access` row granting permission. This prevents a KB
> from using an embedding model the credential isn't authorized for, and
> prevents an Assistant from calling an LLM model outside the credential's
> allowed set.

> **SQLite is legacy compatibility only.** The canonical v5 flow uses
> MySQL (`CONFIG_STORE=mysql`). SQLite (`db/<company>.db`) exists only
> for backward compatibility with companies created before the MySQL
> backend was introduced. On first MySQL boot, existing SQLite companies
> are auto-lifted into MySQL.

---

## RAG Pipeline

### How It Works

1. **Intent Detection** — Greetings, identity queries, and blocked patterns return instant static responses without hitting the RAG pipeline.

2. **Query Rewriting** — Follow-up questions are rewritten into standalone search queries using the configured small LLM (default: `llama-3.2-3b-instruct`) to improve retrieval quality.

3. **Embedding** — The question is embedded using the configured embedding model (default: `bge-base-en-v1.5`, 768 dimensions).

4. **Vector Search** — Top 10 nearest neighbors are retrieved from Cloudflare Vectorize.

5. **Hybrid Scoring** — Results are scored with 85% vector similarity + 15% keyword overlap.

6. **Deduplication** — Duplicate results (same post/page) are merged, keeping the highest score.

7. **Reranking** — Top 10 candidates are reranked using the configured reranker model (default: `bge-reranker-base`) for precision.

8. **Chunk Retrieval** — Final top 5 chunks are fetched from R2 storage.

9. **Context Building** — Chunks are assembled into a context string (max 4000 chars) with source labels.

10. **LLM Generation** — The configured LLM (default: `llama-3.1-8b-instruct-fp8`) generates the final answer with the context.

### Default Models

| Role | Model | Dimensions | Configurable |
|------|-------|------------|--------------|
| Embeddings | `@cf/baai/bge-base-en-v1.5` | 768 | Yes — `EMBEDDING_MODEL` |
| Reranking | `@cf/baai/bge-reranker-base` | — | Yes — `RERANKING_MODEL` |
| Response Generation | `@cf/meta/llama-3.1-8b-instruct-fp8` | — | Yes — `LLM_MODEL` |
| Query Rewriting | `@cf/meta/llama-3.2-3b-instruct` | — | Yes — `SMALL_LLM` |

All models can be changed at runtime via the Cloudflare API. See [Model Configuration](./api/config.md#model-configuration).

### Caching

- In-memory cache with 60-minute TTL
- Max 200 entries with FIFO eviction
- Cache key: MD5 of `companyName:rewrittenQuestion` (company-scoped)
- Cached responses include `"cached": true` flag

---

## Module Layout

The codebase is split by responsibility — thin HTTP routers (one resource group per file/dir), business logic in `services/`, and all SQL in repository files. Barrels (`mysql/repositories.js`, `mysql/gateway-router.js`, `routes/cloudflare.js`) re-export the split modules, so import paths never change.

```
app.js                     Express server: middleware, rate limits, /ask, /ask-stream, SPA
config/                    Multi-tenant company config (facade, schema, SQLite/MySQL stores, encryption)
query/                     RAG pipeline: intent, rewrite, cache, retrieval, scoring, reranker, answer, cli
services/                  Cloudflare embeddings, Vectorize, R2, WordPress
utils/                     chunker, cleaner, helpers (retry/abort), logger
routes/                    HTTP routers — one resource group per module
  ask.js                   POST /ask, /ask-stream (company gate, API-key gate, SSE contract)
  cloudflare/              companies, apikey, indexes, buckets, config, prompt (+ helpers.js)
  cloudflare.js            barrel — composes cloudflare/ (mounted at /cloudflare)
  cron.js · auth.js · logs.js
mysql/                     MySQL gateway layer — one file per entity / router
  repositories/            one file per entity (provider, model, endpoint, pricing, credential,
                           company, resource, assistant, audit, kb, catalog-import) + helpers.js
  repositories.js          barrel — re-exports every repository
  services/                credential-service, provider-registry, catalog-importer, kb-service, …
  routes/                  one Express router per resource group (providers, companies, credentials,
                           resources, endpoints, pricing, kbs, assistants, health) + helpers/probes
  gateway-router.js        barrel — composes routes/ (mounted at /gateway)
cron/                      standalone jobs, scheduler, lifecycle, status
web/                       React admin portal (Vite)
  src/pages/catalog/       provider list/detail + 5-step wizard (wizard/), one modal per file (modals/)
  src/pages/credentials/   page + modals.jsx · cards.jsx · fields.jsx · helpers.js · icons.jsx
  src/components/layout/   nav.js (NAV/PAGE_META) + icons.jsx (NAV_ICONS)
docs/                      architecture, API reference, OpenAPI spec, provider/credential guides
```

---

## CORS

CORS is dynamic (`utils/request-context.js` `isAllowedOrigin`). A browser origin passes when any of these hold:

- It is on the static allowlist:
  - `https://dev.popularcert.com`
  - `https://staging.popularcert.com`
  - `https://www.popularcert.com`
  - `https://popularcert.com`
  - `https://crm.popularcert.com`
  - `http://localhost:3000`, `http://localhost:5173`, `http://localhost:8080`
- The host is a dev host (`localhost` / `*.localhost`)
- The host is `<company>.com` or a subdomain of it for any company in the runtime config (derived from the company name, e.g. `popularcert` → `popularcert.com`)
- The request carries no `Origin` header (non-browser clients like curl always pass)

---

## Rate Limiting

The API has two hardcoded tiers to protect against abuse and control AI API costs, plus a login brute-force guard. The values are constants in `app.js` / `routes/ask.js` — **not** configurable via environment variables:

| Tier | Routes | Limit |
|------|--------|-------|
| Global | All routes except `GET /` | 100 req/min |
| AI | `POST /ask`, `POST /ask-stream` | 20 req/min |
| Login | `POST /auth/login` (brute-force guard) | 10 req/min |

Admin routes (`/cloudflare/*`, `/gateway/*`) are **not** rate-limited — the global wrapper skips authenticated admin sessions (`verifyToken(extractToken(req))`), so portal/catalog operations never hit a 429.

- Limits are per-IP address (uses the `trust proxy` setting for accurate client IP behind reverse proxies)
- Rate-limited requests receive a `429 Too Many Requests` response with a JSON error body
- Standard `RateLimit-*` headers are returned with every response

---

## Admin Authentication

Admin routes (`/cloudflare/*`, `/gateway/*`, `/logs`, `/api-docs`) are protected by an HMAC-signed session token when `ADMIN_USERNAME` + `ADMIN_PASSWORD` are set in `.env` (see `auth.js` `requireAdmin`). Tokens come from `POST /auth/login` and travel via `Authorization: Bearer`, `x-auth-token`, or a path-scoped `pc_admin_token` cookie (Swagger UI). When the login env vars are unset, auth is disabled and every route stays open. The `/gateway` layer additionally returns **503** when the `MYSQL_*` env vars are unset.

---

## Logging

- In development (`NODE_ENV !== 'production'`), verbose debug logs are printed to the console
- In production, debug logs are suppressed for cleaner output
- File logs are always written to `logs/` regardless of environment (`utils/logger.js`, async/batched, ~5MB rotation)

---

## Admin Portal

The same Express server serves the React admin portal from `web/dist` (built with `cd web && npm run build`). Hash-based routes: `#dashboard`, `#ask`, `#companies`, `#config`, `#cloudflare`, `#scheduler`, `#logs`, `#catalog` (provider catalog), `#kbs` / `#kbs/<key>` (knowledge bases), and `#assistants`. (The legacy `#prompt` page was removed — system prompts are edited per assistant.) The portal requires admin auth when the login env vars are set.
