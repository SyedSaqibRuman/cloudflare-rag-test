---
type: overview
status: active
area: overview
tags: [overview]
related:
  - "[[Home]]"
  - "[[System Architecture]]"
---

# Project Overview

## What it is

The **PopularCert RAG API**: a multi-tenant, per-company Retrieval-Augmented Generation backend. Each *company* (tenant) owns isolated configuration (models, system prompt, URLs, resources, credentials); visitors of that company's site ask questions through `POST /ask` / `POST /ask-stream` and receive grounded answers built from the company's ingested content (WordPress pages/posts, uploaded documents, arbitrary URLs).

An optional **AI Gateway platform layer** (MySQL) adds a global provider catalog, per-company encrypted credentials, provisioned resources, Knowledge Bases, and Assistants. The same Node process serves:

1. The HTTP API (`/ask`, admin APIs),
2. A React **admin portal** (built into `web/dist`),
3. Swagger UI at `/api-docs`.

## Who/what uses it

- **Visitors** — via a website widget/browser calling `/ask` with the `x-company-name` header (per company API keys optional, see [[Ask API Keys]]).
- **Admins** — via the portal (login-gated when `ADMIN_USERNAME`/`ADMIN_PASSWORD` are set).
- **Developers/AI agents** — via the CLI REPL (`node query/cli.js`) and these wiki pages.

## Technology stack (verified)

| Layer | Choice |
|---|---|
| Runtime | Node ≥22.5 ESM (`node:sqlite` dependency), `"type": "module"` |
| HTTP | Express 5.2 + cors + express-rate-limit; swagger-ui-express |
| LLM/embeddings/rerank | Cloudflare Workers AI (`cloudflare` SDK v5 + raw REST for streams) |
| Vector store | Cloudflare Vectorize (SDK CRUD) |
| Object storage | Cloudflare R2 via AWS S3 SDK v3 client |
| Optional graph | Neo4j (lazy-imported `neo4j-driver`, read-only sessions) |
| Config store | SQLite per company (`db/<company>.db`) **or** MySQL (`CONFIG_STORE=mysql`) |
| Gateway platform | MySQL 8+ (`mysql2/promise` lazy pool, migration runner) |
| Background jobs | `node-cron` v4 + in-process standalone runner |
| Sources/parsing | WordPress REST, cheerio, turndown, mammoth (.docx), pdf-parse |
| Portal | React 18 + Vite 6 + Tailwind 4, hash routing, Radix dropdown |
| Tests/lint | `node:test` + `assert/strict` (663 tests pass); ESLint 10 flat config |

## Repository structure

```
app.js                 server entry (middleware order, mounts, health, SPA)
auth.js                HMAC session tokens + requireAdmin
client.js              per-company cached CF/S3 SDK clients (credential fingerprint)
env.js                 frozen env accessor (server/admin/MySQL knobs only)
config/                multi-tenant config facade: schema, sqlite/mysql stores, codec,
                       encryption, company CRUD, validation, prompts, presets
query/                 RAG pipeline: intent, llm, cache, retrieval, scoring, reranker,
                       context, prompts, graph, assistant, stream-contract, cli
ingest.js + ingest/    ingestion composition root + pure pipeline, registry, KB adapter
                       resolver, source adapters (wordpress/url/file), webhooks
services/              cloudflare_ai (AI seam), cloudflare_embeddings, vectorize, r2, wp
routes/                ask (HTTP contract), auth, cron (scheduler+presets), logs,
                       cloudflare/ (companies/config/prompt/apikey/indexes/buckets)
mysql/                 gateway platform: pool, migrate, repositories/, services/,
                       routes/, adapters/{embedding,vector,storage}
cron/                  lifecycle.js (jobs+cron machine), testing-job, barrel
shared/                errors taxonomy, error-tag, catalog-enums, patterns, status
utils/                 chunker, cleaner, helpers(retry/abort), logger, request-context,
                       request-logger, health-check
web/                   React admin portal (build → web/dist)
schema/v5.sql          frozen reference schema (never edit)
migrations/            incremental SQL (001…006), applied at boot or node mysql/migrate.js
docs/                  OpenAPI spec (openapi.js) + prose docs (some drift-prone)
wiki/                  ← this Obsidian vault
scripts/               ad-hoc dev tools (not linted/tested); never run bare `node --test`
```

## Runtime architecture (one sentence each)

- Requests enter Express middleware chain ([[Application Flow]]), are CORS-checked, JSON-parsed, request-logged, rate-limited (admins exempt), then dispatched to routers.
- Company scoping comes from `x-company-name`; creds resolve via `resolveCreds()` against an in-memory singleton loaded at boot from SQLite/MySQL ([[Configuration]]).
- Ask requests run the canonical pipeline in `query/answer.js runPipeline()` ([[Data Flow]]) backed by cached per-company SDK clients (`client.js`).
- Ingestion jobs run through job handler `{ signal, companyName, kbKey }` → adapter-resolved pipeline ([[Ingestion]]).
- Gateway writes go through repositories/services with audit logging; credentials stay encrypted at rest ([[Security Model]]).

## Important constraints

- **Node version floor:** 22.5+ (`DatabaseSync`). Verified on newer versions.
- **MySQL 8.0+ required** for the gateway (`credential_usage_logs` partitioning); MariaDB works only because `mysql/migrate.js` strips PARTITION clauses.
- **Config is loaded once at boot** into `runtimeConfig` — DB edits while running don't apply except via the API's persist-first write path.
- **Portal must be built** (`cd web && npm run build`) before the server serves the dashboard (`hasWeb` check at boot).

## External dependencies summary

Full detail: [[External Services]] · packages: [[Backend Dependencies]] [[Frontend Dependencies]].

## Project status (observed)

Working end-to-end platform; recent commits added the gateway buildout and credential mirroring. Docs under `docs/` vary in freshness — trust source first, then this wiki, then prose docs (see [[Documentation Map]]).