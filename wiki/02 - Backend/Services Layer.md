---
type: backend
status: active
area: backend
tags: [services]
related:
  - "[[Ingestion]]"
  - "[[AI Gateway Platform]]"
---

# Services Layer

Two distinct service layers exist: the **RAG runtime services** (thin Cloudflare seams) and **gateway domain services** (pure validation/business logic over repositories).

## RAG runtime services

| File | Responsibility | Notable behavior |
|---|---|---|
| `services/cloudflare_ai.js` | The AI seam — only module building CF URLs/auth | `runCloudflareAI` SDK w/ per-request `{signal}`; `fetchCloudflareAI` raw Response for streaming/retry owners |
| `services/cloudflare_embeddings.js` | batched embedding generation | batch=4 concurrency=2 via p-limit; preallocated results preserve index alignment; failed batch → null entries |
| `services/vectorize.js` | index CRUD, upsert NDJSON batches of 100, query, getByIds, count | metadata indexes fixed set (r2_key,title,url,type,slug,chunkIndex); cosine metric; DIMENSIONS fallback 768 ([[Technical Debt]] TD-7) |
| `services/r2.js` | chunk JSON get/put(list/skip-existing), bucket lifecycle | HeadObject existence gate on upload; clearBucket deletes in pages of 1000 |
| `services/wp.js` | WordPress REST pagination + by-IDs + lightweight catalog listing | 300 ms pacing between calls; X-WP-TotalPages loop guard |

## Gateway domain services (`mysql/services/`)

| Service | Contract highlights |
|---|---|
| `credential-service.js` | pure encrypt/decrypt/rotate/verify over per-field gcm blob JSON; ENCRYPTION_VERSION tracking; no SQL/network — probes injected → unit-testable |
| `provider-registry.js` | in-memory cached catalog snapshot (providers+auth forms+resource templates+models); `invalidateRegistry()` after writes; loading promise dedupe |
| `catalog-service.js` | provider CRUD orchestration with enum validation from `shared/catalog-enums.js`; ownership checks |
| `catalog-importer.js` | JSON definition importer normalizing two shapes into one transactional catalog upsert (`CatalogImportRepository`), including child replace semantics covered by dedicated tests |
| `kb-service.js` | KB validation (KB_KEY_RE `/^[a-z0-9-]+$/`, source types from shared enums), duplicate/capacity 409 gates, resource-ownership checks, embedding-provider snapshot, audit writes |
| `assistant-service.js` | same F4 pattern for assistants incl. credential/model/primary-KB/graph-resource bindings and variables array |
| `provider-executor.js` | live chat/embedding execution through stored credentials; wire-format translators to normalized OpenAI-style results; `ExecutorError(status)` |
| `provider-model-fetcher.js` | pull model lists from upstream providers when forms need discovery |
| `provider-connection-resolver.js` | resource→credential joins (`resolveResourceConnection`) and embedding model resolution (`resolveEmbeddingModel`) consumed by ingestion adapters |
| `rag-sync.js` | gateway↔RAG credential mirror (see [[ADR - Gateway-to-RAG credential mirroring]]) |

## Adapter factories (`mysql/adapters/`)

Used exclusively by the KB-driven ingest path via `ingest/resolve.js`:

```
embedding/{cloudflare-ai,openai,openrouter}.js + factory
vector/{cloudflare-vectorize}.js + factory        ← receives embeddingAdapter (composable)
storage/{cloudflare-r2,s3}.js + factory
```

Contract mirrors pipeline needs: `store.{ensureBucket,saveContent,uploadChunk}`, `index.{ensureIndex,upsert}` where upsert owns embed+batch. Execution capability still limited to `@cf/`/`@cloudflare/` models at ask time ([[Assistant Personas]] runnable gate) while embeddings have real multi-provider adapters.

## Naming conventions

`run*/get*` pure-ish utilities vs class-free modules; every exported helper carries a JSDoc block; banner comments mark sections. Failure style per [[Error Handling]].