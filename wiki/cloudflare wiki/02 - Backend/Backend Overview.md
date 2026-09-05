---
type: backend
status: active
area: backend
tags: [backend, overview]
related:
  - "[[System Architecture]]"
  - "[[Routes Map]]"
---

# Backend Overview

## Purpose

Express 5 Node-ESM API delivering (a) visitor RAG answers, (b) admin/tenant management, (c) scheduler control, and (d) an optional MySQL AI Gateway. No separate server for the portal — it is built statically and served by this process.

## Responsibilities

| Responsibility | Owner module |
|---|---|
| Middleware chain & mounting | `app.js` |
| Ask HTTP contract (validation/SSE/abort/rate tier) | `routes/ask.js` — router composed via `createAskRouter({pipeline?})` test seam |
| RAG orchestration | `query/*` ([[Ask Pipeline]]) |
| Tenant config truth + persistence | `config/*` ([[Configuration]]) |
| Ingestion execution | `ingest.js` + `ingest/*` ([[Ingestion]]) |
| Scheduler runtime | `cron/lifecycle.js` via `cron/index.js` barrel; HTTP in `routes/cron.js` |
| Admin auth tokens | `auth.js`, routes `routes/auth.js` |
| Cloudflare/R2/AI service calls | `services/*` |
| Provider catalog platform | `mysql/*` ([[AI Gateway Platform]]) |
| Logs/audit endpoints | `routes/logs.js`, gateway audit repo |

## Entry points

- Server: `node app.js` (also `npm start`; `npm run dev` = nodemon).
- CLI REPL: `node query/cli.js` (interactive ask against one company).
- Migration runner: `node mysql/migrate.js`.
- One-off scripts under `scripts/` are dev tools only.

## Request handling pattern

Handlers stay thin: validate → resolve company via `utils/request-context.companyFromRequest` → call domain layer → shape JSON `{success:true,...}`. Domain layers throw typed errors; composition stays in `app.js`. The ask router additionally accepts a fake pipeline for route tests — the established "inject at the seam" idiom used across the codebase (`_usePoolForTests`, step overrides).

## Public interfaces beyond HTTP

- SSE wire protocol `query/stream-contract.js` (documented frame types; consumed by portal parser).
- OpenAPI spec `docs/openapi.js` served as JSON for codegen.
- Exit codes: config-init failure exits(1); listen failure exits(1).

## Where to look first when something breaks

Symptom → page: 429 storms → [[Middleware]]; tenant missing → [[Multi-Tenancy & Company Config]]; auth loops → [[Authentication Flow]]; ingest stalls → [[Background Jobs]]+[[Ingestion]]; portal blank → [[Deployment]] build requirement.