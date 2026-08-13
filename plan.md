# M2 Implementation Plan — Knowledge Bases (Phase 2)

> Source of truth: `docs/platform-buildout.md` (FROZEN Architecture v1.0) §4 Phase 2, §6.2 UI
> wireframe, §9 Risks, §13 Code Map. This plan is the minute-level work breakdown for
> **M2 = Phase 2 (Knowledge Bases end-to-end: DB → ingest → UI)**. Written against the
> actual codebase state after M1 (HEAD `4b55215` + M1 work, uncommitted).
> Schema truth: `migrations/001_init.sql` (checksummed — never edit). `knowledge_bases`
> exists at `001_init.sql:506` — **M2 adds no DDL, rows only** (doc §4 Phase 2: "no DDL").
> Previous milestone: `plan-m1.md` (Phases 0 + 1, ✅ complete).

---

## 1. Goal & Definition of Done

Wire the schema-only `knowledge_bases` table into the live platform: admin CRUD + a
KB-bound ingestion job that writes R2 chunks under `kb/<kb_key>/` and vectors into the KB's
vector resource, with a status endpoint the UI polls.

**Definition of Done (all must hold):**

- [x] Company scoping for `/gateway/kbs/*` resolves `x-company-name` against the MySQL
  `companies` table (`CompanyRepository.findByKey`) — NOT the RAG `company_config` store
  (M1 finding F2, plan-m1 §5.4).
- [x] `KbRepository` CRUD lives in `mysql/repositories/kb.js` (re-exported through the
  `mysql/repositories.js` barrel): `listByCompany`, `findByKey`, `findById`, `create`,
  `update`, `remove` (soft delete via `deleted_at`), `setStatus`.
- [x] Flat routes live in `mysql/routes/kbs.js` (composed by the `mysql/gateway-router.js`
  barrel — new Section 7 KNOWLEDGE BASES):
  `GET/POST /gateway/kbs`, `GET/PUT/DELETE /gateway/kbs/:key`,
  `POST /gateway/kbs/:key/ingest`, `GET /gateway/kbs/:key/status`, plus
  `GET /gateway/kbs/options` (create-modal picklists). All behind `requireAdmin` +
  `adminLimiter` + the existing 503 `gate`.
- [x] Every mutation writes an `audit_logs` row (`kb.created/.updated/.deleted`,
  `kb.ingest.started`).
- [x] `POST /gateway/kbs/:key/ingest` starts a standalone job bound to `{ kbKey }`
  (`cron/lifecycle.js` job key + handler contract extended) — running a second ingest for
  the same KB is denied while one is in flight.
- [x] Ingest resolves chunk settings / embedding model / vector index / R2 bucket **from the
  KB row with `company_config` fallback**; R2 keys gain `kb/<kb_key>/` prefix; registry file
  is per-KB (`processed-<company>-<kb_key>.json`); changing `chunk_size` forces re-chunk on
  the next ingest (registry fingerprint).
- [x] `GET /gateway/kbs/:key/status` returns `{ status, lastSyncAt, documentCount,
  vectorCount, lastError, inProgress }`; KB `status` flips `active → indexing → active|error`
  on the DB row (survives restart).
- [x] Frontend: `#kbs` route (list + create modal) and `#kbs/<key>` detail page (Settings /
  Status cards, Run Ingest / Edit / Delete, `usePoll` while indexing) — matching §6.2.
- [x] New pure-logic tests green; full suite still 203/203 + new tests.
- [x] `web/dist` rebuilt; docs (`docs/openapi.js`, `docs/AI_API_REFERENCE.md`) updated.
  `docs/platform-buildout.md` untouched (frozen).

---

## 2. Environment & Commands (verified 2026-08-07, re-verified 2026-08-12)

