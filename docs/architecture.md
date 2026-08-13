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
