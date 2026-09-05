---
type: reference
status: active
area: reference
tags: [index, files]
related:
  - "[[Dependency Map]]"
---

# Codebase Index

One line per important file (trivial/scratch scripts omitted except famous gotchas).

## Entry & edge
| File | Responsibility |
|---|---|
| `app.js` | Express assembly: trust-proxy/CORS/json/request-log/global limiter wrapper/mounts/swagger/health/static+SPA/error handler/boot init+migrate/listen |
| `env.js` | frozen env accessor (server/admin/MySQL only) |
| `client.js` | per-company CF/S3 SDK clients keyed by credential SHA-256 fingerprint |
| `auth.js` | AUTH_ENABLED gate, HMAC sign/verify/extract (header→Bearer→cookie), requireAdmin |

## config/
`schema.js` keys/models/dimensions/DEFAULT_COMPANY · `index.js` facade barrels · `store.js` runtimeConfig + backend switch + sqlite→mysql lift · `sqlite.js` per-company DB KV · `mysql-store.js` MySQL KV backend (+ensureCompanyId env seeding) · `codec.js` encode/decode sensitive gcm · `encryption.js` AES-256-GCM core · `creds.js` resolveCreds/generateApiKey · `company.js` CRUD persist-first + applyModelDimensions · `write.js` update/reset paths · `validation.js` name/key rules · `prompts.js` {{VAR}} resolution · `presets.js` scheduler presets store.

## query/
`answer.js runPipeline/askQuestion/askQuestionStream` orchestrator · `intent.js` regex fast path · `llm.js` rewrite/followups/MAX_HISTORY/model getters · `cache.js` MD5 TTL FIFO company-tagged · `retrieval.js` funnel constants/flow · `scoring.js` hybrid/dedupe · `reranker.js` gated cross-encoder · `context.js` sanitize/build 4000-budget/user frame · `prompts.js` system message builder + canned responses · `graph.js` GraphRAG safe Cypher · `assistant.js` persona resolution/runnable gate · `stream-contract.js` SSE framing/parser/transport · `cli.js` REPL.

## services/
`cloudflare_ai.js` single AI seam (SDK+REST) · `cloudflare_embeddings.js` batch4/conc2 retry5 · `vectorize.js` index CRUD/upsert/query/count · `r2.js` chunk get/put/bucket lifecycle · `wp.js` REST pagination/by-ids/catalog.

## ingest + ingest/
`ingest.js` composition root (KB vs legacy adapters, status/stats/audit/webhook wiring) · `pipeline.js` pure fetch→transform→store→index loop (+transformItem ids/keys) · `registry.js` processed-*.json stale logic+fingerprint · `resolve.js` KB adapter resolver/legacy adapters · `webhooks.js` Slack/Discord/generic sender HMAC · `sources/` adapters (`index` factory, `url` sitemap crawler, `file` parser).

## routes/
`ask.js` contract middlewares+handlers+SSE aborts · `auth.js` login/me/logout w/ limiter · `cron.js` presets+jobs+cron control · `logs.js` file viewer/clear/download/export/UI sink · `cloudflare.js` composer for sub-routers: companies/apikey/config/prompt/indexes/buckets/helpers.

## mysql/
`pool.js` lazy tuned pool+retry proxy+test seam · `migrate.js` checksummed runner+DELIMITER/MariaDB shims · `gateway-router.js` barrel → `routes/index.js` composer(gate,double-slash guard)+per-entity routers incl execute/cloudflare-resources/ingestion/probes(ping builders) · `repositories/*.js` SQL layer(+helpers mapRow, barrel) · `services/`: credential-service(crypto), provider-registry(cache), catalog-service/importer(CRUD+JSON import txn), kb-service & assistant-service(validation/ownership), provider-executor(live calls), provider-model-fetcher, rag-sync(mirror bridge), company-scope, provider-connection-resolver(resource→cred joins).

## cron / shared / utils
`cron/lifecycle.js` unified job+cron machine(6 max, guards, status) · `cron/index.js` exports · `testing-job.js` stub.
`shared/errors.js` AppError taxonomy · `error-tag.js` 9Router diagnosis · `catalog-enums.js` enums+KB source types · `patterns.js` regexes · `status.js` KB tone/lifecycle derivation.
`utils/chunker.js` heading/FAQ chunker · `cleaner.js` turndown · `helpers.js` chunkArray/sleep/retry/AbortError · `logger.js` batched rotating file logs · `request-context.js` companyFromRequest/CORS/origin-check · `request-logger.js` structured requests.log · `health-check.js` infra probes.

## web/src (portal)
`main.jsx`→`App.jsx` auth-gate+lazy pages+boundary · `api.js` HTTP client hub(518L) · `auth.js`+`auth.jsx` token+session ctx · `context.jsx` CompanyProvider · `hooks.js` route/toast/pagination/poll · `models.js` schema re-exports · layout shell nav/icons · ui kit folders · pages incl catalog & credentials modules described in [[Component Architecture]].

## Data definitions / tooling
`schema/v5.sql` frozen platform DDL reference · `migrations/001…006*.sql` applied evolutions · `docs/openapi.js` live spec source · tests tree per group listed in [[Testing]].