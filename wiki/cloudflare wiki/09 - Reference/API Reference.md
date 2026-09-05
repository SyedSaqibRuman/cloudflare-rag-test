---
type: reference
status: active
area: reference
tags: [api]
related:
  - "[[Routes Map]]"
  - "[[Answer Streaming]]"
---

# API Reference

Coverage policy: **verified wire details only**; everything else points to [[Routes Map]] + live OpenAPI UI at /api-docs (spec source `docs/openapi.js`). Base URL = same origin (dev Vite proxy).

## Global envelope

- Success: `{ success: true, ...payload }` · Typed failure: `{ success:false, error, code?, errors? }` ([[Error Handling]] taxonomy).
- Auth modes: admin Bearer token vs per-company ask key ([[Authentication Flow]], [[Ask API Keys]]); rate-limit headers standard on limited routes.

## POST /auth/login
- Purpose: issue admin HMAC token.
- Auth: none; brute-force limiter **10/min**.
- Body: `{ username, password }` strings.
- 200: `{ success:true, token, expiresIn }`.
- Errors: 503 auth disabled · 400 missing fields · 401 invalid creds · 429 limit.

## GET /auth/me
- Purpose: portal boot session check (fail-closed).
- Auth: optional Bearer.
- Response shape consumed by portal: `{ authenticated: boolean, username? }` (`authenticated:true` also when admin auth intentionally disabled).

## POST /ask
- Purpose: RAG JSON answer.
- Auth chain: `x-company-name`(400 unknown) → optional company key (401) → AI limiter **20/min** (429).
- Body: `{ question: string(non-empty trim), history?: [{role,content}] }` else 400s.
- 200 payload fields: `answer` (markdown string; may be canned fast-path text), `sources[] {title,score}`, `matches[]` (full vector matches incl metadata), `graph` `{context,cypher}|null`, `cached:boolean`, `possibleQuestions:string[]`. Client disconnect aborts silently (no 5xx).

## POST /ask-stream
Same gates/validation; SSE contract table lives in [[Answer Streaming]] (frames + `[DONE]` + error-in-band after headers flush).

## POST /ask/reset
- Purge tenant's cached answers → `{ success:true, cleared: <n> }`; no AI limiter.

## Health

| Path | Shape essentials |
|---|---|
| `GET /_health` | probes MySQL(skip-if-unconfigured)/Vectorize/R2 first credentialed tenant, 5s cap each → `{success,status:"healthy|degraded|unhealthy",…}` HTTP 503 when unhealthy |
| `GET /_health/detailed` | adds per-probe latency breakdown |

## /cloudflare/* (×requireAdmin)

| Endpoint | Verified notes |
|---|---|
| `GET /companies` | enriched rows (assistant display name resolved best-effort) |
| `POST /companies` | `{name}` → tenant + defaults; duplicate-safe 4xx handled in service |
| `GET/PUT/DELETE /companies/:name` | PUT takes partial COMPANY_KEYS patch; DELETE removes both store backends |
| `POST /companies/:name/reset` | tenant defaults reset |
| `POST/DELETE/GET /companies/:name/apikey` | generate-once/revoke/status ([[Ask API Keys]]) |
| `GET/PUT /config`, `POST /config/reset` | company via header (?company/body fallback); PUT validates whitelisted keys, dims auto-follow model swap |
| `GET/PUT /prompt`, `POST /prompt/reset` | SYSTEM_PROMPT template + resolved preview in GET |
| `GET /indexes` · `POST /indexes {name,dimensions?}` · `DELETE /indexes/:name` | SDK-backed provisioning honoring existing |
| `GET /buckets` · `POST /buckets {name}` · `DELETE /buckets/:name` · `POST /buckets/:name/clear` | clear paginates deletes |

## Scheduler (`routes/cron.js`)

presets CRUD; `POST /job/start {jobId, companyName?, kbKey?, maxPages?, scope?}`; `POST /job/stop {jobId, companyName?}`; `POST /cron/start {jobId, companyName?, schedule}`; `POST /cron/stop`; `GET /jobs|jobs/running|status` ([[Scheduler]] semantics incl guards messages).

## /gateway/* (requireAdmin + inner 503 gate)

Full CRUD catalog exists (~90 routes). Spot-verified contracts:

### POST /companies/:key/execute/chat
Body: `{ credentialId? | providerKey(+credentialKey?+environmentKey?), model?, messages:[{role,content}], options? }` → `{ success:true, providerKey, model, credentialId, content-shape normalized OpenAI-style… }` (raw + companyId stripped server-side). Always audit-logged.

### POST /companies/:key/execute/embeddings
Body analogous with `texts:string[]` → vector arrays normalized per executor translators.

### GET /kbs/options
→ `options:{vectorResources[], storageResources[], graphResources[], embeddingModels[], liveVectorResources[], liveStorageResources[]}` mixing registry rows + real account resources.

### Other groups
providers(models nested,endpoints,pricing,import) · credentials(lifecycle+verify+rotate+model-access) · resources(provision/live-list) · kbs operations · assistants CRUD · ingestion control · health — paths inventoried in [[Routes Map]]; field-level detail consult openapi.json or handler source before coding against them.
