# PopularCert RAG API — Complete Codebase Documentation

> A single-file, current reference for the whole repository: architecture, data model,
> every HTTP surface, the RAG pipeline, ingestion, the MySQL gateway layer, workflows,
> webhooks/notifications, GraphRAG (Neo4j), the React admin portal, testing, security,
> and operational gotchas.
>
> This document is written from a direct analysis of the code (not from memory of older
> docs). Where behaviour is version-sensitive it says so. If you change the code, update
> this file in the same commit.

---

## Table of contents

1. [What this application is](#1-what-this-application-is)
2. [High-level architecture](#2-high-level-architecture)
3. [Repository map](#3-repository-map)
4. [Requirements, setup & commands](#4-requirements-setup--commands)
5. [Environment variables](#5-environment-variables)
6. [Server bootstrap & middleware (app.js)](#6-server-bootstrap--middleware-appjs)
7. [Authentication & authorization](#7-authentication--authorization)
8. [Multi-tenant company config store](#8-multi-tenant-company-config-store)
9. [The ask pipeline (RAG query path)](#9-the-ask-pipeline-rag-query-path)
10. [Ask HTTP & SSE contracts](#10-ask-http--sse-contracts)
11. [Assistants (persona layer + guardrails)](#11-assistants-persona-layer--guardrails)
12. [Knowledge bases (gateway layer)](#12-knowledge-bases-gateway-layer)
13. [Ingestion pipeline](#13-ingestion-pipeline)
14. [GraphRAG & Neo4j](#14-graphrag--neo4j)
15. [Scheduler, cron & jobs](#15-scheduler-cron--jobs)
16. [MySQL gateway layer](#16-mysql-gateway-layer)
17. [MySQL schema & migrations](#17-mysql-schema--migrations)
18. [Workflows](#18-workflows)
19. [Webhooks & notifications](#19-webhooks--notifications)
20. [Usage, cost & alerts](#20-usage-cost--alerts)
21. [Admin portal (web/)](#21-admin-portal-web)
22. [Testing](#22-testing)
23. [Security notes](#23-security-notes)
24. [Operational gotchas](#24-operational-gotchas)

---

## 1. What this application is

**PopularCert RAG API** is a multi-tenant, Retrieval-Augmented Generation (RAG) backend
for PopularCert's certification-consulting website. It:

- ingests content (WordPress site, sitemap URLs, uploaded files) into **Cloudflare
  Vectorize** (vectors) and **Cloudflare R2** (chunk JSON), plus optionally a **Neo4j**
  knowledge graph;
- answers questions over that content through **Cloudflare Workers AI** LLMs with an
  optional GraphRAG step, a per-company API key gate, and assistant personas;
- exposes the whole thing through an **admin portal** (React + Vite) and a set of admin
  **REST APIs** for companies, AI providers, credentials, knowledge bases, assistants,
  workflows, webhooks, scheduler, and usage.

Two storage eras coexist and are bridged:

- **Company config store** — per-company AI/RAG settings. Backend is either per-company
  SQLite files (`db/<company>.db`, default) or MySQL tables (`CONFIG_STORE=mysql`).
- **Gateway (MySQL)** — providers, credentials (encrypted), KBs, assistants, workflows,
  usage, audit, webhook notifications. Optional at boot: every `/gateway/*` route returns
  503 when MySQL is not configured.

There is no chatbot UI by design: the product exposes the `ask-stream` API + per-company
API keys for external chatbot builds.

---

## 2. High-level architecture

```
                        ┌──────────────────────────────────────────────┐
   Browser (admin UI) ─▶│ Express 5 server (Node ESM, port 3000)      │
                        │  app.js — middleware, static SPA, health     │
                        └───────┬──────────────┬──────────────┬────────┘
                                │              │              │
                    ┌───────────▼────┐  ┌──────▼────────┐  ┌──▼──────────────────┐
                    │ routes/ (ask, │  │ /gateway      │  │ config/ (company    │
                    │ auth, cron,   │  │ MySQL gateway │  │ config: models,     │
                    │ cloudflare/,  │  │ providers, KBs│  │ creds, prompts,     │
                    │ public,       │  │ assistants,   │  │ API keys) SQLite    │
                    │ workflow-trig)│  │ workflows,    │  │ files OR MySQL      │
                    └──────┬────────┘  │ usage…)       │  └─────────┬───────────┘
                           │           └──────┬────────┘            │
                query/ RAG pipeline           │                     │
                (intent → cache → embed →     │                     │
                 vector search → rerank →     │                     │
                 graph → LLM)                 │                     │
                           │                  │                     │
                ┌──────────▼──────────┐  ┌────▼─────────────┐  ┌───▼────────────┐
                │ Cloudflare Workers  │  │ MySQL 8          │  │ Neo4j (Aura)   │
                │ AI + Vectorize + R2 │  │ (gateway layer + │  │ knowledge graph│
                │                    │  │  company config) │  │ (GraphRAG)     │
                └────────────────────┘  └──────────────────┘  └────────────────┘
```

Main data flows:

- **Ask:** `POST /ask` or `/ask-stream` (admin or API-key) → intent fast-path →
  cache → retrieval (embed → Vectorize → score/rerank) → optional GraphRAG → LLM →
  `{ answer, sources, possibleQuestions }`. Each ask is usage-logged to MySQL.
- **Ingest:** admin starts a job → `ingest.js` resolves adapters from the KB →
  `ingest/pipeline.js` fetch→clean→chunk→store(R2)→index(Vectorize), optionally
  extracts a Neo4j graph, updates KB status and fires webhooks.
- **Admin CRUD:** all gateway resources (`/gateway/...`) behind `requireAdmin`;
  a `/gateway/public/*` subset serves published assistants to third parties.

---

## 3. Repository map

```
app.js                     Express server: middleware, mounts, SPA, /test stream, health
auth.js                    Admin HMAC tokens + requireAdmin + token extraction
env.js                     Frozen env accessor (dotenv) — MySQL + admin login only
client.js                  Shared per-company Cloudflare SDK + S3 clients
jobs.js                    Job registry (testing, ingest) → cron/lifecycle
ingest.js                  Ingestion composition root (KB or legacy adapters, webhooks)
config/                    Company config: schema, SQLite/MySQL stores, codec/encryption,
                           validation, prompts, company CRUD, presets, creds
query/                     RAG pipeline: intent, llm, cache, retrieval, scoring,
                           reranker, context, graph, assistant, prompts, answer,
                           stream-contract, suggestions, cli
services/                  Cloudflare AI / embeddings, Vectorize, R2, WordPress adapters
utils/                     chunker, cleaner, helpers (retry/abort), logger,
                           request-context, request-logger, health-check
routes/                    ask.js, auth.js, cron.js, logs.js, cloudflare/ (companies,
                           apikey, indexes, buckets, config, prompt), public-assistants.js,
                           workflow-triggers.js
mysql/                     Gateway layer + company-config MySQL backend:
                           pool, migrate, adapters/ (embedding, vector, storage),
                           repositories/, services/, routes/, gateway-router barrel
cron/                      lifecycle (standalone + cron), index, testing-job
ingest/                    pipeline.js (pure run loop), sources/ (file, url, wp),
                           registry.js, resolve.js, webhooks.js, graph-extract.js
schema/                    v5.sql (frozen reference — never edit)
migrations/                001…021 incremental SQL migrations (applied at boot)
web/                       React + Vite admin portal → built into web/dist
docs/                      Markdown docs, OpenAPI spec, planning notes
shared/                    Pure ESM helpers shared with the portal: errors, status,
                           patterns, catalog-enums, error-tag
scripts/                   Ad-hoc dev scripts (never run with bare `node --test`)
playwright/                Playwright install/test sandbox (separate)
db/                        SQLite per-company files + legacy json (gitignored)
```

Barrel files exist for the old import paths and re-export the split modules
(`mysql/repositories.js`, `mysql/gateway-router.js`, `routes/cloudflare.js`); imports
never change, docs should point at the split files.

---

## 4. Requirements, setup & commands

- **Node 22.5+** (uses `node:sqlite` — `DatabaseSync`). Verified on v26.5.0.
- **MySQL 8.0+** for the gateway layer (partitioned tables + FKs; MariaDB requires
  dropping the `PARTITION` clauses).
- Optional **Cloudflare** account (Workers AI + Vectorize + R2), optional **Neo4j** for
  GraphRAG.

```bash
npm install                  # root deps (server + tests)
cd web && npm install        # portal deps
cd web && npm run build      # build UI into web/dist — REQUIRED or the server
                             # won't serve the dashboard (hasWeb check)
cd .. && cp .env.example .env
node app.js                  # start API + portal on :3000 (from env PORT)

node mysql/migrate.js        # apply MySQL migrations manually (auto-runs at boot
                             # when CONFIG_STORE=mysql)
node query/cli.js            # REPL through the RAG pipeline (uses .env company)
cd web && npm run dev        # Vite dev server :5173 → proxies to :3000
npm test                     # full suite (all __tests__ dirs, see §22)
npm run lint                 # eslint flat config
node scripts/test.js         # MySQL connectivity test only
```

Install scripts are gated via `allowScripts` in `package.json` (`esbuild`, `workerd`,
`sharp` approved; `@scarf/scarf` telemetry denied). `npm audit` should be at 0
vulnerabilities (`undici@7.29.0` override).

---

## 5. Environment variables

Only operational config lives in env (see `.env.example`). All AI/RAG company config
lives in the config store. Key variables:

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `NODE_ENV` | gates console logging in query path | `development` |
| `CONFIG_STORE` | `mysql` or `sqlite` company config backend | `sqlite` (unset) |
| `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` | Gateway + company-config MySQL | — |
| `APP_ENCRYPTION_KEY` | AES-256-GCM master key (`openssl rand -hex 32`) for company creds & gateway credentials | unset → plaintext + boot warning |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Enable admin login (both set) — **auth is opt-in** | unset → open |
| `ADMIN_SECRET` | HMAC secret signing session tokens; unset → ephemeral random per boot | — |
| `ADMIN_TOKEN_TTL_HOURS` | Session lifetime | `12` |
| `TRUST_PROXY` | `true`/`false`/hop count/IP list for req.ip & rate-limit keys | `true` |

There is **no** Cloudflare/R2/Neo4j credential env seeding: credentials are entered per
company via the gateway connections on the Providers page and auto-synced into the
company config store (`mysql/services/rag-sync.js`).

---

## 6. Server bootstrap & middleware (app.js)

Boot order:

1. Load `.env`, build express app, disable `x-powered-by`.
2. Crash guard: `uncaughtException` / `unhandledRejection` are logged, never silently
   swallowed.
3. `trust proxy` parsed from `TRUST_PROXY` (warns when `true` in production).
4. CORS with **dynamic allowlist**: `utils/request-context.js` `isAllowedOrigin(origin)`
   → hardcoded PopularCert domains + `localhost`, **plus** any `<company>.com` /
   subdomain derived from the runtime company list (and Vite dev hosts). Methods
   `GET/POST/DELETE/OPTIONS`; headers incl. `x-company-name`, `x-api-key`,
   `Authorization`, `x-auth-token`.
5. `express.json({ limit: "1mb" })`.
6. Request logger (structured JSON → file + dev console).
7. **Rate limiting** — three tiers:
   - Global baseline **100 req/min** applied via wrapper `app.use` to everything except
     `/`; authenticated admin sessions bypass it.
   - AI tier **20 req/min** (`aiLimiter` in `routes/ask.js`) on `/ask`, `/ask-stream`,
     `/ask/suggestions` and `/test`.
   - Login brute-force guard **10 req/min** on `POST /auth/login`.
   - Admin/gateway routes deliberately carry **no** limiter.

Mounts (order matters):

| Prefix | Router | Guard |
|---|---|---|
| `/cloudflare` | `routes/cron.js` (scheduler + presets) then `routes/cloudflare.js` | `requireAdmin` |
| `/auth` | `routes/auth.js` | — |
| `/logs` | `routes/logs.js` | `requireAdmin` |
| `/gateway/public` | `routes/public-assistants.js` | company header only |
| `/gateway` | `mysql/gateway-router.js` (gateway) | `requireAdmin` |
| `/webhooks` | `routes/workflow-triggers.js` (public workflow webhook triggers) | company header + optional HMAC token |
| `/ask`… | `createAskRouter()` (`routes/ask.js`) | company + per-company API key |
| `/api-docs` | Swagger UI from `docs/openapi.js` | `requireAdmin` |
| `/` + static | admin SPA from `web/dist` | — |
| `/_health`, `/_health/detailed` | `utils/health-check.js` probes | — |
| `/test` | raw SSE stream smoke test (real, billable AI call) | `requireAdmin` + `aiLimiter` |

Other behaviours:

- `POST /` (SPA) serves `web/dist/index.html` to `Accept: text/html`, JSON otherwise.
- Error handler: `AppError` subclasses (`shared/errors.js`) expose `{ success, error,
  code?, errors? }` with their `status`; anything else → generic 500 (no internals leak).
- 404 catch-all returns `{ success: false, error: "Route not found" }`.
- At boot: `await initConfig()` (fail → exit 1); when `CONFIG_STORE=mysql`:
  `migrate()` (idempotent) + `liftLegacyWebhooks()`; then `app.listen`.
- On listen: starts the workflow **run-purge scheduler** (daily 3 AM, 30-day retention).

---

## 7. Authentication & authorization

**Admin auth (opt-in).** When `ADMIN_USERNAME` **and** `ADMIN_PASSWORD` are set:

- `POST /auth/login` verifies via constant-time compare and returns a session token
  signed `payload.signature` (HMAC-SHA256 over base64url JSON `{u, exp}`). `exp` from
  `ADMIN_TOKEN_TTL_HOURS` (default 12h). Signature key = `ADMIN_SECRET` (ephemeral
  random per boot if unset — tokens die on restart).
- `requireAdmin` gates every `/cloudflare/*`, `/gateway/*` (except `/gateway/public`),
  `/logs`, `/api-docs`.
- `extractToken` reads, in order: `x-auth-token` header → `Authorization: Bearer` →
  path-scoped cookie `pc_admin_token` (only used for the Swagger new-tab flow).
- If either env var is unset, `AUTH_ENABLED=false` → all routes stay open, portal shows
  no login, `GET /auth/me` reports `authenticated: true`.

**Per-company ask API key (opt-in).** Each company config can hold `API_KEY` (see
§8/§10). When set, `requireAskApiKey` gates `POST /ask`, `/ask-stream`,
`GET /ask/suggestions`, `POST /ask/reset`:

- the key must be sent as `x-api-key` or `Authorization: Bearer`, compared with
  `crypto.timingSafeEqual`;
- browser requests (an `Origin`/`Referer` present) must come from `<company>.com` or a
  subdomain (`companyOriginCheck`).
- companies without a key stay open (backwards compatible). The key is **never** returned
  by GET endpoints (redacted, `hasApiKey` flag exposed).

**Public assistants.** `POST /gateway/public/assistants/:key/ask|stream` needs only the
company header and an assistant flagged `is_public + is_active`.

---

## 8. Multi-tenant company config store

Facade: **`config/index.js`** — the only sanctioned import (company CRUD, get/save
config, prompt resolution, validation, `resolveCreds`). Never import
`config/store.js` internals from routes.

**Two backends** (`CONFIG_STORE`):

- `mysql`: `companies` + `company_config` tables (migration `002_company_config.sql`).
- `sqlite` (default/unset): one SQLite file per company `db/<company>.db` — `key/value`
  table, JSON-encoded values.

**Boot-time load:** `initConfig()` populates a `runtimeConfig.COMPANIES` singleton
**before** listen. Reads (`getCompanyConfig`, `getConfig`) are synchronous over this
singleton; MySQL reads happen once at boot. On first MySQL boot, existing SQLite
companies auto-lift when the MySQL table is empty. Legacy `runtime-config.json` is also
migrated (then deleted). **No default company is seeded** — blank slate.

**Write path (async, persist-first):** `saveConfig`/`createCompany`/`updateCompany`/
`deleteCompany`/`setCompanyApiKey`/`updateConfig`/`reset*` await the backend **before**
mutating memory, so failed writes return `{ error }` and leave memory untouched.

**Keys** (`config/schema.js` `COMPANY_KEYS`, whitelisted, sectioned by
`CONFIG_SECTIONS`):

- Models: `EMBEDDING_MODEL`, `LLM_MODEL`, `SMALL_LLM`, `RERANKING_MODEL`,
  `AI_PROVIDER`, `EMBEDDING_DIMENSIONS` (auto-set when the embedding model changes —
  from `EMBEDDING_DIMENSIONS` map).
- URLs: `BASE_URL`, `CONTACT_US_URL`, `LOCATIONS_URL`, `SERVICES_URL`.
- Strings: `CONSULTANT_NAME`, `COMPANY_NAME`; `SYSTEM_PROMPT` (uses `{{VARIABLE}}`
  templating resolved by `config/prompts.js`).
- Guardrails: `GUARDRAIL_PROMPT` (extra system-message text), `BLOCKED_TOPICS`
  (newline-separated banned phrases → refused up-front, see §9).
- Resources: `VECTOR_INDEX`, `R2_BUCKET_NAME`.
- Assistant: `ASSISTANT_KEY` (selected gateway assistant → persona overrides).
- Credentials (encrypted): `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_TOKEN_VALUE`,
  `R2_JURISDICTION_END_POINT`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`,
  `NEO4J_DATABASE`.
- Secret: `API_KEY` (per-company ask key).

**Encryption:** `config/encryption.js` AES-256-GCM (`gcm:` blobs) with
`config/codec.js` shared by both backends; plaintext exists in memory only. Legacy
plaintext passes through and gets encrypted on next save. Unset `APP_ENCRYPTION_KEY` →
plaintext with boot warning. `resolveCreds(companyName)` (`config/creds.js`) reads only
the company's stored config (no env fallback) and throws `Company 'x' not found` for
unknown names; `client.js` returns per-company cached CF/S3 clients.

**Validation** (`config/validation.js`): company and resource names must match
`/^[a-z0-9-]+$/`, 3–63 chars; models validated against `ALLOWED_MODELS`.

**Gateway → RAG credential sync** (`mysql/services/rag-sync.js`): saving a connection on
the Providers page mirrors `api_token`/`account_id`/`access_key_id`/
`secret_access_key` → `CLOUDFLARE_*`/`R2_*` keys, and for `neo4j` connections
`uri`/`username`/`password` → `NEO4J_*`; graph `database_name` resource →
`NEO4J_DATABASE`. Deletes clear only keys no other connection still provides;
`backfillRagCredentials` recomputes everything.

---

## 9. The ask pipeline (RAG query path)

All under `query/`. `query/index.js` re-exports `askQuestion` / `askQuestionStream`
from `answer.js`, which shares one orchestrator `runPipeline` for both JSON and SSE.

Canonical order (injectable step fns for tests):

```
intent fast-path (intent.js)
  → assistant resolve (assistant.js)  [selected ASSISTANT_KEY persona + guardrails]
  → assistant blocked-topic check     [refuse before any AI work]
  → model-access gate (credential_model_access)
  → followup rewrite (llm.js, SMALL_LLM)  [only when history non-empty]
  → cache lookup (cache.js, keyed by company + question + assistant + retrieval
    binding {embeddingModel, vectorIndex, llmModel})
  → Custom Q&A match (kb.qa rows) → direct answer
  → retrieveContext (retrieval.js): embed question → vectorQuery top 10 →
    score filter (≥75% of top & ≥0.5 abs) → hybrid (85% vector + 15% keyword)
    → dedupe → rerank (>3 matches, RERANKING_MODEL) → top 5 → fetch chunk JSON
    from R2 (metadata.r2_key) → context (≤4000 chars, [Source N])
  → retrieveGraphContext (graph.js, optional Neo4j; see §14)
  → system message + history (last MAX_HISTORY=6) + context user message
  → LLM call (LLM_MODEL, temperature, max_tokens, optional tools)
  → answer + sources + matches + graph
  → possibleQuestions (llm.js generatePossibleQuestions)
```

Key modules:

- **`query/intent.js`** — regex fast path: greetings, identity, contact, discovery,
  office, help, blocked (poems/jokes/code) and vague queries → canned `buildResponses()`
  without touching RAG (English-only vague detection). `matchesBlockedTopics` powers
  company + assistant-level topic refusal.
- **`query/llm.js`** — model getters, `rewriteFollowup` (returns `INVALID` → original),
  `generatePossibleQuestions` (on-topic filter + blocked-topic aware), `MAX_HISTORY = 6`.
- **`query/cache.js`** — in-memory Map, MD5 of `company:rewrittenQuestion`, 60-min TTL,
  max 200 FIFO entries, per-company tagging (`clearCompanyCache` via `/ask/reset`),
  retrieval-binding-aware keys (ADR-012).
- **`query/assistant.js`** — resolves the selected assistant into overrides: system
  prompt, guardrail prompt, blocked topics, variables, model (only `@cf/*` /
  `@cloudflare/*` runnable), temperature/max_tokens, primary KB → `vectorIndex` +
  `embeddingModel`, graph resource → database override + `enableGraph` gate, tools.
  Best-effort: any failure → `null` and company defaults apply. Also `checkModelAccess`
  (credential model grant gate). MySQL imports are lazy so tests run zero-dep.
- **`query/answer.js`** — orchestration, usage logging (best-effort to
  `credential_usage_logs`, incl. cost estimate), abort handling (`AbortError`),
  suggestions generation after each answer.
- **`query/context.js`** — `sanitizeText` strips prompt-injection phrases; message build.
- **`query/stream-contract.js`** — the SSE wire contract + `createSseParser` +
  `createStreamTransport` (abort owner: external signal + unref'd timeout → one signal).
- **`query/cli.js`** — REPL (`node query/cli.js`) — pipeline has no readline/dotenv dep.
- **`query/suggestions.js`** — per-company empty-state starter questions
  (`GET /ask/suggestions`): seed retrieval of the KB's top chunks → SMALL_LLM returns
  3–4 natural questions; 10s/12s timeouts; `[]` → client falls back to statics.
- **`query/graph.js`** — GraphRAG read path (see §14).

**Custom Q&A** (in `runPipeline` via `checkCustomQa`): if the question matches a KB
custom Q&A entry, return its answer immediately (sources `[{ title: "Custom Q&A",
score: 1 }]`, `customQa: true`), skipping the LLM. Best-effort — DB errors = no match.

---

## 10. Ask HTTP & SSE contracts

Owned by `routes/ask.js` (`createAskRouter()` injectable pipeline for tests).

**Common gate chain** (all ask routes): `requireCompany` (400 if `x-company-name`
missing/unknown) → `requireAskApiKey` (when company has `API_KEY`) → `aiLimiter`
(20/min) except `/ask/reset`.

**POST `/ask`** — JSON body `{ question, history?: [{role, content}], assistantKey? }`.
Returns `{ success, answer, sources?, matches?, graph?, cached?, possibleQuestions?,
error? }`. Accepts an `assistantKey` per-request override (company `ASSISTANT_KEY`
swapped for the call and restored after). Aborts the paid call on client disconnect
(`req.on("close")`).

**POST `/ask-stream`** — SSE. Wire format (see `query/stream-contract.js`), matching
`web/src/ask-stream-contract.js`:

```
data: {"token":"..."}                     — streamed token
data: {"token":"__START_RESPONSE__"}       — legacy sentinel (kept for back-compat)
data: {"__start":true,"sources":[...],"matches":[...],"graph":{...}}   — structured start
data: {"sources":[...]}                    — legacy standalone sources frame
data: {"possibleQuestions":[...]}          — follow-up suggestions (end of answer)
data: {"error":"..."}                      — error frame
data: [DONE]                               — terminator
```

30s stream timeout, `AbortSignal.any` abort on client close, `X-Accel-Buffering: no`,
`flushHeaders`. `transport.sendStart({ __start:false })` + error frames for validation
failures. Suggestion generation runs after the answer (skipped when aborted).

**GET `/ask/suggestions`** — `{ questions: string[] }` (per-company, generated).

**POST `/ask/reset`** — `{ cleared }` — purges one company's in-memory cache.

**`POST /test`** (admin) — SSE smoke test that runs a **real billable** Cloudflare AI
call (`scripts/streamTest.js`), framing raw tokens + `event: done`.

**Public assistant endpoints** — `GET /gateway/public/assistants`,
`GET /gateway/public/assistants/:key`, `POST .../:key/ask`, `POST .../:key/stream`
(published assistants only). The stream endpoint temporarily sets the company's
`ASSISTANT_KEY` and restores it after — the standard pipeline (incl. cache) applies.

---

## 11. Assistants (persona layer + guardrails)

**Gateway model** (`mysql/repositories/assistant.js` + `assistant-service.js`): tenant
assistant rows with `assistant_key` (identity, immutable), name/description, bound
`credential_id` (required, must belong to company) + optional `model_id` (must belong to
the credential's provider), `primary_kb_id` + `kb_ids` (company-owned), `system_prompt`,
`temperature` (0–2), `max_tokens`, `enable_function_calling`, `enable_streaming`,
`tools` (JSON), `variables` (`[{key,value}]`, migration 013), `enable_graph_context` +
`graph_resource_id`, `is_active`, `is_public`, and **guardrails**
(`guardrail_prompt`, `blocked_topics` — one per line, ≤100 topics / ≤8000 chars).

**Guardrail precedence at ask time** (`query/assistant.js` + `answer.js`):

1. Assistant `blocked_topics` checked first (before retrieval/LLM) → canned blocked reply.
2. Assistant `guardrail_prompt` appended to the system message (it wins over company
   `GUARDRAIL_PROMPT`); empty → company guardrail → built-in default.
3. Company `BLOCKED_TOPICS` + built-in patterns already handled by intent fast-path;
   follow-up suggestions never reintroduce blocked topics.

**CRUD routes** (`mysql/routes/assistants.js`) — all behind `requireGatewayCompany`:

- `GET/POST /gateway/assistants`, `GET/PUT/DELETE /gateway/assistants/:key`
  (delete = soft delete; capacity gate `max_assistants`; audit logged).
- `POST /gateway/assistants/:key/test` — runs a question through the real pipeline with
  the assistant temporarily selected.
- `POST /gateway/assistants/:key/duplicate` — clone under a new key/name.
- `POST /gateway/assistants/:key/publish|unpublish` — toggle `is_public`.

The Config/Settings page exposes `ASSISTANT_KEY` (validated `[a-z0-9-]` 3–63) so a
company's ask path uses the selected assistant persona.

---

## 12. Knowledge bases (gateway layer)

**Model** (`kb-service.js` + `kb.js` repo + migrations 014–019): `knowledge_bases`
rows with `kb_key` (identity), `kb_name`, description, bindings (`vector_resource_id`,
`storage_resource_id`, `graph_resource_id`, `embedding_model_id` → denormalized
`embedding_model_provider`), chunking (`chunk_size`, `chunk_overlap`), retrieval
(`retrieval_top_k`, `retrieval_score_threshold`), `enable_graph_rag`,
`enable_hybrid_search`, `source_type` (`wordpress` | `file` | `url` | `custom` … from
`shared/catalog-enums.js`), `source_config` JSON (scope/doc-limit/selected pages/sitemap
URLs), webhook delivery config (`webhook_url`, `webhook_secret`, `webhook_events`
comma/JSON), status (`active` | `indexing` | `error` …), ingestion stats, and custom
Q&A child rows.

**Endpoints** (`mysql/routes/kbs.js`) — `requireGatewayCompany`:

```
GET  /gateway/kbs                      list (paginated)
POST /gateway/kbs                      create (validates, capacity + ownership)
GET  /gateway/kbs/options              create/edit options in one round trip
                                       (registry rows + live Cloudflare resources)
GET  /gateway/kbs/:key                 detail
PUT  /gateway/kbs/:key                 update (kbKey immutable, ownership re-checked,
                                       webhook secret audited as "[set]")
DELETE /gateway/kbs/:key               hard delete (row + audit only — NOT vectors/R2/graph)
DELETE /gateway/kbs/:key/graph         delete this KB's Neo4j entities (see §14)
POST /gateway/kbs/:key/ingest          start ingestion for this KB (see §13)
GET  /gateway/kbs/:key/status          KB status incl. last stats
GET  /gateway/kbs/:key/ingest-progress polling progress during a run
GET  /gateway/kbs/:key/source-pages    source page picker data
POST /gateway/kbs/:key/webhook/test    fire a test ingestion webhook
GET/POST /gateway/kbs/:key/documents   list / upload files (FormData, XHR w/ progress)
DELETE /gateway/kbs/:key/documents     remove uploaded files
GET/POST /gateway/kbs/:key/qa          custom Q&A list / add
PUT/DELETE /gateway/kbs/:key/qa/:entryId     update / delete a Q&A entry
POST /gateway/kbs/:key/qa/match        match a question against Q&A entries
POST /gateway/kbs/export | /kbs/import JSON bulk export/import (re-created rows)
```

Validation covers keys (`/^[a-z0-9-]+$/`, 3–63), ownership of vector/storage/graph
resources and embedding model, chunk/top-k/threshold bounds. Save/update/delete always
audit.

---

## 13. Ingestion pipeline

**Entry points:** legacy `POST /cloudflare/job/start` (`cron/routes`) with
`{jobId:"ingest", companyName, kbKey}` and the gateway route
`POST /gateway/ingest/start` (`mysql/routes/ingestion.js` — duplicate guard, audit) →
both call `startJob("ingest", companyName, {kbKey, scope})` → `ingest.js main()`, run in
the background job lifecycle. Status via `GET /gateway/ingest/status/:company`,
cancel via `DELETE /gateway/ingest/cancel/:company`.

**`ingest.js` (composition root)** decides the path:

- **KB path** (`kbKey`): validates company + KB, sets status `indexing`, resolves
  provider-agnostic adapters from KB bindings (`resolveKbAdapters`), requires storage +
  vector adapters, `r2Prefix = kb/<kbKey>`, chunk options from the KB row, per-KB
  ingestion registry, KB webhook config, and the source adapter matching
  `kb.source_type` (`file`/`url`/`wordpress`).
- **Legacy path** (no `kbKey`): company-level `VECTOR_INDEX`/`R2_BUCKET_NAME` config.

**Optional graph extraction:** when `kb.enable_graph_rag` and Neo4j config exists,
`createGraphExtractor` + an LLM entity extractor run during ingestion (§14).

**`ingest/pipeline.js` (pure run loop):** fetch (source adapter) → clean HTML→Markdown
(`utils/cleaner.js`, turndown) → `chunkMarkdown` (`utils/chunker.js`) → enforce chunk
size (≤1000 chars) → drop <40 chars → save local `content/` cache →
`store.uploadChunk(r2Key, payload)` (R2 `kb/<kbKey>/.../chunk-N.json`) →
`index.upsert(chunks)` (embed + batch upsert ≤100) → registry record. Scope supports
`all`, `limit` (doc count), and `selected` pages. Vector IDs are deterministic
`sha256(r2Prefix/pageSlug)[:48]-<index>` (F14 keeps KB vector ids unique). Abort signal
checked at every boundary; retries never retry `AbortError`; concurrency via `p-limit`.

**Registry** (`ingest/registry.js`): `processed-<company>.json` at repo root (gitignored
except one committed fixture). Deleting a registry forces a full re-ingest.

**Status/stats/webhooks:** on success KB → `active`, stats persisted, audit
`kb.ingest.completed`, then `fireIngestionWebhook` (async, §19). On failure KB → `error`
+ stored error + audit `kb.ingest.failed` + failure webhook. Aborts leave status as-is.

**Source adapters** (`ingest/sources/`): WordPress REST (`services/wp.js`, paginated
`per_page=100` via `X-WP-TotalPages`, 300ms delay), URL/sitemap crawling, and file
uploads (`multer`, `pdf-parse`, `mammoth`, `cheerio`).

---

## 14. GraphRAG & Neo4j

**Config resolution:** the company's config store holds `NEO4J_URI`/`NEO4J_USERNAME`/
`NEO4J_PASSWORD`/`NEO4J_DATABASE` (mirrored from gateway neo4j connections +
`graph_database` resources via rag-sync). A selected assistant's `graph_resource_id`
database overrides `NEO4J_DATABASE`; assistant `enable_graph_context` gates the step.

**Write side (ingestion)** — `ingest/graph-extract.js`:

- LLM reads content chunks (cap `EXTRACTION_MAX_CHUNKS`, default 50) and extracts
  entities + relationships as JSON.
- `MERGE (e:Entity {id})` for nodes where `id` is a deterministic stable id scoped to `(company, kb, canonical_name)` — same name inside a KB always resolves to the same node; different KBs/companies never collide (`knowledge/graph-schema.js stableEntityId`).
- Edges are written as **real typed relationships** (`[:USES]`, `[:PART_OF]`, …) from a **hard allowlist** (`RELATIONSHIP_TYPES` in `knowledge/graph-schema.js`); the LLM can never inject a raw type string. Every node and edge carries provenance: `kb_key`, `company`, `source_title/source_url/chunk_id`, `confidence`, `extracted_by`, `created_at/updated_at`.
- `MERGE` makes re-runs idempotent (per-KB canonical nodes + typed edges). A best-effort `ensureGraphSchema` creates the unique `Entity.id` constraint and KB lookup indexes at ingest time.
- **One-time migration** for data written by the old extractor (`scripts/migrate-graph-relationship-types.js`): rewrites every `[r:RELATES_TO {type}]` edge into a real typed edge (kb-scoped so tenants never glue together) and merges duplicate per-KB entities with the same canonical name (moves relationships with their real type preserved). Run with `--dry-run` first. Existing `Entity` nodes written before the migration still merge by `(name, type)` and carry `kb_key` only as a property.

**Read side (ask)** — `query/graph.js` `retrieveGraphContext` (Phase 4,
knowledge-aware with Cypher fallback):

1. **Knowledge path (primary)**: `detectEntityMentions` — fixed template query
   scoped to the company (optionally one `kbKey`): entities whose name/alias is
   contained in the question, word-boundary filtered in JS (`"ISO"` never
   matches `"isolation"`), most-specific (longest name) first, max 5.
2. `fetchEntityNeighborhood` — per entity, in one READ session: typed edges
   (both directions, `coalesce(r.confidence,0) >= 0.5`) and **accepted** claims
   (`c.status = 'accepted'`, confidence >= 0.5) with their evidence refs.
3. `formatGraphKnowledge` (pure, deterministic): merges edges + claims per
   entity, dedupes the same (predicate, direction, other) keeping the
   higher-confidence representation while **merging evidence** (the claim's
   citation trail survives even when the edge scored higher), sorts by
   confidence, respects the 2500-char budget. Output:
   `[Graph Knowledge]\n- Entity (Type)\n    → PRED other (0.92) — evidence`.
4. Returns `{ context, method: "knowledge", entities: [...] }` (`cypher:
   null`) — the frontend's "Graph Knowledge" sources panel still renders it.
5. **Cypher fallback** (structural questions — aggregates, counts, "what
   exists"): fetch schema → LLM `generateCypher` → `isSafeCypher` (must start
   `MATCH`/`OPTIONAL MATCH`/`UNWIND`; rejects
   `CREATE/MERGE/DELETE/SET/REMOVE/DROP/FOREACH/CALL/LOAD CSV` and
   multi-statements) → run in a READ transaction, capped rows/chars. Returns
   `{ context, cypher, method: "cypher" }`; sources frames include
   `Knowledge Graph: <cypher>`.
6. All queries are fixed templates or sanitized — nothing LLM-supplied is
   interpolated; every query is company-scoped (tenant isolation enforced by
   the query shape). Best-effort — any failure yields no graph context, never
   an ask error.

**Manual cleanup:** `DELETE /gateway/kbs/:key/graph` → `clearKbGraph(kb-service.js)`
resolves the same `getGraphConfig` connection, counts then
`MATCH (e:Entity) WHERE e.kb_key = $kbKey DETACH DELETE e` (WRITE session), with 20s
query / 10s close timeouts; reports `{ configured, graphReachable, nodesDeleted,
relationshipsDeleted }`; the KB row/vectors/R2 are untouched. UI button on KB detail →
Configuration → "Delete graph data". Nothing else in the app deletes graph data
automatically.

### Knowledge layer (`knowledge/`) — AI-managed knowledge (Phases 1–2)

A service boundary between LLM output and Neo4j writes — "AI decides, code executes".
The LLM never touches Neo4j directly; every write flows through validation.

- `knowledge/graph-schema.js` — shared constants: `RELATIONSHIP_TYPES` write
  allowlist, `ENTITY_TYPES`, `stableEntityId(company, kb, name)` (per-KB canonical
  node id — type is deliberately *not* part of identity), `normalizeRelationshipType`
  (lenient → `RELATED_TO`) and `strictRelationshipType` (allowlist + legacy
  `RELATES_TO` only, used by claim validation).
- `knowledge/validation.js` — pure rules: `CLAIM_STATUSES` lifecycle
  (candidate → accepted/rejected/conflicting/deprecated/needs_review),
  `confidenceToStatus` (≥0.90 accept, 0.70–0.90 candidate, <0.70 reject),
  `validateClaim` (shape + strict predicate), `classifyClaimPair`/`assessClaimLifecycle`
  (duplicate vs conflict — conflicts flag both sides for review, never silently
  overwrite), `canCommitMutation` mutation policy (trusted actors `admin`/`api`/
  `migration` may commit; AI actors propose → candidate).
- `knowledge/provenance.js` — `buildProvenance` (every node/edge/claim carries
  `company`, `kb_key`, actor, confidence, evidence refs, timestamps),
  `normalizeEvidence` (document/chunk refs → `{ type: "doc", id, title, url }`),
  `evidenceRefs`, `knowledgeScore` (model confidence + evidence count − contradiction).
- `knowledge/neo4j.js` — `withKnowledgeSession`/`runQuery` helpers (READ vs WRITE
  sessions, tenant-scoped params).
- Entity service (`entity-service.js`) — `resolveEntity` (id → exact name → alias →
  auto-create), `createEntity`, `listEntities`, `getEntity`, `updateEntity`,
  `mergeEntities(keepId, dropId)` (moves relationships, aliases, claims to the
  survivor), `addAlias` (canonical-entity aliasing, proposal §8).
- Relationship service (`relationship-service.js`) — `createRelationship` (typed
  edge from the allowlist, auto-creates missing endpoints), `listRelationships`,
  `removeRelationship`.
- Claim service (`claim-service.js`) — claims stored as `(:Claim)` nodes wired to
  their endpoints via fixed `[:SUBJECT_OF]`/`[:OBJECT_OF]` edges (no LLM-chosen edge
  types); `createClaim` runs the full flow (validate → resolve entities →
  conflict/duplicate detection → derive status from confidence + actor policy →
  persist), `listClaims`, `updateClaimStatus` (accept/reject/deprecate/review),
  `findConflicts`. Every query is scoped by `company` **and** `kb_key`.
- `knowledge/knowledge-service.js` + `knowledge/index.js` — the facade/barrel every
  caller imports (per-company `getGraphConfig` → short-lived session per call).
- `config/graph.js` — graph config resolution extracted out of `query/graph.js`
  (which re-exports it for back-compat) so the knowledge layer never imports the
  query pipeline (avoids a circular dependency when retrieval consumes knowledge).
- **REST boundary** — `mysql/routes/knowledge.js` (13 routes under
  `/gateway/knowledge`, `requireGatewayCompany` + `requireKb` scoping, admin-actor
  writes, best-effort audit logs): entity CRUD + merge, relationship create/list/
  delete, claim propose/list/status, `/conflicts`, `/review`.

**Phase 3 — ingestion extraction routes through this boundary**
(`ingest/graph-extract.js`): chunk → LLM extraction (`entities` +
`relationships` + per-relationship `confidence`) → `toProposals()` normalization
(allowlist types; unknown non-blank types fall back to `RELATED_TO` so knowledge
is never dropped; blanks/self-loops/empty endpoints counted as skipped) →
`createEntity` (canonical nodes, provenance incl. confidence) →
`createRelationship` (endpoint resolution + auto-create, duplicate/conflict
detection, typed allowlist edge, chunk evidence) → `createClaim` (first-class
claim lifecycle: fresh triples accepted — the import pipeline is the tenant's own
content — with contradiction triage demoting both sides to `conflicting`).
Relationships/claims below the 0.5 confidence floor are dropped (never reach the
graph). Every write carries chunk evidence (`{chunkId, title, url}`).

**Conflict semantics** are predicate-gated: only single-valued relationship
types (`SINGULAR_RELATIONSHIP_TYPES` = `SUPERSEDES`, `OWNED_BY`) treat a
different object as a genuine contradiction. Multi-valued predicates
(`USES`, `PROVIDES`, …) legitimately point at many objects, so a different
object is a separate parallel fact — otherwise normal ingestion ("X CERTIFIES
Y" and "X CERTIFIES Z") would self-demote into a noisy conflict stream.

Phase 4 makes `query/graph.js` retrieval consume entities / claims / evidence
instead of raw generated Cypher.

**Phase 5 — internal AI knowledge tools** (`knowledge/tools.js`):

- 12 function-calling definitions (OpenAI/Workers AI shape) exported as
  `KNOWLEDGE_TOOLS` + `TOOL_NAMES`: read tools `search_knowledge`,
  `get_entity`, `get_entity_relationships`, `find_related_entities`,
  `get_claims`, `get_evidence`, `validate_claim`, `find_conflicts`,
  `find_duplicates`; write tools `propose_entity`, `propose_relationship`,
  `propose_claim`.
- `executeKnowledgeTool(toolName, args, { companyName, kbKey, actor,
  policyAllow })` — one short-lived READ/WRITE session per call; fixed
  templates only (nothing LLM-supplied is interpolated).
- Policy (proposal §20): read tools are automatic for tenant actors; write
  tools require a trusted actor (`admin`/`api`/`migration`) or `policyAllow`
  to commit — an AI/LLM actor degrades to **propose** (writes a `candidate`
  claim into the review queue, never a direct graph write). `validateToolArgs`
  + `resolveToolPolicy` are pure and unit-tested; claim predicates pass
  through `strictRelationshipType`.
- REST seam: `POST /gateway/knowledge/kbs/:kbKey/tools/execute`
  (`{ tool, args }`, admin actor → trusted commits, best-effort audit).

**Phase 6 — admin Knowledge UI**: KB detail (`#ingestion/kbs/:key`) gained a
**Knowledge Graph** tab (`web/src/pages/kb-knowledge/KnowledgeGraphTab.jsx`)
with Overview stat cards (entities / relationships / claims / review /
conflicts), Entities (search + row-click detail modal with relationships),
Relationships, Claims (status badges + evidence), a **Review queue**
(candidate claims with Accept/Reject → `PUT …/claims/:id/status`) and a
**Conflicts** tab (resolve/reject contradictory claims). The tab owns
"Delete graph data" (moved out of Configuration to avoid a duplicate
destructive control). Empty states explain what to do (enable Graph RAG on
the KB + re-ingest). Data via `web/src/api.js` `listKnowledge*` /
`updateKnowledgeClaimStatus` / `mergeKnowledgeEntities` /
`executeKnowledgeTool` helpers.

**Phase 7 — MCP server adapter** (`mcp/`): exposes the knowledge layer to
external AI clients over the MCP **stdio** transport (newline-delimited
JSON-RPC 2.0). MCP is a pure **adapter** — `tools/call` delegates straight to
`executeKnowledgeTool()` (Phase 5), the same boundary the REST routes and the
portal use; no Cypher/tenant/policy logic lives in `mcp/`. Zero new
dependencies (hand-rolled minimal server: `initialize`, `ping`,
`tools/list`, `tools/call`). `mcp/index.js` (`npm run mcp`) wires
stdin/stdout and redirects ALL stray `console.log` to stderr so the protocol
stream stays pure JSON; `initConfig()` runs at boot so the config store is
populated. Context: company/KB come from tool args (`company`/`kbKey`) or
`MCP_COMPANY`/`MCP_KB_KEY` env; the default actor is `{type:"ai"}` → write
tools **propose** (candidate claims → review queue), `MCP_TRUSTED=true`
switches to a trusted `api` actor that commits. stdio only — never expose it
on a network socket. Tests: `mcp/__tests__/mcp-server.test.js` (17, pure core
with injected executor) + an end-to-end handshake smoke test.

---

## 15. Scheduler, cron & jobs

Two execution modes share one lifecycle machine (`cron/lifecycle.js`,
`cron/index.js` barrel):

- **Standalone jobs:** run immediately in the background, tracked in `standaloneJobs`
  Map keyed `jobId:company:kb`, up to `MAX_CONCURRENT_JOBS` (6), abortable, entry
  deleted on completion.
- **Cron schedulers:** `node-cron`, same guards/keying/skips overlapping ticks
  (`cronSchedulers`).

**Job registry** (`jobs.js`): `testing` (a smoke run) and `ingest`
(→ `ingest.js main`). Handlers receive `{ signal, companyName, kbKey }`.

Routes (`routes/cron.js`, mounted under `/cloudflare` behind `requireAdmin`, no limiter):

```
GET  /cloudflare/presets              list presets (SQLite db/presets/app.db, 4 seeded)
POST /cloudflare/presets              create { name, schedule } (cron validated)
PUT/DELETE /cloudflare/presets/:id    update / delete
POST /cloudflare/job/start            { jobId, companyName?, kbKey? }
POST /cloudflare/job/stop             stop a standalone job
GET  /cloudflare/jobs/running         running standalone jobs
POST /cloudflare/cron/start           { jobId, schedule, companyName? }
POST /cloudflare/cron/stop            stop a scheduler
GET  /cloudflare/jobs                 registered job types
GET  /cloudflare/status               status: { standalone:[], cron:[], presets }
```

Gateway-level ingestion job endpoints: `/gateway/ingest/jobs|start|status/:company|
cancel/:company` (see §13). Workflow schedules have their own runner-level cron
(§18).

---

## 16. MySQL gateway layer

Optional but the de-facto platform. Mounted at `/gateway` behind `requireAdmin`; when
MySQL env is absent, boot succeeds and every `/gateway/*` route 503s (`mysql/pool.js` is
lazy — no connection at import). Layering (Clean Architecture):

```
routes/  (Express per resource group; composition in routes/index.js, barrel re-export)
  → services/  (validation + write orchestration; providers, credentials, KB, assistant,
     workflows, notifications, rag-sync, catalog, cost, cost-alerts, onboarding,
     provider-registry, provider-executor, provider-model-fetcher, company-scope,
     workflow-runner/-events/-purge)
  → repositories/ (all SQL; one file per entity; barrel re-export)
  → MySQL 8
```

**Company scoping:** `requireGatewayCompany` (`company-scope.js`) resolves the company
from the `x-company-name` header and attaches `req.company`; all queries filter by
`company_id`. `gate` middleware requires a configured DB.

**Route inventory** (all under `/gateway` unless noted):

| Group | Routes |
|---|---|
| Health | `GET /gateway/health` |
| Providers | `GET/POST /providers`, `GET/PUT/DELETE /providers/:key` (+`?force`), `GET /providers/:key/auth-form`, `GET /providers/:key/resources`, `GET/POST /providers/:key/models`, `POST /providers/:key/models/fetch`, `PUT/DELETE /providers/:key/models/:id`, `POST /providers/import` (catalog JSON, `replaceChildren` delete semantics), `POST /providers/:key/test` |
| Companies | `GET/POST /companies`, `GET/PUT/DELETE /companies/:key`, `GET /companies/:key/audit`, `POST/PUT/DELETE /companies/:key/environments[/:envKey]`, `GET /companies/:key/resources` |
| Resources | `POST /companies/:key/resources`, `PUT/DELETE /resources/:id` |
| Cloudflare live resources | `GET/POST /companies/:key/cloudflare/resources/:type`, `DELETE …/:type/:id` (Vectorize index, R2 bucket, D1 etc. provisioning) |
| Credentials | `GET/POST /companies/:key/credentials`, `PUT/DELETE /credentials/:id`, `POST /credentials/:id/verify` (live probe), `POST /credentials/:id/rotate`, `POST /credentials/:id/models` (grant), `POST /credentials/model-access/bulk`, `POST /credentials/test-batch`, `POST /companies/:key/connections/test` |
| Endpoints | `GET/POST /endpoints`, `PUT/DELETE /endpoints/:id` |
| Pricing | `GET/POST /pricing`, `PUT/DELETE /pricing/:id` |
| Execute | `POST /companies/:key/execute/chat`, `POST /companies/:key/execute/embeddings` (live provider call through stored credentials; OpenAI-style shape) |
| KBs | see §12 |
| Assistants | see §11 |
| Ingestion | `GET /ingest/jobs`, `POST /ingest/start`, `GET /ingest/status/:company`, `DELETE /ingest/cancel/:company` |
| Usage | `GET /usage`, `GET /usage/summary`, `GET /usage/top?type=model\|kb`, `GET /usage/recent`, `GET/PUT /usage/alerts` |
| Workflows | see §18 |
| Bulk | `POST /bulk/delete`, `POST /bulk/export`, `POST /bulk/import` (entities `kbs`/`assistants`, ≤50/batch, audit each) |
| Webhooks | see §19 |
| Public | `/gateway/public/assistants…` (see §10, no admin guard) |

**Credentials service** (`credential-service.js`): values individually encrypted
AES-256-GCM (`gcm:` blobs in a JSON `encrypted_credentials` cell), format validation
driven by `provider_auth_schemas`, decrypt only in memory, never in API responses;
verify runs live provider probes (`routes/probes.js` — Cloudflare token verify today);
rotate re-encrypts.

**Catalog** (`provider-registry.js`): in-memory cached registry of providers + auth
forms + resource templates + models, `invalidateRegistry()` after catalog writes.

**Model access:** `credential_model_access` grants which models a credential may run;
`checkModelAccess` enforces at ask time for assistant-bound credentials.

**Onboarding service** (`onboarding.js`): `needsOnboarding(companyId)` and
`onboardCompany(company)` — when a company has zero KBs/assistants, create a default KB
(`<company>-default`, built from company config) + default assistant, idempotently.

---

## 17. MySQL schema & migrations

`schema/v5.sql` is the frozen reference (never edit); `migrations/` apply incrementally
(`node mysql/migrate.js`, runner honors `DELIMITER`, tracks `schema_migrations` with
SHA-256 checksums — editing an applied migration fails loudly; `MIGRATIONS_DIR` env
override). Migrations: `001_init` (tables/views/procedures), `002_company_config`,
`003_platform_seed`, `004–010` catalog seeding, `011` provider round-robin thinking,
`012` docs URLs, `013_assistant_variables`, `014_ingestion_stats`, `015_kb_source_type`,
`016_kb_source_config`, `017_kb_webhooks`, `018_workflow_runs`, `019_kb_custom_qa`,
`020_webhook_notifications`, `021_assistant_guardrails`.

Tables (22, from the migration files):

```
companies, company_config, company_environments
providers, provider_models, provider_endpoints, provider_auth_schemas,
provider_capabilities, provider_resource_types, provider_resources,
provider_model_pricing, credentials, credential_model_access, credential_usage_logs
knowledge_bases, assistants, chatbots, agent_workflows, workflow_runs
audit_logs, webhook_notifications, webhook_delivery_logs
```

Views used at runtime include `v_model_pricing_current` (effective pricing) and the
credentials view fix (005). Many entities carry `deleted_at` (soft-delete columns exist
everywhere) but most gateway deletes are hard deletes today. No seed data is applied by
default (per design); catalog is populated by the seeding migrations or the catalog
importer wizard.

---

## 18. Workflows

**Definition model** (`mysql/services/workflow-service.js`, repo `agent_workflows`):
`workflow_key` (identity, `/^[a-z0-9-]+$/`, 3–63), name, description, `definition`
(`{ steps: [...] }`), `primary_assistant_id`, `trigger_type`
(`manual | webhook | schedule | event`), `trigger_config` (webhook secret / cron),
`status` (`draft | active | paused`), `is_active`.

**Step types** (runner `workflow-runner.js`):
`assistant` (ask through the company pipeline w/ `{{stepN.output}}` interpolation),
`http` (fetch with headers/body interpolation), `ingest` (starts the background ingest
job — `startJob("ingest", …)`), `notify` (best-effort channel log), `delay` (abortable
sleep, ≤5 min), `condition` (basic `stepN.output op value` evaluation), `loop` (child
steps × N, ≤10).

**Runner semantics:** unique `runId` (`run_<ts>_<n>`), per-step status
(`pending|running|completed|failed|skipped`), per-step retry (`maxAttempts` +
`delayMs`), abort controller combined with external signals, run state kept 5 minutes in
`activeRuns`, then persisted best-effort to `workflow_runs` (migration 018) at
completion/failure. Abort via `abortWorkflow(runId)`.

**Schedules:** `scheduleWorkflow` registers a `node-cron` task (key
`workflowKey:company`); unschedule/list at runtime. **Purge scheduler** at boot runs
daily 3 AM removing runs older than 30 days (`workflow-run-purge.js`).

**Routes** (`mysql/routes/workflows.js`, behind `requireGatewayCompany`):

```
GET/POST /gateway/workflows
GET/PUT/DELETE /gateway/workflows/:key        (delete = soft)
POST /gateway/workflows/:key/run              manual run
POST /gateway/workflows/:key/abort            { runId }
GET  /gateway/workflows/:key/runs             persisted + active runs
POST /gateway/workflows/:key/activate|pause
POST /gateway/workflows/:key/schedule         { cron }
POST /gateway/workflows/:key/unschedule
GET  /gateway/workflows/schedules
POST /gateway/workflows/:key/webhook-token    regenerate HMAC secret
```

**Public webhook triggers** (`routes/workflow-triggers.js`, mounted at `/webhooks`, no
admin auth): `POST /webhooks/:companyKey/:workflowKey` requires `x-company-name`, the
workflow must be `trigger_type: "webhook"`, and when a `webhook_secret` exists the
`Authorization: Bearer <hmac>` header must verify (`timingSafeEqual` against
HMAC-SHA256 of the literal "webhook"). Returns `{ runId, status, steps, durationMs }`.
`GET` on the same path is a lightweight health check.

**Workflow events service** (`workflow-events.js`) feeds the events/notifications UI
used by the Notifications page.

---

## 19. Webhooks & notifications

Three distinct mechanisms:

1. **KB ingestion webhooks** (`ingest/webhooks.js` `fireIngestionWebhook`): configured on
   the KB (`webhook_url` + optional `webhook_secret` + `webhook_events` list such as
   `completed,failed`). Auto-detects Slack/Discord URLs and formats payloads
   accordingly; otherwise a generic JSON payload
   `{ event: "ingestion.completed|failed", kbKey, companyName, timestamp, stats, error? }`.
   Signs with `X-Webhook-Signature: sha256=<hmac>` when a secret is set. 10s timeout,
   fire-and-forget (never fails ingestion).

2. **Webhook notifications** (`webhook_notifications` + `webhook_delivery_logs`, migration
   020; routes in `mysql/routes/webhooks.js`): a full CRUD webhook manager under
   `/gateway/webhooks` — create/update (fields `url, events, secret, is_active`),
   delete, `POST /:id/test` (sends a real `webhook.test` payload, logs delivery) and
   `GET /:id/logs` (last 50 delivery attempts). Legacy `db/webhooks.json` entries are
   lifted into MySQL once at boot (`liftLegacyWebhooks`) when the table is empty.

3. **Alert notifications** (`mysql/services/notifications.js`, config in
   `db/notifications.json`): global toggle + webhook URLs + per-event flags for
   `ingestion_failed`, `workflow_failed`, `cost_threshold`. `sendNotification` posts
   JSON to each URL with a 5s timeout, best-effort. Convenience helpers:
   `notifyIngestionFailed`, `notifyWorkflowFailed`, `notifyCostThreshold`.

---

## 20. Usage, cost & alerts

- **Logging:** the ask path calls `logUsage` (best-effort) → `UsageRepository.log`
  (append-only insert into `credential_usage_logs` with action, endpoint, model,
  input/output units, duration, cost, status, client/request ids). Company/credential
  resolved from MySQL.
- **Cost:** `mysql/services/cost.js` estimates `cost_usd` from
  `v_model_pricing_current` (input/output price per million), cached 5 min,
  `clearPriceCache()` for tests.
- **Read APIs** (`UsageRepository` + `/gateway/usage*`): aggregate by
  `day|model|credential`, summary (counts, tokens, cost, P50/P95/P99 latency),
  top models or top KBs by cost, recent calls.
- **Alerts** (`cost-alerts.js`): `GET/PUT /gateway/usage/alerts` reads/writes daily &
  monthly USD thresholds; `checkCostAlerts` compares totals and can notify via the
  notification service.

---

## 21. Admin portal (web/)

React 18 + Vite 6 + Tailwind 4, hash routing, built to `web/dist` (server serves it).
Dark-first design system built from primitives under `web/src/components/ui`
(`Card, Button, Badge, StatCard, Empty, SkeletonCard, InfoTip`, form controls,
tooltip, overlay/modal, pagination, bulk-actions, layout helpers, icons).

**Routing** (`App.jsx`): lazy-loaded pages + `PageErrorBoundary` (chunk-load errors →
retry UI) + `Suspense` spinner. Hash routes may carry detail segments (e.g.
`#catalog/cloudflare`).

| Route | Page | Purpose |
|---|---|---|
| `#dashboard` | Dashboard | stat cards, system health, quick actions, workspaces table, active jobs; onboarding wizard + next-step prompts |
| `#ingestion` | Knowledge (Ingestion.jsx) | KB list w/ search + status chips, create-KB wizard; sub-route `#ingestion/kbs/:key` renders KbDetail (tabs: sources, documents, custom Q&A, configuration incl. graph delete) |
| `#assistants` | Assistants.jsx | list + create/edit modal w/ tabs (persona, KBs, guardrails), test console, duplicate |
| `#ask` | Test AI (AskConsole) | streaming chat, empty-state starter chips (`/ask/suggestions`), sources/matches/graph panels, suggested-question chips |
| `#companies` | Companies.jsx | tenant CRUD |
| `#config` | Settings (Config.jsx) | General/Models/Storage/Assistant/Guardrails/Credentials sections driven by `config/schema.js` (re-exported via `web/src/models.js` so the portal never drifts); Ask API key card (`config/AskApiKeyCard.jsx`) |
| `#cloudflare` | Cloud Services | indexes, buckets, live resources (visible when the company has creds) |
| `#catalog` / `#catalog/<key>` | AI Providers (pages/catalog/) | provider catalog, 5-step wizard, models/pricing/endpoints, credential connections, resources |
| `#scheduler` | Scheduler | Jobs & Schedules + Ingestion tabs, presets, Schedule Cron dialog |
| `#workflows` | Workflows | list + builder (trigger dropdown, step editor w/ step-type dropdown), run history |
| `#usage` | Usage | summaries, charts, top models, recent activity, cost alerts |
| `#webhooks` | Notifications (sidebar label; route id `webhooks`) | webhook CRUD (event checkboxes), test, delivery logs |
| `#logs` | Logs | tail/clear/download log files — reachable from the layout popover ("All logs") and the ⌘K palette, not the main sidebar |

Login is not a hash route: when admin auth is enabled and no valid token exists, `App.jsx` renders `LoginPage` instead of the portal regardless of the hash.

**Shared plumbing:**

- `context.jsx` `CompanyProvider` — company list + selected company persisted under
  `pc_selected_company`; every API call attaches `x-company-name`.
- `auth.jsx` + `web/src/auth.js` — token in `localStorage`, `onUnauthorized` → login.
- `api.js` — central fetch wrapper with admin auth header, per-company header, JSON
  error normalization, `askStream` SSE reader, `uploadKbDocuments` (XHR + progress),
  typed helpers for every gateway surface, fire-and-forget UI-toast logging.
- UX layer: `OnboardingWizard` (first-run guided flow), `NextStepPrompt` ("what's next"
  prompts after actions), `PageHelp`/`glossary.js` (tooltips for technical terms),
  `KeyboardShortcuts.jsx` (⌘K command palette: navigate/search), theme toggle
  (`pc_theme`; light/dark/system), Radix dropdown menu, `ScrollToTop`.
- `ask-stream-contract.js` client frame dispatch mirrors the server wire contract.
- `web/src/__tests__` — pure-ESM helper tests (card gating, error tags, ask frames).

---

## 22. Testing

Run `npm test` (equivalent of `node --test` with explicit globs per `__tests__` dir:
`config`, `query`, `cron`, `ingest`, `routes`, `mysql`, `web/src/**`). Node's built-in
runner + `node:assert/strict`, no Jest/Mocha/mock libs. Test seams:

- ask route tests inject a fake pipeline via `createAskRouter({ pipeline })`,
  `process.chdir()` to a temp dir so `db/` is isolated (each test file = own process).
- `query/__tests__/query-modules.test.js` runs with zero `node_modules` (builtins only);
  `mysql` credential tests are pure crypto; catalog-importer tests inject a fake pool
  via `opts.getPool`.
- `cron/__tests__/cron-modules.test.js` needs `npm install` (imports dotenv chain).

**Never run bare `node --test`** — default file matching recurses into `scripts/`
ad-hoc scripts named like tests (`test.js`, `test_upsert.js`, …) that need `.env` /
network / a live server and will fail. Run the `npm test` globs only, or target a single
file: `node --test mysql/__tests__/kb-service.test.js`.

Other suites: Playwright lives under `playwright/` (separate sandbox); `npm run lint`
runs the flat ESLint config (Node backend `globals.node` + React portal browser/JSX;
`scripts/` and build artifacts ignored).

---

## 23. Security notes

- **Auth** is opt-in and HMAC-signed; no passwords/keys in URLs; token accepted via
  header or the `/api-docs`-scoped cookie only. When auth is off, everything is open —
  never deploy that way with real data.
- **Credentials at rest:** AES-256-GCM blobs (`gcm:`) in both company config and
  gateway credential stores; plaintext in memory only; never echoed by GET endpoints;
  audit logs record presence, not secrets.
- **Ask API keys:** constant-time compare, per-company domain/origin enforcement for
  browsers, revocable, never returned by read APIs.
- **GraphRAG:** read-only transactions, `isSafeCypher` clause blacklist; AI writes only
  via fixed parameterized templates (never free-form write Cypher).
- **Rate limiting:** global 100/min + AI tier 20/min + login 10/min; admin exempt.
- **CORS:** dynamic allowlist (known domains + derived `<company>.com` + localhost).
- **Trust proxy:** explicit hop count recommended in production (`TRUST_PROXY`).
- **Prompt injection:** retrieved text sanitized (`context.js`), blocked topics /
  refusal patterns, no-context fallbacks, content treated as untrusted.
- **Multi-tenant isolation** enforced at the repository layer (every query scoped by
  `company_id` derived from the header, resource ownership re-checked on writes).
- Health endpoints report connectivity without leaking secrets. Error handler hides
  internals for non-`AppError` failures.

---

## 24. Operational gotchas

1. **Auth is opt-in** — set `ADMIN_USERNAME` + `ADMIN_PASSWORD` or everything is open.
2. **`ADMIN_SECRET` unset** → ephemeral secret → sessions die on every restart (warning).
3. **Blank slate:** no seeded company/tenant; create one via portal or
   `POST /cloudflare/companies`. `.env` never holds company AI config.
4. **Config loads once at boot** (runtime singleton). Live DB edits don't take effect
   until restart; API writes mutate memory + persist async (persist-first).
5. **`web/dist` must be built** or the dashboard isn't served (`hasWeb`). Rebuild after
   UI pulls and before restarting.
6. **Vector index dimensions must match `EMBEDDING_DIMENSIONS`** or upserts fail
   ("Invalid embedding detected"); changing the embedding model on a populated index
   means re-ingesting (or recreating the index).
7. **KB delete does NOT cascade** to Vectorize/R2/Neo4j — only the MySQL row + audit.
   Vectors/chunks cleanup is manual (there is no UI button for vector/R2 deletion today);
   the Neo4j graph has the per-KB "Delete graph data" button.
8. **Neo4j edges are now real relationship types** (`[:USES]`, `[:PART_OF]`, …) from an allowlist, with per-KB canonical node ids (`Entity.id` unique constraint) and provenance properties. Legacy data written before the change (all edges `RELATES_TO` with the type as a property, nodes keyed by `name+type` without `kb_key`) must be migrated once with `node scripts/migrate-graph-relationship-types.js [company] [--dry-run]`.
9. **Ingestion registry** (`processed-<company>.json`) — delete to force full re-ingest;
   per-KB registries are used in the KB path.
10. **`npm test` globs only**; bare `node --test` breaks on `scripts/*test*`.
11. **`scripts/reset.js` is broken** (calls `deleteVectorIndex`/`createVectorIndex`/
    `clearBucket` with no args — all require args).
12. **Docs drift:** older docs may still reference pre-split monolith paths and the
    removed chatbot UI / `x-api-key` admin auth claims — trust this file + code.
13. **Streaming contract:** legacy `__START_RESPONSE__` sentinel is kept for
    back-compat; new clients should rely on the structured `{"__start":true,...}` frame.
14. **Workflow `ingest` step** starts a background job (fire-and-forget) — the step
    completes once the job starts, not when ingestion finishes.
15. **`/gateway` requires MySQL configured** — otherwise every route returns 503
    (boot stays healthy).