| Thing | Value |
|---|---|
| Node | v26.5.0 (ESM) |
| DB | MariaDB 11.8.8 @ `srv1398.hstgr.io:3306` / `u555265406_nodejs` (creds in `.env`, never print) |
| Migration state | 001–005 applied, 0 pending (`node mysql/migrate.js --dry-run` → "No pending migrations") |
| Live DB rows (re-verified 2026-08-12) | companies 2 (`maxicert`, `popularcert`) · providers 1 (`openai` — `004_seed_catalog.sql` re-seeded the catalog to OpenAI-only, replacing the earlier 14-provider set) · models 5 (embedding: `text-embedding-3-small`, `text-embedding-3-large`) · **provider_endpoints 0** (the 003-seeded Cloudflare endpoints were dropped in the 004 re-seed) · provider_model_pricing 7 · **provider_resources 0 rows** (`vector_index` 0, `object_bucket` 0) · **knowledge_bases 0 rows** · credentials 2 · audit_logs 125 |
| Tests | `node --test "config/__tests__/*.test.js" "query/__tests__/*.test.js" "cron/__tests__/*.test.js" "ingest/__tests__/*.test.js" "routes/__tests__/*.test.js" "mysql/__tests__/*.test.js"` → 228/228 pass (re-verified 2026-08-12) |
| Server | `node app.js` (port 3000, user's own). For E2E use `PORT=3100 node app.js`, then kill (`/bin/kill -9 <pid>`). **Never leave it running** |
| Build | `cd web && npm run build` → `web/dist` (required before the server serves UI) |
| Lint | none configured — match house style (2-space indent, `// ------` banners, emoji logs, JSDoc on exports) |
| Env quirk | `CONFIG_STORE=mysql` is set in `.env` AND exported in the shell — the config-store tests pin `CONFIG_STORE=sqlite` explicitly in a temp dir; do not rely on ambient env |

**Frozen `knowledge_bases` DDL (001_init.sql:506–545) — the exact columns M2 writes:**

```
id BIGINT UNSIGNED AI PK
company_id INT UNSIGNED NOT NULL            → FK companies(id) ON DELETE CASCADE
kb_key VARCHAR(100) NOT NULL
kb_name VARCHAR(200) NOT NULL
description TEXT
vector_resource_id BIGINT UNSIGNED NULL      → FK provider_resources(id) ON DELETE SET NULL
graph_resource_id BIGINT UNSIGNED NULL       → FK provider_resources(id) ON DELETE SET NULL
storage_resource_id BIGINT UNSIGNED NULL     → FK provider_resources(id) ON DELETE SET NULL
embedding_model_id INT UNSIGNED NULL         → FK provider_models(id) ON DELETE SET NULL
embedding_model_provider VARCHAR(50)
chunk_size INT UNSIGNED DEFAULT 512
chunk_overlap INT UNSIGNED DEFAULT 50
retrieval_top_k INT UNSIGNED DEFAULT 10
retrieval_score_threshold DECIMAL(5,4) DEFAULT 0.7
enable_graph_rag BOOLEAN DEFAULT FALSE
enable_hybrid_search BOOLEAN DEFAULT TRUE
status ENUM('active','indexing','error','archived') DEFAULT 'active'
is_active BOOLEAN DEFAULT TRUE
created_at / updated_at TIMESTAMP
deleted_at TIMESTAMP NULL
UNIQUE uk_company_kb (company_id, kb_key)
```

Related: `provider_resources` (001_init.sql:449) — `resource_type ENUM(…'vector_index','object_bucket'…)`,
`external_resource_id VARCHAR(255)` (the **actual Cloudflare index/bucket name**),
`credential_id NOT NULL`, `company_id NOT NULL`, `provider_id NOT NULL`, `deleted_at`.
`provider_models` (001_init.sql:206) — `model_key VARCHAR(100)`, `category ENUM('chat','embedding',…)`.
`companies` (001_init.sql:14) — `company_key UNIQUE`, `max_knowledge_bases DEFAULT 10`.

---

## 3. Pre-flight audit findings (new — M2 only; M1 findings F1–F7 stand, see plan-m1.md)

- **F8 — `provider_resources` is empty for the live companies.** Verified: 0 `vector_index`
  and 0 `object_bucket` rows. The companies' real index/bucket live in the RAG
  `company_config` (`VECTOR_INDEX`, `R2_BUCKET_NAME`). Consequences:
  1. The create-KB modal's `vector_resource_id` / `storage_resource_id` selects would be
     **empty** → the modal must offer an explicit **"Company default"** option (NULL id).
  2. KB ingest **must** implement the doc's "falling back to `company_config`" path or the
     feature is unusable until resources are provisioned (a later phase). M2's E2E runs on
     the fallback path; the resource-bound path is implemented but exercised only when rows
     exist. Flag: resource provisioning (wizard → `provider_resources` rows) is out of M2.
- **F9 — no catalog-model → Cloudflare-model mapping.** The runtime embeddings service uses
  `EMBEDDING_MODEL` strings from `company_config` (`@cf/baai/bge-base-en-v1.5`, default in
  `config/schema.js:107`); the catalog's embedding models are OpenAI
  (`text-embedding-3-small/large` — not callable through CF `/accounts/{id}/ai/run`).
  `knowledge_bases.embedding_model_id` is a catalog FK. **M2 rule:** at ingest, resolve the
  effective embedding model as `KB.embedding_model_id → model_key` **only when it is a
  Cloudflare model** (its `model_key ∈ EMBEDDING_DIMENSIONS` map keys, i.e. starts `@cf/`),
  otherwise fall back to `company_config.EMBEDDING_MODEL`. `embedding_model_provider` stores
  the provider_key snapshot at create time. The UI preselects "Company default".
- **F10 — the chunker takes no size/overlap.** `chunkMarkdown(md)` (utils/chunker.js) has no
  options; `enforceChunkSize(chunks, max=1000)` (ingest/pipeline.js:49) does take a max but
  is a private function. `knowledge_bases.chunk_size/chunk_overlap` are real columns. **M2:**
  thread `chunkOptions = { size }` through `runIngestion → transformItem` and call
  `enforceChunkSize(chunks, kb.chunk_size)`; `chunk_overlap` is validated and stored but has
  no chunker implementation today (documented, no-op — the chunker is section-based, not
  sliding-window). `MIN_CHUNK_LENGTH = 40` floor stays.
- **F11 — job keys are `jobId:companyName`.** `cron/lifecycle.js:20` `jobKey(jobId,
  companyName)`; KB-bound jobs need the KB in the key or a second ingest for the same KB
  would not be detected as running. **M2:** `jobKey(jobId, companyName, kbKey)` +
  `jobKeyDisplay` update; `startJob(jobId, companyName, opts)` forwards `opts` (incl.
  `kbKey`) to the handler `{ signal, companyName, ...opts }`; `stopJob(jobId, companyName,
  kbKey)`. Cron path (`startCron`, lifecycle.js:260) already calls
  `handler({ signal, companyName })` — an extra `kbKey` param is harmless.
- **F12 — status needs data sources that don't all exist.** `status` = KB row (`status`,
  `updated_at`) + document count (per-KB registry file keys) + vector count (new
  `countVectors(indexName, companyName)` in `services/vectorize.js` via the SDK
  `indexes.get(name).vectorCount`, wrapped so failures degrade to `null`) + last ingest
  result. **No `kb_ingest_runs` table exists** and M2 adds no DDL → the "Recent ingests"
  wireframe (§6.2) is **not** fully implemented: the UI shows a single "Last ingest" card
  from the status payload. A per-run history table is a later migration (flag, see §10).
- **F13 — the ingestion registry keys on `modified` date only.** `ingest/registry.js`
  `createRegistry(company)` → `processed-<company>.json`; an unchanged post is skipped, so
  changing `chunk_size` would NOT re-chunk. Doc acceptance explicitly requires
  "changing `chunk_size` re-chunks on next ingest" → **registry gains a config fingerprint**
  (`__meta: { chunkSize }` in the file); `isStale` returns true when the fingerprint differs,
  forcing a full re-ingest after settings change.
- **F14 — vector IDs collide across KBs.** `ingest/pipeline.js:41` `makeVectorId(pageSlug,
  i)` = `sha256(pageSlug)…` — identical for the same source URL in two KBs sharing one
  index → upserts would silently overwrite. **M2:** the vector id hash input gains the KB
  prefix (`kb/<kb_key>/`), so per-KB ids are unique. `metadata.type` stays the content type
  (`pages`/`posts`); the R2 key prefix carries the KB.

---

## 4. Locked decisions (D8–D15; M1 D1–D7 stand)

- **D8 — Gateway company scoping middleware.** New `mysql/services/company-scope.js`
  exporting `requireGatewayCompany(req, res, next)`: reads `x-company-name` header
  (fallback `?company=` then `body.company`), resolves via `CompanyRepository.findByKey`,
  sets `req.company = { id, companyKey, companyName, … }`; 400 when missing, 404 when
  unknown. Used by every KB route. (NOT `companyFromRequest` in
  `utils/request-context.js:49` — that resolves against the RAG `company_config`.)
- **D9 — Validation is a pure, DB-free service** `mysql/services/kb-service.js`
  (`validateKbInput`, plus thin transactional writers), mirroring `catalog-service.js`
  (`{ ok: true, value } | { ok: false, errors }`, `HttpError` with `.status`, writers use
  `getConnection()` + begin/commit/rollback per F4).
