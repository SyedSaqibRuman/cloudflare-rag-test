---
type: backend
status: active
area: backend
tags: [routes, endpoints]
related:
  - "[[API Reference]]"
  - "[[Application Flow]]"
---

# Routes Map

All paths verified against router files. Gateway list abbreviated here; deep tables in [[API Reference]].

## Public / mixed

| Method & path | Purpose | Gate |
|---|---|---|
| `POST /ask` | RAG JSON answer | company header + optional key + 20/min |
| `POST /ask-stream` | SSE answer | same as /ask |
| `POST /ask/reset` | purge company's cached answers | company + optional key (no AI limiter) |
| `GET /` | portal shell (browser) or status JSON | open |
| `GET /_health`, `/​_health/detailed` | infra probes | open |
| `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` | admin session | login brute-force 10/min |
| `GET/POST/DELETE /api-docs…` | Swagger UI + spec JSON | requireAdmin |

## /cloudflare/*  (mounted ×requireAdmin)

| Router file | Endpoints |
|---|---|
| `routes/cron.js` | `GET/POST /presets`, `PUT/DELETE /presets/:id`, `POST /job/start`, `POST /job/stop`, `GET /jobs/running`, `POST /cron/start`, `POST /cron/stop`, `GET /jobs`, `GET /status` |
| `cloudflare/companies.js` | `GET /companies`, `POST /companies`, `GET/PUT/DELETE /companies/:name`, `POST /companies/:name/reset` |
| `cloudflare/apikey.js` | `POST /companies/:name/apikey`, `DELETE /companies/:name/apikey`, `GET /companies/:name/apikey` (status only) |
| `cloudflare/config.js` | `GET /config`, `PUT /config`, `POST /config/reset` |
| `cloudflare/prompt.js` | `GET /prompt`, `PUT /prompt`, `POST /prompt/reset` |
| `cloudflare/indexes.js` | `GET /indexes`, `POST /indexes {name,dimensions?}`, `DELETE /indexes/:name` |
| `cloudflare/buckets.js` | `GET /buckets`, `POST /buckets {name}`, `DELETE /buckets/:name`, `POST /buckets/:name/clear` |

## /gateway/*  (outer requireAdmin + inner `gate` 503)

| Router file | Groups (relative to mount) |
|---|---|
| `health.js` | `GET /health` (+registry loader hook) |
| `providers.js` | catalog CRUD, `/providers/:key/auth-form`, `/resources(templates)`, `/models` CRUD nested under provider, import endpoint(s) — the largest surface (~20 routes) |
| `companies.js` | company CRUD + environments + credentials-scope helpers |
| `resources.js` | provision/update/delete provider_resources rows (+ rag-sync hooks) |
| `credentials.js` | list/create/test/rotate/update/delete connections; model-access grants; verification history |
| `endpoints.js`, `pricing.js` | CRUD for endpoint URLs & model pricing |
| `kbs.js` | `kbs/options`; `kbs` list/create; `kbs/:key` get/put/delete; `:key/sources`; `:key/documents`; `:key/ingest`; `:key/status`; `:key/source-pages`; `:key/ingest-progress` |
| `assistants.js` | assistant CRUD bound to credential/model/KB/graph resource |
| `execute.js` | `POST companies/:key/execute/chat`, `/execute/embeddings` (audited live calls) |
| `cloudflare-resources.js` | type-aware live listing/provisioning of account resources feeding selector cards |
| `vector-resources.js` | live listing/provisioning of the non-Cloudflare vector stores (Qdrant collections / Pinecone indexes / Weaviate classes) at `companies/:key/vector/resources/:provider[/:name]` — talks to the store through the company's active gateway connection via the `mysql/adapters/vector/` adapters; a create also registers a `vector_index` provider_resources row (external id = live name, config carries `collection_name`/`index_name`/`class_name` so the resolvers can bind it) |
| `ingestion.js` | `/ingest/jobs`, `/ingest/start`, `/ingest/status/:companyName`, `/ingest/cancel/:companyName`, stub history |

## /logs  (requireAdmin)

`GET /` list files · `GET /:name?tail=` read · `GET /:name/download` · `GET /export` bundle · `DELETE /:name` & `DELETE /` clear · `POST /ui` toast sink (`useToast` hook fire-and-forget).

## Cross-cutting middleware order per request

CORS → json → requestLogger → globalLimiter wrapper ([[Middleware]]) → mounted router chains above. For per-endpoint middleware details see [[API Reference]] "Authentication" columns.