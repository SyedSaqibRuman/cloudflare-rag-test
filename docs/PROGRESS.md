# Progress Tracker

> Living document for cloudflare-rag-test implementation status.
> Update as work completes. Last refreshed: 2026-08-20.

---

## Legend

- ✅ Done (tested, build passes)
- 🟡 Partial / in progress
- ⬜ Planned / not started
- 🐛 Bug found (fixed or open)

---

## 1. Core RAG Pipeline

| Item | Status | Notes |
|---|---|---|
| Intent detection (greeting/blocked/fast-path) | ✅ | `query/intent.js` |
| Query rewriting (follow-up) | ✅ | `query/llm.js` |
| Embedding generation | ✅ | configurable model |
| Vector search (Vectorize) | ✅ | `query/retrieval.js` |
| Hybrid scoring (85% vector + 15% keyword) | ✅ | `query/retrieval.js` |
| Deduplication | ✅ | `query/retrieval.js` |
| Reranking | ✅ | `query/reranker.js` |
| Chunk retrieval (R2) | ✅ | `services/r2.js` |
| Context building (≤4000 chars) | ✅ | `query/context.js` |
| LLM answer generation | ✅ | `query/answer.js` |
| Answer cache (60 min TTL, 200 entries) | ✅ | `query/cache.js` |
| Rate limiting (global/AI/login) | ✅ | middleware |
| Ask Console streaming (SSE) | ✅ | `web/src/api.js` `askStream()` |
| SSE stream close after answer | ✅ | `routes/ask.js` unconditional `res.end()` |

## 2. Graph RAG (Neo4j)

| Item | Status | Notes |
|---|---|---|
| Neo4j driver + config (`NEO4J_*` keys) | ✅ | `config/schema.js` |
| Credential auto-sync (`rag-sync.js`) | ✅ | mirrors gateway neo4j creds |
| Schema introspection | ✅ | `query/graph.js` |
| LLM Cypher generation (read-only) | ✅ | `query/graph.js` |
| Cypher safety gate | ✅ | blocks CREATE/MERGE/DELETE/CALL… |
| Read-only execution + row cap | ✅ | 20 rows / 2500 chars |
| Pipeline injection (stage 7) | ✅ | `query/answer.js:86` |
| Graph panel in Ask Console | ✅ | `AskConsole.jsx` |
| Assistant-level graph override (`graphDatabase`) | ✅ | `query/assistant.js` |

## 3. Provider Catalog & Credentials

| Item | Status | Notes |
|---|---|---|
| v5 schema (providers, models, pricing, auth schemas, resource types) | ✅ | `schema/v5.sql` |
| Provider CRUD + registry | ✅ | `mysql/services/provider-registry.js` |
| Catalog importer (seed) | ✅ | `mysql/services/catalog-importer.js` |
| Credential CRUD + encrypted storage | ✅ | AES-GCM |
| Provider probes (hand-written + generic) | ✅ | `mysql/routes/probes.js` |
| Executors (OpenAI-compatible, Anthropic, Gemini, Ollama, CommandCode, Responses, Cloudflare) | ✅ | `mysql/services/provider-executor.js` |
| Execute chat/embeddings routes | ✅ | `mysql/routes/execute.js` |
| Model access grants (`credential_model_access`) | ✅ | bulk + per-model |
| **Fetch models from provider (live /models → catalog)** | ✅ | `POST /gateway/providers/:key/models/fetch` + `provider-model-fetcher.js` + UI button |
| Model normalization (per-provider dialects) | ✅ | `normalizeModels` in fetcher |
| Provider config tests (probe registration, auth headers, generic probe rules) | ✅ | `mysql/__tests__/provider-config.test.js` (16 tests) |
| Provider fetch-model tests | ✅ | `mysql/__tests__/provider-model-fetcher.test.js` (3 tests) |
| Round-robin credential rotation | ✅ | `provider-executor.js` |

## 4. Knowledge Bases