- **D10 — KB deletes rely on FK `ON DELETE SET NULL`.** `assistants.primary_kb_id` /
  `kb_ids` reference KBs (Phase 3); the schema already SET NULLs them (001_init.sql:567).
  `removeKb` is a **soft delete** (`deleted_at = NOW()`) because `knowledge_bases` has a
  `deleted_at` column and `uk_company_kb` would block hard-delete+recreate — the unique key
  stays free after soft delete? **No — it does not.** `uk_company_kb (company_id, kb_key)`
  is a plain UNIQUE, so a soft-deleted row still occupies the key. **Decision:** hard delete
  (`DELETE FROM knowledge_bases WHERE id = ?`) to keep keys reusable and match the endpoints/
  pricing pattern; there is no audit requirement for row retention (audit_logs keeps the
  trail). If key reuse is not desired, `removeKb` instead renames `kb_key` to
  `kb_key--deleted-<id>` before soft delete — pick hard delete (simpler, audited).
- **D11 — Ingest binding surface.** `jobs.js` `ingest.handler` stays the composition root;
  it gains a KB-aware branch. Settings resolution order: KB row → `company_config`
  (`config/getConfig(companyName)`). Resource-name resolution: KB `vector_resource_id` /
  `storage_resource_id` → `ResourceRepository` row → `external_resource_id`; NULL → config
  `VECTOR_INDEX` / `R2_BUCKET_NAME`. The R2/vectorize services gain **optional override
  params** (default = config) so the KB branch passes explicit names:
  - `services/r2.js` `uploadObject(key, data, companyName, bucketName = getR2Bucket(companyName))`
  - `services/vectorize.js` `createVectorIndex(name, companyName, dimensions)` (unchanged),
    `upsertVectors(chunks, companyName, { indexName, embeddingModel, dimensions } = {})`
  - `services/cloudflare_embeddings.js` `generateEmbeddings(texts, companyName, model = getConfig(companyName).EMBEDDING_MODEL)`
  - `ingest/registry.js` `createRegistry(companyName, kbKey = null)` → file
    `./processed-<company>[-<kbKey>].json`; fingerprint via `createRegistry(company, kbKey, { chunkSize })`.
- **D12 — Status persistence.** The ingest handler flips the **DB row**
  `KbRepository.setStatus(id, "indexing" | "active" | "error", { error })` at start /
  success / failure — persists across restarts (in-memory job state alone would go stale).
  `GET /gateway/kbs/:key/status` merges KB row + registry doc count + vector count.
- **D13 — Cache-key isolation is deferred.** Doc §14 says "Phase 2/3: add `kb_key` to the
  cache key" — but M2 has no KB-bound **ask** path (retrieval binding is Phase 3). No
  `query/cache.js` change in M2; noted for M3.
- **D14 — `GET /gateway/kbs/options` is one bundled picklist route** (single round trip for
  the create modal): `{ vectorResources, storageResources, embeddingModels }` for the
  resolved company — `ResourceRepository.listByCompany(companyId, { resourceType:
  "vector_index" | "object_bucket" })` + new `ModelRepository.listByCategory("embedding")`.
- **D15 — No migration in M2** (DDL or DML). All targets exist. Any follow-up table
  (`kb_ingest_runs`, `kb_documents`, `knowledge_graph`) becomes migration `005` in a later
  phase — checksummed, never edited after apply.

---

## 5. Phase 2 — Backend

> **Status: ✅ COMPLETE (verified 2026-08-07).** All six items landed:
> - §5.1 `mysql/services/company-scope.js` — `resolveGatewayCompany` / `requireGatewayCompany` (D8: `CompanyRepository.findByKey`).
> - §5.2 `mysql/repositories/` — `model.js` (`ModelRepository.listByCategory` + `findById`, now with `provider_key`), `resource.js` (`findById`), `kb.js` (full `KbRepository` with `KB_SELECT` join).
> - §5.3 `mysql/services/kb-service.js` — pure validators + `HttpError`, `saveKb`/`updateKb`/`removeKb` with 409 duplicate/capacity gates, resource-ownership check, embedding-provider snapshot, audit writes.
> - §5.4 `mysql/routes/kbs.js` — all 8 routes (`/kbs/options`, `/kbs` GET/POST, `/kbs/:key` GET/PUT/DELETE, `/kbs/:key/ingest`, `/kbs/:key/status`) behind `router.use("/kbs", requireGatewayCompany)`.
> - §5.5 Ingest binding — `cron/lifecycle.js` job keys carry `kbKey` (F11); `ingest.js` KB branch (status flips, D11 resource resolution + config fallback, F9 embedding gate, F13 fingerprint registry, F14 vector-id prefix); `pipeline/registry/r2/vectorize/embeddings` signatures extended.
> - §5.6 `countVectors` in `services/vectorize.js` (best-effort, null on error).
> Deviations: `remove` is a **hard delete** (D10 — the plain UNIQUE on `uk_company_kb` would block soft-deleted keys); `chunk_overlap` stored + validated but a documented no-op (F10).
>
> **Test:** 219/219 pass (203 prior + 12 kb-service + 4 kb-pipeline).

### 5.1 Company scoping middleware — `mysql/services/company-scope.js` (new)

Mirror `credential-service.js` shape (plain functions, JSDoc):

```js
// --------------------------
// COMPANY SCOPE — gateway tenant resolution
// Resolves x-company-name against the MySQL companies table (CompanyRepository),
// NOT the RAG company_config store. Used by every /gateway/kbs* route.
// --------------------------
import { CompanyRepository } from "../repositories.js";

export async function requireGatewayCompany(req, res, next) {
  // 1. source: req.headers["x-company-name"] → req.query.company → req.body?.company
  // 2. missing → 400 { success: false, error: "Company is required (x-company-name header)." }
  // 3. row = await CompanyRepository.findByKey(companyKey)
  //    row null → 404 { success: false, error: `Company '${key}' not found.` }
  // 4. req.company = row  (has .id, .company_key, .company_name, .max_knowledge_bases)
  // 5. next()
}
```

Route wiring inside the router: `router.use("/kbs", requireGatewayCompany)` (scoped to the
KB section only). Export for tests: pure `resolveGatewayCompany(companyKey)` helper returning
`{ company } | { error, status }` so the 400/404 branches are unit-testable without Express.

### 5.2 Repositories — `mysql/repositories/` (one file per entity)

**a) `KbRepository`** (new object literal after `PricingRepository`; same banner + `getPool()`
pattern; `mapRow` camelization at line 25 reused):

```js
// ------------------------------------------------------------------
// KbRepository — knowledge_bases (tenant KBs, rows only — no DDL in M2)
// ------------------------------------------------------------------
export const KbRepository = {
  // SELECT k.*, pv.resource_name AS vector_resource_name,
  //        pv.external_resource_id AS vector_external_id,
  //        ps.resource_name AS storage_resource_name,
  //        ps.external_resource_id AS storage_external_id,
  //        pm.model_key, pm.model_name AS embedding_model_name
  //   FROM knowledge_bases k
  //   LEFT JOIN provider_resources pv ON pv.id = k.vector_resource_id
  //   LEFT JOIN provider_resources ps ON ps.id = k.storage_resource_id
  //   LEFT JOIN provider_models pm ON pm.id = k.embedding_model_id
  //  WHERE k.company_id = ? AND k.deleted_at IS NULL
  //  ORDER BY k.updated_at DESC
  async listByCompany(companyId, { includeInactive = false } = {}),

  // Same SELECT + WHERE k.company_id = ? AND k.kb_key = ? AND k.deleted_at IS NULL
  async findByKey(companyId, kbKey),

  async findById(kbId),

  // INSERT (company_id, kb_key, kb_name, description, vector_resource_id,
  //   graph_resource_id, storage_resource_id, embedding_model_id,
  //   embedding_model_provider, chunk_size, chunk_overlap, retrieval_top_k,
  //   retrieval_score_threshold, enable_graph_rag, enable_hybrid_search, status)
  // status default 'active'; returns Number(result.insertId)
  async create(companyId, input),

  // UPDATE knowledge_bases SET <dynamic, snake_case via columnByKey map — same
  // technique as EndpointRepository.update / PricingRepository.update> WHERE id = ?
  async update(kbId, input),

  // Hard delete (D10): DELETE FROM knowledge_bases WHERE id = ?
  async remove(kbId),

  // UPDATE knowledge_bases SET status = ?, error_text = ? WHERE id = ?
  // (error_text is NOT a column — pass error via description? NO: the schema has no
  //  error column. Persist last error via the audit trail only, and surface live errors
  //  from the in-memory job state in /status. setStatus(kbId, status) only.)
  async setStatus(kbId, status),
};
```

Note (flag): the DDL has **no `error` / `last_sync_at` / `last_ingest_at` column** on
`knowledge_bases` (001_init.sql:506–545 only has `status`/`updated_at`). So "last sync time"
for `/status` comes from `updated_at` (last status flip) — document this mapping in the
route. A dedicated column is a future migration.

**b) `ModelRepository.listByCategory(category)`** (small addition, after `listByProvider`):

```js
// SELECT pm.id, pm.model_key, pm.model_name, pm.model_family, pm.category,
//        pr.provider_key, pr.provider_name
//   FROM provider_models pm
//   JOIN providers pr ON pr.id = pm.provider_id
//  WHERE pm.category = ? AND pm.is_active = TRUE AND pm.is_deprecated = FALSE
//  ORDER BY pr.provider_name, pm.model_name
async listByCategory(category),
```

**c) `ResourceRepository.findById(id)`** (add after `listByCompany` — **does not exist
today**, verified `mysql/repositories/resource.js` has only `listByCompany` /
`grantModelAccess` / `listModelAccess`; the KB ingest resource-resolution and the kb-service
ownership check both need a single-row fetch):

```js
// SELECT <same 20 columns as listByCompany> FROM provider_resources
//  WHERE id = ? AND deleted_at IS NULL
async findById(id),
```

### 5.3 Service layer — `mysql/services/kb-service.js` (new)

Mirror `catalog-service.js` exactly: pure validators + `HttpError(status)` + transactional
writers via `getConnection()` (F4).

```js
export const KB_KEY_RE = /^[a-z0-9-]+$/;         // 3–63 chars (matches company/resource rule)

export function validateKbInput(input)
// { ok: true, value } | { ok: false, errors: { field: msg } }
//  kbKey          required, KB_KEY_RE, 3–63 chars (column VARCHAR(100); rule per doc §6.2)
//  kbName         required, ≤200 chars
//  description    optional, ≤65535 (TEXT) — trimmed
//  vectorResourceId / storageResourceId / graphResourceId
//                 optional; must be positive int when set; graph deferred (M2 stores NULL)
//  embeddingModelId optional; positive int when set
//  chunkSize      optional → 512; int 1–10000
//  chunkOverlap   optional → 50; int 0–(chunkSize-1)
//  retrievalTopK  optional → 10; int 1–100
//  retrievalScoreThreshold optional → 0.7; number 0–1 (DECIMAL(5,4))
//  enableGraphRag / enableHybridSearch optional booleans → false / true
//  isActive       optional boolean → true

export async function saveKb(company, input)
// 1. validateKbInput → throw HttpError(400, joined errors)
// 2. KbRepository.findByKey(company.id, kbKey) → HttpError(409, "kbKey already exists.")
// 3. capacity gate: CompanyRepository row max_knowledge_bases — count = listByCompany().length
//      (filter deleted) → >= max → HttpError(409, "company KB limit reached (N)")
//      — simple, DB-light; the column exists for exactly this
// 4. resource FK check (cheap): if vectorResourceId/storageResourceId set, verify the
//      ResourceRepository row exists AND belongs to company.id → 400 otherwise
// 5. embedding_model_provider snapshot: if embeddingModelId → ModelRepository.findById →
//      provider_key from the join (add provider_key to findById SELECT) else null
// 6. KbRepository.create(company.id, value); AuditRepository.log(kb.created);
//    return { kbId }

export async function updateKb(company, kbKey, input)
// find → 404; validate; same resource-ownership check; KbRepository.update; audit kb.updated
// (with before/after state JSON)

export async function removeKb(company, kbKey)
// find → 404; KbRepository.remove; audit kb.deleted (afterState { kb_key })
```

### 5.4 Routes — `mysql/routes/kbs.js` (new Section 7 KNOWLEDGE BASES)

Insert after the PRICING block (before `PROBES`, ~line 780), using `wrap()` + `gate` +
`requireGatewayCompany` (registered via `router.use("/kbs", requireGatewayCompany)` at the
top of the section). All mutations audit-logged with `actorId: req.auth?.user`.