| Item | Status | Notes |
|---|---|---|
| KB CRUD + company scoping | ✅ | `mysql/services/kb-service.js` |
| Ingest job (chunk settings, embedding model, vector index) | ✅ | per-KB row + `company_config` fallback |
| KB pages UI | ✅ | `#kbs`, `#kbs/<key>` |
| Ingest history UI | 🟡 | only "Last ingest" card; needs `kb_ingest_runs` |

## 5. Assistants

| Item | Status | Notes |
|---|---|---|
| Assistant CRUD + UI | ✅ | `mysql/routes/assistants.js` |
| Pipeline binding (overrides, graph options) | ✅ | `query/assistant.js` |
| `POST /gateway/assistants/:key/test` | ⬜ | planned |
| Model-access gate enforcement at runtime | 🟡 | table exists; runtime enforcement pending |

## 6. Platform Milestones (M3–M6)

| Milestone | Phase | Status |
|---|---|---|
| M3 — Assistants (phase 3) | CRUD + UI done; test route + access gate missing | 🟡 |
| M4 — Chatbots (phase 4) | widget router, publish/archive, embed token, `/chat/*` | ⬜ |
| M5 — Workflows (phase 5) | runner, triggers, `workflow_runs` (migration 004) | ⬜ |
| M6 — Observability (phase 6) | usage log, cost calc, `#usage` dashboard | ⬜ |
| Migration 004 tables | workflow_runs, chatbot_channels, kb_documents, knowledge_graph, conversation_* | ⬜ |

## 7. Suggestion Engine (Ask Console follow-ups)

| Item | Status | Notes |
|---|---|---|
| AI fallback questions (LLM-generated from answer) | ✅ | `generatePossibleQuestions` |
| SSE `possibleQuestions` event + client render | ✅ | stream order: start → possibleQuestions → finish |
| Welcome questions (persisted) | ⬜ | no MySQL table |
| Curated questions (persisted) | ⬜ | no MySQL table |
| Context suggestions (from RAG metadata, no LLM) | ⬜ | runtime only, planned |
| Recommendation rules | ⬜ | optional, deferred |
| Suggestion interactions analytics | ⬜ | optional, deferred |

**Decision (2026-08-20):** keep suggestion runtime in application layer; add MySQL tables only for persistent/admin-controlled data (curated questions, welcome questions, interactions) when the feature moves to first-class.

## 8. Swagger / Docs

| Item | Status | Notes |
|---|---|---|
| Swagger UI + OpenAPI JSON | ✅ | `/api-docs` |
| Auth persistence (`persistAuthorization`) | ✅ | fixed redaction artifact → `true` |
| curl-copy injection (`customJsStr`) | ✅ | cast `/** @type {any} */` (valid runtime option, missing from stale `@types`) |
| `docs/api/streaming.md` SSE protocol doc | ✅ | |
| `docs/api/ask.md`, `config.md`, `scheduler.md`, `cloudflare.md` | ✅ | |

## 9. Security Hardening (agreed, pending)

| Item | Status | Notes |
|---|---|---|
| HTTPOnly + Secure cookies | ⬜ | docs page cookie currently SameSite=Lax, no HttpOnly |
| CSRF protection | ⬜ | `/auth/login` + protected routes |
| CSP headers | ⬜ | |
| Token binding / logout propagation | ⬜ | docs page not notified of logout |
| localStorage token theft (XSS) | 🐛 | flagged; mitigation pending |

## 10. Repo Hygiene

| Item | Status | Notes |
|---|---|---|
| `***` redaction artifacts fixed | ✅ | repo-wide (except git-hook templates) |
| Test suite | ✅ | 573 pass / 0 fail / 7 cancelled (benign stream timeout races) |
| Lint (`npm run lint`) | ✅ | |
| Web build (`cd web && npm run build`) | ✅ | run after every change |

---

## Open Issues

1. **Stream-contract tests "cancelled" (7)** — parent timeout race, benign; no fix needed.
2. **Ingest history** — needs `kb_ingest_runs` table + UI.
3. **Assistant `/test` route** — M3 completion item.
4. **Security hardening** — cookie flags, CSRF, CSP, token binding (user approved "proceed with fix"; order deferred until feature work settles).
5. **Category inference on fetched models** — everything upserts as `chat`; add when a provider's `/models` response distinguishes categories.