```
GET    /kbs/options
  → { success: true, options: { vectorResources: [...], storageResources: [...],
       embeddingModels: [...] } }          (D14; ResourceRepository.listByCompany ×2 +
                                             ModelRepository.listByCategory("embedding"))

GET    /kbs
  → { success: true, kbs: [...] }          (KbRepository.listByCompany(req.company.id),
                                             includes resolved resource/model display names)

POST   /kbs
  body: { kbKey, kbName, description?, vectorResourceId?, storageResourceId?,
          embeddingModelId?, chunkSize?, chunkOverlap?, retrievalTopK?,
          retrievalScoreThreshold?, enableHybridSearch?, enableGraphRag?, isActive? }
  → 400 validation | 404 unknown company | 409 duplicate kbKey or KB limit
  → 201 { success: true, message, kbId, kbKey }
  audit: "kb.created", entityType "kb", afterState { kb_key }

GET    /kbs/:key
  → 404 | { success: true, kb: {...} }      (findByKey; 404 "KB '<key>' not found.")

PUT    /kbs/:key
  body: same as POST (kbKey not editable — key is the route identity; ignore if sent)
  → 404 | 400 | 200 { success: true, message }
  audit: "kb.updated" (+ before/after state JSON)

DELETE /kbs/:key
  → 404 | 200 { success: true, message }    (hard delete, D10)
  audit: "kb.deleted", afterState { kb_key }

POST   /kbs/:key/ingest
  → 404 unknown KB | 409 already running (job key match, F11) | 400 company not configured
    (no VECTOR_INDEX / R2_BUCKET_NAME in config AND no resource override — same throw the
     ingest main already does; surface it early as a friendly 400)
  → 200 { success: true, message: "Ingest for '<kb_key>' started.", startedAt }
  action: startJob("ingest", req.company.companyKey, { kbKey: kb.key })
  audit: "kb.ingest.started", entityType "kb", entityId kb.id

GET    /kbs/:key/status
  → 404 | { success: true, status: {
      kbKey, status, inProgress: (standalone job for this KB is "running"),
      lastSyncAt: kb.updated_at,             // last status flip (see 5.2 note)
      documentCount: <registry keys>,        // fs read of processed-<company>-<kbKey>.json
      vectorCount: <countVectors or null>,   // best-effort, null on API failure
      lastError: <job state error or null> } }
```

`POST /kbs/:key/ingest` calls `startJob` which is currently imported by `routes/cron.js` from
`cron/index.js` — the gateway router will `import { startJob } from "../../cron/index.js"`
(check relative path from `mysql/`). `cron/index.js` already re-exports `startJob`
(lifecycle.js:1–9). Job display strings grow the KB: `jobKeyDisplay` → `ingest [company: X]
[kb: Y]`.

### 5.5 Ingestion binding

**a) `cron/lifecycle.js`** — F11:

```js
export function jobKey(jobId, companyName, kbKey = null) {
  return `${jobId}:${companyName || "_default"}${kbKey ? `:${kbKey}` : ""}`;
}
// jobKeyDisplay: append ` [kb: ${kbKey}]` when present.
// startJob(jobId, companyName, opts = {}):
//   const key = jobKey(jobId, companyName, opts.kbKey);
//   handler receives { signal, companyName, ...opts };  state gains opts.kbKey
//   response gains kbKey when set.
// stopJob(jobId, companyName, kbKey): key = jobKey(jobId, companyName, kbKey)
// getRunningJobs(): include kbKey in the emitted job objects.
```

**b) `routes/cron.js`** — accept + forward `kbKey` in `POST /job/start` / `/job/stop`
bodies (parity: the legacy `/cloudflare` scheduler can then drive a KB ingest too):
`const { jobId, companyName, kbKey } = req.body; startJob(jobId, companyName, { kbKey })`.

**c) `jobs.js`** — no change needed: `ingest.handler = main` already receives the full opts
object; `main` reads `kbKey` off it.

**d) `ingest.js` main — KB-aware branch** (composition root; keeps the non-KB path byte-identical):

```js
export async function main({ signal, companyName, kbKey } = {}) {
  // ...
  let r2Prefix = "site";            // legacy default — actually prefix only used in pipeline
  if (kbKey) {
    // 1. company = CompanyRepository.findByKey(companyName)   (throw if null)
    // 2. kb = KbRepository.findByKey(company.id, kbKey)       (throw if null)
    // 3. KbRepository.setStatus(kb.id, "indexing")
    // 4. resource resolution (D11):
    //      vectorId = kb.vector_resource_id ?? null
    //      if (vectorId) res = ResourceRepository.findById(vectorId)  → indexName = res.external_resource_id
    //      else indexName = getVectorIndex(companyName)               (config fallback)
    //      storageId = kb.storage_resource_id ?? null
    //      if (storageId) res2 = ResourceRepository.findById(storageId) → bucketName = res2.external_resource_id
    //      else bucketName = getR2Bucket(companyName)                  (config fallback)
    // 5. embedding (F9):
    //      effModel = getConfig(companyName).EMBEDDING_MODEL
    //      if (kb.embedding_model_id) { m = await ModelRepository.findById(...)
    //        if (EMBEDDING_DIMENSIONS[m.model_key]) effModel = m.model_key }   // @cf/ only
    // 6. chunk options: size = kb.chunk_size || 512
    // 7. registry = createRegistry(companyName, kbKey, { chunkSize: size })   // F13
  }
  // store adapter: uploadChunk: (r2Key, payload) => uploadObject(r2Key, payload, companyName, bucketName)
  // index adapter:  upsert: (chunks) => upsertVectors(chunks, companyName,
  //                      { indexName, embeddingModel: effModel })
  //                 ensureIndex: () => createVectorIndex(indexName, companyName)  // dims from effModel
  // runIngestion({ ..., r2Prefix: kbKey ? `kb/${kbKey}` : "site", chunkOptions: { size }, ... })
  // finally (non-abort path):
  //   KbRepository.setStatus(kb.id, "active");   on error → setStatus(kb.id, "error") + audit kb.ingest.failed
}
```

`getVectorIndex` / `getR2Bucket` (services/vectorize.js:15, services/r2.js:15) still default
to config — used by the non-KB path and as fallback. **Guard:** when the resolved `indexName`
or `bucketName` is empty → throw the existing "not configured" errors (ingest.js:24,27) with
the KB key in the message.

**e) `ingest/pipeline.js`** — F10/F14:

- `runIngestion({ ..., r2Prefix = "site", chunkOptions = { size: MAX_CHUNK_SIZE } })`
- `transformItem(item, type, { r2Prefix, chunkSize })`:
  - `r2_key = ${r2Prefix}/${type}/${pageSlug}/chunk-${i}.json`
  - `enforceChunkSize(rawChunks, chunkSize)` instead of the default `MAX_CHUNK_SIZE`
  - `makeVectorId(pageSlug, i)` → hash input becomes `${r2Prefix}/${pageSlug}` (F14)
- Keep `MAX_CHUNK_SIZE = 1000` as the legacy default constant; `chunk_size` from the KB row
  overrides it. `MIN_CHUNK_LENGTH = 40` unchanged.
- `chunk_overlap`: documented no-op for M2 (F10).

**f) `ingest/registry.js`** — F13:

```js
function registryPath(companyName, kbKey = null) {
  return `${REGISTRY_BASE}${companyName ? "-" + companyName : ""}${kbKey ? "-" + kbKey : ""}.json`;
}
export function createRegistry(companyName, kbKey = null, meta = null) {
  // load data; data.__meta = meta ?? data.__meta
  // fingerprint = JSON.stringify(meta ?? {})
  // isStale(key, modifiedDate): !data[key] || data[key] !== modifiedDate
  //   || (meta && fingerprint !== data.__metaFingerprint)
  // record(): writes data with __meta + __metaFingerprint preserved
  // countDocuments(): Object.keys(data).filter(k => !k.startsWith("__")).length
}
```

### 5.6 Vector count — `services/vectorize.js`

```js
export async function countVectors(indexName, companyName) {
  // getCFClient(companyName).vectorize.indexes.get(indexName, { account_id })
  //   → res?.result?.vectorCount ?? null; any error → null (status is best-effort, F12)
}
```

### 5.7 Cache layer

No change (D13). `query/cache.js` keeps the `company:rewrittenQuestion` key for M2.

---

## 6. Phase 2 — Frontend

> **Status: ✅ COMPLETE (verified 2026-08-07).** `web/dist` rebuilt clean.
> - §6.1 `web/src/api.js` — 8 KB functions (`listKbs` … `getKbOptions`), company header attached.
> - §6.2 `App.jsx` routes `#kbs`/`#kbs/<key>`; `web/src/components/layout/nav.js` AI nav group gains "Knowledge Bases" (`IconBook`, in `layout/icons.jsx`) + `PAGE_META.kbs`.
> - §6.3 `web/src/pages/KbList.jsx` — table + status Badge tones, Refresh/Create header actions, 30s poll, delete confirm.
> - §6.4 `web/src/pages/KbDetail.jsx` — Run Ingest / Edit / Delete, 4 StatCards, settings + last-ingest cards, 10s poll while `inProgress` else 30s.
> - §6.5 `web/src/components/kb-modal.jsx` — shared create/edit modal, `kb_key` prefilled `${company}-kb` (locked on edit), "Company default (config)" leading options per F8, advanced `<details>` collapsible.
> Bonus (mid-session user request): `web/src/pages/Logs.jsx` rewritten to premium log-file cards per the Linear/Vercel aesthetic — see the git status note.
> **Build:** `cd web && npm run build` → `web/dist` (passes; only the standard >500 kB chunk warning).

### 6.1 `web/src/api.js` (append after the pricing fns; `api()` already attaches
`x-company-name` when `company` is passed — verified `web/src/api.js:16`)

```js
export const listKbs = (company) => api("/gateway/kbs", { company }).then((d) => d.kbs);
export const createKb = (body, company) => api("/gateway/kbs", { method: "POST", body, company });
export const getKb = (key, company) => api(`/gateway/kbs/${encodeURIComponent(key)}`, { company }).then((d) => d.kb);
export const updateKb = (key, body, company) => api(`/gateway/kbs/${encodeURIComponent(key)}`, { method: "PUT", body, company });
export const deleteKb = (key, company) => api(`/gateway/kbs/${encodeURIComponent(key)}`, { method: "DELETE", company });
export const ingestKb = (key, company) => api(`/gateway/kbs/${encodeURIComponent(key)}/ingest`, { method: "POST", company });
export const kbStatus = (key, company) => api(`/gateway/kbs/${encodeURIComponent(key)}/status`, { company }).then((d) => d.status);
export const getKbOptions = (company) => api("/gateway/kbs/options", { company }).then((d) => d.options);
```

(AUTH_PATHS already includes `"/gateway"` — M1 F1 fix, verified line 6.)

### 6.2 Routing + Nav

- **`web/src/App.jsx`**: `import KbList from "./pages/KbList";` (list) and
  `import KbDetail from "./pages/KbDetail";` — add `kbs: KbList` to `PAGES`; the existing
  segment split (`const [seg] = route.split("/")`, `path={route}`) already serves
  `#kbs/<key>` → KbDetail via the `path` prop. No App.jsx structural change needed.
- **`web/src/components/layout/nav.js`** (icons in `layout/icons.jsx`):
  - AI group gains `{ id: "kbs", label: "Knowledge Bases", icon: <IconLayers /> }`
    (reuse the Catalog icon style — a "stack" reads fine for KBs — or add a sibling
    `IconBook`: 24×24, `stroke="currentColor"`, `strokeWidth={1.5}`, `fill="none"`, book
    outline path `M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z` + spine
    `M4 19.5A2.5 2.5 0 0 0 6.5 22H20V19.5`).
  - `PAGE_META.kbs = { title: "Knowledge Bases", subtitle: "Per-company RAG corpora — settings, ingestion, and status" }`.
  - Company-scoped gate: KB pages require a selected company — show the existing
    "select a company" empty state from the page, not a nav-level gate.

### 6.3 `web/src/pages/KbList.jsx` (new — mirrors §6.2 list wireframe)

Pattern source: `Cloudflare.jsx` + `Catalog.jsx` (usePoll, Card/Button/Input/Select/TextArea/
Badge/Spinner/Modal/Toast, `window.confirm` before delete).

- `const { company } = useCompanies();` — when falsy, render
  `<Empty message="Select a company to manage its knowledge bases." />`.
- `usePoll(load, 30000)` — `load()` = `setKbs(await listKbs(company))` (skip when no company).
- Header actions: `useHeaderActions(<Button onClick={load}>Refresh</Button>)`.
- Table: `kb_name` · `kb_key` · embedding model name (or "—") · vector index name (or
  "Company default") · `Badge` status (`indexing` amber, `error` red, `active` green) ·
  actions `[Open]` → `navigate("kbs/" + kbKey)`.
- `[+ Create KB]` → Create modal (§6.5) → `createKb(body, company)` → toast + reload.
- Row delete: `window.confirm` → `deleteKb(kbKey, company)` → reload.

### 6.4 `web/src/pages/KbDetail.jsx` (new — mirrors §6.2 detail wireframe)

- Back button (`navigate("kbs")`), title = `kb.kb_name`, status `Badge`.
- **Actions:** `[Run Ingest]` (secondary Button; `window.confirm("Run ingest for '<name>'?")`
  → `ingestKb(kbKey, company)` → toast → flip to polling), `[Edit]` (reuses create modal,
  prefilled → `updateKb`), `[Delete]` (confirm → `deleteKb` → navigate back).
- **Settings card:** embedding model, chunk `size/overlap`, `Top-K` + `≥ threshold`,
  hybrid/graph toggles (read-only text rows).
- **Status card** (`StatCard`s): Vector index · Storage · Documents (`status.documentCount`) ·
  Vectors (`status.vectorCount`, "—" when null) · Last sync (`status.lastSyncAt` → `timeAgo`)
  · `lastError` banner when set.
- **Polling:** `usePoll(fetchStatus, status.inProgress ? 10000 : 30000)` — while
  `inProgress` poll every 10s; stop-fast when `status` flips `indexing → active|error`
  (the `inProgress` flag from the job state drives it; `usePoll` deps `[kbKey, company,
  inProgress]`).
- **Last ingest card:** single row from the status payload (`lastSyncAt`, documentCount,
  vectorCount, outcome badge) — the full "Recent ingests" history is deferred (F12).
- Fetch detail with `getKb(kbKey, company)` + status with `kbStatus(kbKey, company)`.

### 6.5 Create/Edit KB modal (shared by both pages)

- `kb_key` Input prefilled `${company}-kb` (only on create), inline hint
  `regex /^[a-z0-9-]+$/ · 3–63 chars` (same pattern as Catalog's endpoint hint).
- `kb_name` Input, `description` TextArea.
- `vector_resource_id` Select: `getKbOptions(company).vectorResources` rows + a leading
  `{ value: "", label: "Company default (config)" }` option (F8).
- `storage_resource_id` Select: `object_bucket` rows + "Company default" option.
- `embedding_model_id` Select: `embeddingModels` + "Company default (config)".
- Advanced collapsible (`details`/`summary`): `chunk_size` (number, default 512),
  `chunk_overlap` (number, default 50), `retrieval_top_k` (number, default 10),
  `retrieval_score_threshold` (number step 0.05, default 0.7), checkboxes
  `enable_hybrid_search` (default on), `enable_graph_rag` (default off).
- Submit payload sends `kbKey, kbName, description?, vectorResourceId: Number|"" → undefined,
  storageResourceId, embeddingModelId, chunkSize, chunkOverlap, retrievalTopK,
  retrievalScoreThreshold, enableHybridSearch, enableGraphRag`.

---

## 7. Tests

> **Status: ✅ COMPLETE (verified 2026-08-07).** Full suite **219/219 pass** (203 prior +
> 12 kb-service + 4 kb-pipeline). See `mysql/__tests__/kb-service.test.js` and
> `ingest/__tests__/kb-pipeline.test.js`. `transformItem` was exported from
> `ingest/pipeline.js` to allow the white-box assertions in §7.2 (the registry test
> chdirs to a temp dir like the ask-routes suite).
>
> E2E (script `m2-e2e.mjs`, run against `PORT=3100 node app.js`, then killed): **20/20 pass**
> — options → 400/404 scoping → create 201 → duplicate 409 → ingest 200 + concurrent
> second 409 (F11) → status indexing→**error** → row persisted `error` (D12) → no registry
> written (no successful run) → chunkSize 600 PUT persisted → delete 200 → get 404 → audit
> shows `kb.created/.updated/.deleted/.ingest.started/.ingest.failed`. The happy path
> (documentCount > 0) requires live Cloudflare credentials, which the environment lacks
> (F8 — resource provisioning is out of M2); the config-fallback guards were moved inside
> the status-flipping try so a missing bucket/index correctly ends in `error` + audit.

### 7.1 New: `mysql/__tests__/kb-service.test.js` (pure, no DB — mirrors
`catalog-service.test.js` / `credential-service.test.js`)

| # | Test |
|---|---|
| 1 | `validateKbInput` rejects missing kbKey / kbName |
| 2 | rejects kbKey with uppercase/spaces/underscore (`KB_KEY_RE`) |
| 3 | rejects kbKey < 3 or > 63 chars |
| 4 | rejects bad chunk_size (non-int, < 1, > 10000); accepts default 512 |
| 5 | rejects chunk_overlap ≥ chunk_size |
| 6 | rejects retrieval_top_k outside 1–100 |
| 7 | rejects threshold outside 0–1 (and non-numeric) |
| 8 | rejects non-integer resource/model ids |
| 9 | applies defaults (chunkSize 512, overlap 50, topK 10, threshold 0.7, hybrid true, graph false, isActive true) |
| 10 | accepts a fully valid input and returns the normalized value |
| 11 | `KB_KEY_RE` rejects null/empty and matches `my-kb-1` / `popularcert-kb` |
| 12 | `resolveGatewayCompany` (from `company-scope.js`, injected repo fake): unknown key → `{ error, status: 404 }`; known → `{ company }` |

Target: ~12 tests. Regression: full suite stays 203/203.

### 7.2 New: `ingest/__tests__/kb-pipeline.test.js` (pure — pipeline already injects adapters)

| # | Test |
|---|---|
| 13 | `transformItem(item, "pages", { r2Prefix: "kb/my-kb", chunkSize: 200 })` produces
     `r2_key` values under `kb/my-kb/pages/…` and no chunk exceeds 200 chars |
| 14 | default call (`r2Prefix "site"`, `chunkSize 1000`) matches the pre-M2 behavior |
| 15 | two KBs sharing one source URL yield distinct vector ids (F14) |
| 16 | `createRegistry(company, kbKey, { chunkSize: 512 })` fingerprint: same settings →
     not stale; settings change → all keys stale (F13); `countDocuments()` excludes `__meta` |

### 7.3 What we deliberately do NOT test (with reason)

- Repository SQL (needs live MariaDB — repo convention keeps `mysql/__tests__` DB-free).
- Route handlers (would need a real DB or a mocking lib the project doesn't have).
- Cloudflare R2/Vectorize calls — E2E checklist (§9) covers the fallback path live.

---

## 8. Docs sync (M2 closes with these updated)

> **Status: ✅ COMPLETE (verified 2026-08-07).** `docs/openapi.js` parses (43 paths, KB
> paths + `KnowledgeBase`/`KnowledgeBaseInput`/`KnowledgeBaseStatus` schemas added);
> `docs/AI_API_REFERENCE.md` has the "Gateway — Knowledge Bases" section + TOC entry;
> `docs/platform-buildout.md` untouched.

1. `docs/openapi.js` — add to `paths` (file structure verified; `paths` at line 120):
   - `/gateway/kbs`: GET, POST
   - `/gateway/kbs/{key}`: GET, PUT, DELETE
   - `/gateway/kbs/{key}/ingest`: POST
   - `/gateway/kbs/{key}/status`: GET
   - `/gateway/kbs/options`: GET
   - Minimal `schemas` (Kb, KbOptions, KbStatus) + 400/401/404/409 responses; keep
     `components` consistent.
2. `docs/AI_API_REFERENCE.md` — new "Gateway — Knowledge Bases" section after the Provider
   Catalog section: 7 routes, request/response shapes, company-header requirement, status
   payload semantics, KB→config fallback rules.
3. `docs/platform-buildout.md` — **no edits** (frozen).

---

## 9. Manual E2E verification checklist (run in order)

> **Status: ✅ EXECUTED (2026-08-07)** via `m2-e2e.mjs` against `PORT=3100 node app.js`
> — 20/20 checks pass, server killed after. Notes: the live env has no CF credentials /
> bucket / index for any company, so ingest exercises the **error path** (D12) rather than
> the happy path; the `indexing` observation is opportunistic (the error path flips in a few
> fast DB calls) and is proven deterministically by the `kb.ingest.*` audit rows + the row
> reaching `error`.

```bash
# 0. Preflight
node mysql/migrate.js --dry-run            # "No pending migrations" (M2 adds none)
node --test "config/__tests__/*.test.js" "query/__tests__/*.test.js" \
  "cron/__tests__/*.test.js" "ingest/__tests__/*.test.js" \
  "routes/__tests__/*.test.js" "mysql/__tests__/*.test.js"   # 203/203 + ~16 new

# 1. Server (own process on 3100 — port 3000 belongs to the user)
PORT=3100 node app.js > /tmp/rag3100.log 2>&1 &   # then /bin/kill -9 after

# 2. Auth (ADMIN_TOKEN = token from POST /auth/login, creds from .env, never print)
#    node -e script: fetch /auth/login → token → reuse for all calls below.

# 3. API
# 3a. options picklists
GET  /gateway/kbs/options  (x-company-name: popularcert)  → vectorResources [],
#     storageResources [], embeddingModels [text-embedding-3-small, text-embedding-3-large]
# 3b. company scoping
GET  /gateway/kbs                                     → 400 (no header)
GET  /gateway/kbs  (x-company-name: nosuchco)         → 404
# 3c. create + duplicate
POST /gateway/kbs  { kbKey: "popularcert-kb", kbName: "Popularcert KB",
      chunkSize: 400 }                                → 201 { kbId }
POST /gateway/kbs  same body                          → 409
# 3d. ingest (fallback path — no provider_resources rows exist, F8)
POST /gateway/kbs/popularcert-kb/ingest               → 200 started
POST /gateway/kbs/popularcert-kb/ingest               → 409 (already running)
#     poll GET /gateway/kbs/popularcert-kb/status while inProgress
#       → status: indexing → active; documentCount > 0; vectorCount > 0
#     confirm ./processed-popularcert-popularcert-kb.json exists (registry, F13)
#     confirm kb.status = 'active' in MySQL (persisted, D12)
# 3e. settings change re-chunks
PUT  /gateway/kbs/popularcert-kb  { chunkSize: 600 }  → 200
POST /gateway/kbs/popularcert-kb/ingest               → 200 (full re-ingest: registry
#     fingerprint differs — F13)
# 3f. delete + audit
DELETE /gateway/kbs/popularcert-kb                    → 200
GET  /gateway/kbs/popularcert-kb                      → 404
GET  /gateway/companies/popularcert/audit             → contains kb.* rows

# 4. UI
cd web && npm run build
# #kbs with a company selected → empty table + Create modal (kb_key prefilled popularcert-kb,
#   resource selects show only "Company default") → create → status badge 'active'
# open #kbs/popularcert-kb → Run Ingest → badge flips [indexing] → active; Status card
#   shows docs/vectors counts; Edit changes chunk_size; Delete confirms and returns to list

# 5. Cleanup
/bin/kill -9 <pid>    # never leave the test server running
```

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Empty `provider_resources`** (F8) — create modal selects empty, KBs can't pin resources | "Company default" option + config fallback in ingest; E2E runs the fallback path; resource provisioning is a later phase (documented) |
| **Embedding model mismatch** (F9) — catalog model not callable via CF | Only `@cf/` catalog models (in `EMBEDDING_DIMENSIONS`) override the config; anything else silently uses `company_config.EMBEDDING_MODEL`; UI preselects default |
| **chunk_size change not re-chunking** (F13) | Registry fingerprint (`__metaFingerprint`) forces full re-ingest on settings change |
| **Vector id collisions across KBs** (F14) | `kb/<kb_key>/` prefix enters the vector-id hash input |
| **Concurrent KB ingests / stop targeting** (F11) | `kbKey` in the job key + display; `startJob` guard returns 409 for the same KB |
| **Status staleness after restart** (D12) | KB `status` persisted on the row; in-memory job state only augments `inProgress` |
| **Pooled-connection transactions** (F4) | All multi-statement writers use `getConnection()` + begin/commit/rollback |
| **`knowledge_bases` has no last-sync/error columns** | `lastSyncAt` = `updated_at` (last status flip); live errors from job state; column additions deferred to a migration if the UI demands |
| **Cache key not KB-scoped** (D13) | Deliberate — no KB-bound ask path in M2; M3 adds `kb_key` to `query/cache.js` keys |
| **No migration in M2** (D15) | Tables exist; `kb_ingest_runs`/`kb_documents`/`knowledge_graph` land as migration `005` only when a phase needs them |

---

## 11. Effort estimate

| Step | Est. (AI) |
|---|---|
| company-scope.js + kb-service.js (validators) | 30–45 min |
| KbRepository + ModelRepository.listByCategory + Router Section 7 | 60–90 min |
| Ingest binding (lifecycle, jobs, ingest.js, pipeline, registry, services) | 90–120 min |
| Status endpoint + vector count | 30–45 min |
| Unit tests (~16) + regression | 30–45 min |
| api.js + routing + nav + KbList.jsx + KbDetail.jsx + modals | 90–120 min |
| Build + E2E checklist + docs sync | 45–60 min |
| **Total** | **~6–9 h** (vs 4–6 d human per doc §8) |
