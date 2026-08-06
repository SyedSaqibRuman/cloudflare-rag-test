# AGENTS.md

Guidance for working in this repository: the **PopularCert RAG API** — a multi-tenant Retrieval-Augmented Generation backend (Express 5, Node ESM) backed by Cloudflare Workers AI, Vectorize, and R2, plus a small React/Vite admin portal.

Good context sources before you dig in: `docs/AI_API_REFERENCE.md` (machine-readable API spec), `docs/architecture.md` (RAG pipeline), `docs/api/*.md`, and `README.md`. Note: `docs/getting-started.md` is partially **outdated** (see Gotchas).

---

## Commands

There are **no npm scripts in the root `package.json`** (`npm start` / `npm test` / `npm run lint` all fail). Run everything directly:

```bash
npm install                 # root deps (required for server + cron tests)
npm install-scripts ls      # list blocked install scripts; approve/deny per package
npm install-scripts approve <pkg>   # allow a blocked postinstall (e.g. esbuild, workerd)
npm install-scripts deny <pkg>      # keep a postinstall blocked (e.g. @scarf/scarf telemetry)
cd web && npm install       # admin portal deps
cd web && npm run build     # build UI into web/dist — REQUIRED or the server won't serve the dashboard
cd web && npm run dev       # Vite dev server on :5173, proxies /cloudflare, /ask, /_health → :3000

node app.js                 # start API server (port 3000, from env PORT)
```

Install scripts are gated by the `allowScripts` field in `package.json` (the `.npmrc` `allow-scripts` setting is ignored when that field exists). `@scarf/scarf` (telemetry) is deliberately denied; `esbuild`/`workerd` are approved. `npm audit` should report **0 vulnerabilities** — the `undici@7.29.0` override in `package.json` pins a transitive dep that has no upstream fix.

**Tests** — no test script exists; use `node --test` with explicit globs:

```bash
node --test "config/__tests__/*.test.js" "query/__tests__/*.test.js" "cron/__tests__/*.test.js" "ingest/__tests__/*.test.js" "routes/__tests__/*.test.js"

- 172/172 pass. The route tests (`routes/__tests__/ask-routes.test.js`) run the ask HTTP contract through a real express app with a **fake pipeline injected** via `createAskRouter({ pipeline })` — no network. They `process.chdir()` to a temp dir before importing config so `db/` is isolated; each test file runs in its own process so this can't leak.```

- Tests use the built-in `node:test` runner + `node:assert/strict` (no Jest/Mocha, no mocking libs).
- `query/__tests__/query-modules.test.js` (scoring, cache, intent) passes **with zero `node_modules` installed** — it only touches node builtins (`node:sqlite`, `crypto`, `node:test`). 86/86 pass.
- `cron/__tests__/cron-modules.test.js` **requires `npm install` first**: it pulls in `jobs.js → ingest.js`, which imports `dotenv`.
- **Never run bare `node --test`** — the default file matching grabs root-level scripts named like tests (`test.js`, `test-bot.js`, `test_upsert.js`, `vector_full_test.js`, `streamTest.js`), which need `.env`, network, and a live server, and will fail.

**Lint**: `eslint` is a devDependency but there is **no config file and no script** — effectively unused. Match existing style (2-space indent, JSDoc on exported helpers, `// --------` banner comments, emoji-prefixed console logs).

**Node version**: requires **Node 22.5+** for `node:sqlite` (`DatabaseSync`). Verified on v26.5.0.

---

## Architecture

### Server entry — `app.js`

- Serves both the API and the built admin portal (`web/dist`, checked at boot via `hasWeb`).
- CORS allowlist is hardcoded in `app.js` (`ALLOWED_ORIGINS` — popularcert.com domains + localhost).
- `requireCompany` middleware runs on `/ask` and `/ask-stream` (defined in `routes/ask.js`, the router that owns the ask HTTP contract): the `x-company-name` header is **mandatory** (400 if missing) and stored on `req.companyName`.
- Rate limiting (express-rate-limit, all env-tunable): global (all routes except `GET /`), AI tier on the ask endpoints, admin tier on `/cloudflare`. Gotcha in code: Express 5 doesn't apply middleware via `app.use(regex, fn)`, so the global limiter is a wrapper function.
- `/cloudflare` is mounted **twice**: `cronRoutes` first (scheduler endpoints, no limiter), then `cloudflareRoutes` with `adminLimiter`.
- SPA fallback: non-API GETs with `Accept: text/html` serve `web/dist/index.html`.
- `/api-docs` serves Swagger UI from the OpenAPI 3.0.3 spec in `docs/openapi.js`; raw JSON at `/api-docs/openapi.json`. Keep the spec in sync when routes change.
- `/_health` returns JSON health.

### RAG pipeline (all in `query/`)

```
intent fast-path (intent.js) → rewrite followup (llm.js, SMALL_LLM)
→ in-memory cache (cache.js) → embed question (services/cloudflare_embeddings.js)
→ vectorQuery top 10 (services/vectorize.js) → filter (≥75% of top score AND ≥0.5 abs)
→ hybridScore (85% vector + 15% keyword) → dedupeMatches (post_id/url/r2_key/id)
→ rerankMatches (RERANKING_MODEL, only if >3 matches) → top 5
→ fetch chunk JSON from R2 (metadata.r2_key) → buildContext (max 4000 chars, [Source N] labels)
→ LLM call (LLM_MODEL) → answer + sources
```

Key details:

- **`query/intent.js`**: regex fast-path. Greetings, identity, contact, discovery, office, help, blocked (poems/jokes/code), and vague queries return canned responses (`query/prompts.js` `buildResponses()`) without touching RAG. Vague detection is **English-only** (non-Latin scripts bypass).
- **`query/llm.js`**: `rewriteFollowup` only runs when history is non-empty (returns question unchanged otherwise); uses SMALL_LLM, `temperature: 0`; returns `INVALID` → falls back to original question. `MAX_HISTORY = 6` caps conversation context.
- **`query/cache.js`**: in-memory Map, MD5 key of `company:rewrittenQuestion`, 60-min TTL, max 200 entries with FIFO eviction, lost on restart. Cached answers include `cached: true`.
- **`query/answer.js`**: `askQuestion` (JSON) uses the `cloudflare` SDK client (`cfClient.ai.run`); `askQuestionStream` calls the CF REST endpoint **directly with raw `fetch`** (`stream: true`), parses SSE via `stream-contract.createSseParser`, emits tokens through the transport. 30s timeout combined with the client abort signal via `AbortSignal.any` (transport-owned). The CLI REPL lives in `query/cli.js` (`node query/cli.js`) — the pipeline module has no readline/dotenv dependency.
- **SSE wire protocol** (matches `web/src/api.js` parser): tokens as `data: {"token":"..."}\n\n`, a `__START_RESPONSE__` sentinel token before the first real token (frontend uses it to clear the "Thinking..." state), `data: [DONE]\n\n` terminator, errors as `data: {"error":"..."}\n\n`.
- **`query/context.js`**: `sanitizeText` strips prompt-injection phrases (`ignore previous instructions`, `system prompt`, …).

### Multi-tenant config (`config/`)

- `config/index.js` is a **facade** — it is the sanctioned import path (`getConfig`, `runtimeConfig`, `saveConfig`, company CRUD, validation, prompt variable resolution). Don't import `config/store.js` internals directly from routes.
- **Persistence is SQLite** (`node:sqlite` `DatabaseSync`), one file per company: `db/<company>.db` with a `key/value` table, JSON-encoded values. `db/` is gitignored.
- On boot (`config/store.js`): migrates a legacy `runtime-config.json` if present (then deletes it). **No default company is seeded — blank slate**; companies are created explicitly via `POST /cloudflare/companies` (admin portal → Companies page). `runtimeConfig` is a singleton loaded **once at import time** and mutated in place; every mutation must go through `saveConfig` to persist.
- Allowed keys are whitelisted in `config/schema.js` (`COMPANY_KEYS`: 4 models, `EMBEDDING_DIMENSIONS`, 4 URLs, `CONSULTANT_NAME`, `COMPANY_NAME`, `SYSTEM_PROMPT`, `VECTOR_INDEX`, `R2_BUCKET_NAME`, plus 6 `CREDENTIAL_KEYS`).
- **Credentials are per-company, stored in the company's SQLite config** (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_TOKEN_VALUE`, `R2_JURISDICTION_END_POINT`), **encrypted at rest** (AES-256-GCM, `config/encryption.js`, master key `APP_ENCRYPTION_KEY` from `.env`, generate with `openssl rand -hex 32`). Encryption happens at the persistence boundary (`config/sqlite.js` encrypts on save, decrypts on load), so `runtimeConfig` holds plaintext **in memory only** and the `db/*.db` files hold `gcm:` blobs. Legacy plaintext values from before encryption pass through unchanged and get encrypted on the next save; setting the key later decrypts nothing retroactively. If `APP_ENCRYPTION_KEY` is unset, values stay plaintext (backwards compatible) with a boot warning. **Nothing is seeded from env** — new companies start with empty credentials, entered per company (Config page → "Cloudflare Credentials" card / `PUT /cloudflare/companies/:name`). Resolution happens via `resolveCreds(companyName)` (`config/creds.js`): reads the company's SQLite config **only** (no `process.env` fallback) and throws `Company 'x' not found` if the company doesn't exist. `client.js` returns **per-company cached** Cloudflare/S3 clients (`getCFClient(companyName)`, `getS3Client(companyName)`); callers must thread `companyName` through. `config/creds.js` ↔ `config/store.js` used to have a circular import — `store.js` imports only `schema.js` + `encryption.js`, keep it that way (ESM TDZ).
- Models are validated against `ALLOWED_MODELS`; changing `EMBEDDING_MODEL` auto-sets `EMBEDDING_DIMENSIONS` from the `EMBEDDING_DIMENSIONS` map (route + `config/company.js` + `config/legacy.js`).
- Company names and resource names (`VECTOR_INDEX`, `R2_BUCKET_NAME`) must match `/^[a-z0-9-]+$/`, 3–63 chars (validation in `config/validation.js`).
- `GET/PUT /cloudflare/config` and `GET/PUT /cloudflare/prompt` take the company via `x-company-name` header **or** `?company=` query / `body.company`.
- System prompts use `{{VARIABLE}}` templating, resolved via `resolvePromptVariables` (`config/prompts.js`).

### Ingestion (`ingest.js` + `services/` + `utils/`)

- WordPress REST API source (`services/wp.js`): `/wp-json/wp/v2/pages|posts`, `per_page=100`, pagination via `X-WP-TotalPages` header, 300ms delay.
- Per post: `cleanContent` (HTML→Markdown, turndown) → `chunkMarkdown` (`utils/chunker.js`) → `enforceChunkSize` (max 1000 chars) → filter chunks < 40 chars → upload chunk JSON to R2 under `site/<type>/<slug>/chunk-N.json` → `upsertVectors` in batches of 100 → record `modified` date in the registry (`processed-<company>.json` at repo root) so unchanged posts are skipped.
- **Abortable everywhere**: `checkAbort(signal)` at every loop boundary; `retry(fn, retries, delay, signal)` never retries `AbortError` and its sleep is interruptible (`utils/helpers.js`). Job handlers receive `{ signal, companyName }`.
- Embeddings (`services/cloudflare_embeddings.js`): raw fetch to CF REST, batch size 4, concurrency 2, 5 retries with exponential backoff on 429; results array is pre-allocated so ordering is preserved (failed batches become `null`).
- Vectorize (`services/vectorize.js`): SDK-based CRUD; upsert requires `chunk.id`, `chunk.r2_key`, `chunk.text` (throws otherwise) and dimension-validates embeddings. Metadata indexed: `r2_key, title, url, type, slug, chunkIndex`. Has a hardcoded `DIMENSIONS = 768` fallback. **`services/vectorize.old.js` is a stale legacy copy — don't use it.**

### Scheduler (`cron/` + `routes/cron.js` + `jobs.js`)

- Job registry: `jobs.js` (`testing`, `ingest`); handlers receive `{ signal, companyName }`.
- Standalone jobs (`cron/standalone.js`): run immediately in background, tracked in `standaloneJobs` Map keyed `jobId:companyName` (`_default` if no company), max 6 concurrent (`MAX_CONCURRENT_JOBS`), abortable, entries deleted on completion.
- Cron (`cron/scheduler.js`): `node-cron`, same keying/limits, skips overlapping ticks.
- Endpoints (all under `/cloudflare`): `/presets` CRUD (SQLite `db/presets/app.db`, seeded with 4 defaults — kept in a subdir so company discovery ignores them), `/job/start`, `/job/stop`, `/cron/start`, `/cron/stop`, `/jobs`, `/jobs/running`, `/status`.

### Admin portal (`web/`)

- React 18 + Vite 6 + Tailwind 4, hash-based routing (`#dashboard`, `#ask`, `#companies`, `#config`, `#prompt`, `#cloudflare`, `#scheduler`) via `useHashRoute`.
- Company selection lives in `CompanyProvider` (`web/src/context.jsx`), persisted in `localStorage` under **`pc_selected_company`**; every API call attaches `x-company-name` (`web/src/api.js`).
- Theme switcher is a Radix dropdown (`web/src/components/theme-toggle.jsx` + `dropdown-menu.jsx`, dep `@radix-ui/react-dropdown-menu`) in the Layout header. Preference (`light`/`dark`/`system`) persists in `localStorage` under **`pc_theme`** (default `system`); the blocking script in `web/index.html` and `Layout.jsx` both resolve it against `prefers-color-scheme` and toggle the `.dark` class. `@utility menu-enter/menu-exit` in `index.css` drive the open/close animation (reduced-motion respected via the global media query).
- `web/src/models.js` **duplicates** `config/schema.js` model lists — keep them in sync when adding models.
- Vite dev server allows hosts `*.monkeycode-ai.live`.

---

## Gotchas (non-obvious, learned the hard way)

1. **Admin auth is opt-in via `.env`.** When `ADMIN_USERNAME` and `ADMIN_PASSWORD` are both set (see `.env.example`), `POST /auth/login` issues an HMAC-signed session token (12h default, `ADMIN_TOKEN_TTL_HOURS`), `requireAdmin` (`auth.js`) gates **all** `/cloudflare/*` routes (cron + admin) and the portal shows a login page (`web/src/pages/Login.jsx`). Tokens travel via `Authorization: Bearer` or `x-auth-token`. **If either env var is unset, auth is disabled and every route stays open** (backwards compatible) — `GET /auth/me` reports `authenticated: true` and the portal skips login. Legacy `ADMIN_API_KEY` is still defined but never enforced. Note: `docs/AI_API_REFERENCE.md` / `getting-started.md` may still describe the old `x-api-key` auth claim — routes are only protected when the login env vars are set.
2. **Per-company ask API keys** (`API_KEY`, stored in the company's SQLite config): generated/revoked via `POST|DELETE /cloudflare/companies/:name/apikey` (admin portal "Ask API Key" card in `Config.jsx`). When set, **only** `POST /ask` and `POST /ask-stream` are gated (middleware `requireAskApiKey` in `routes/ask.js`): the request must send `x-api-key` (or `Authorization: Bearer`) matching, and browser requests (Origin/Referer present) must come from the company's domain — `x-company-name` maps to `<company>.com` plus subdomains (`popularcert` → `popularcert.com`, `www.popularcert.com`, …). Companies without a key stay open (backwards compatible). The key value is never returned by GET endpoints (`/config` exposes only `AUTH.API_KEY_ENABLED`; `GET /companies/:name` redacts it and returns `hasApiKey`). CORS is now dynamic: static allowlist + any `<company>.com`/subdomain origin derived from the runtime company list, plus localhost for dev.
3. **Blank slate — no default company, no env credentials.** Companies are created via the admin portal (Companies page) or `POST /cloudflare/companies`; each gets its own `db/<company>.db` with default model/URL values and **empty credentials**, filled in per company (Config page → "Cloudflare Credentials" card or `PUT /cloudflare/companies/:name`). `resolveCreds(companyName)` reads only the company's SQLite config (no `process.env` fallback) and throws for unknown companies; index/bucket routes and `/ask` return a **400 `Company 'x' not found`** for those. `.env` is used only for app-level settings (`PORT`, `NODE_ENV`, `ADMIN_API_KEY`, `RATE_LIMIT_*`, `DELAY_MS`, `BATCH_SIZE`) — never for company config. `docs/getting-started.md` may still describe the old env-seeded flow.
4. **Root `package.json` has only `start` (`node app.js`) and `dev` (nodemon) scripts.** No test, no lint. Use `node app.js` and the `node --test` glob above.
5. **Bare `node --test` fails** on root-level `*test*` files that need credentials/network/live server (see Commands).
6. **`reset.js` is broken**: it calls `deleteVectorIndex()` / `createVectorIndex()` / `clearBucket()` with no arguments, but all three require arguments (`name`, `companyName`+`dimensions`, `bucketName`). It will throw if run.
7. **Docs drift**: `docs/getting-started.md`'s project-structure section still describes old single-file modules (`config.js`, `query.js`, `cron.js`) that are now `config/`, `query/`, `cron/` directories; `docs/architecture.md`'s CORS list omits `staging.popularcert.com` and `www.popularcert.com` (present in `app.js`).
8. **Config is loaded once at process start** (runtime singleton). Editing `db/*.db` while the server runs has no effect; changing a company's config via the API mutates the singleton and persists synchronously.
9. **Vector index dimensions must match `EMBEDDING_DIMENSIONS`** for the company's `EMBEDDING_MODEL`, or upserts fail with "Invalid embedding detected". Changing `EMBEDDING_MODEL` on a populated index means re-ingesting (or recreating the index).
10. **History is capped at 6 messages** (`MAX_HISTORY`) and query rewriting only happens when history is non-empty.
11. **`processed-<company>.json` is the ingestion registry** (gitignored except the committed `processed-maxicert.json`). Deleting it forces full re-ingest; `content/` holds per-post Markdown from ingestion.
12. Console logging is gated on `NODE_ENV !== "production"` in the query path; file logs (`utils/logger.js`, `logs/`) are async/batched, rotate once per session at 5MB, and are always written.
13. The web dashboard is only served if `web/dist` exists at boot (`hasWeb` check). After pulling new UI changes, rebuild before restarting the server.
14. Emojis in log strings (`✅`, `❌`, `⚠️`) and `// ------` banner comments are the house style — keep it when editing existing files.

---

## Repo map (quick orientation)

```
app.js                     Express server: middleware, rate limits, /ask, /ask-stream, /test, SPA
env.js                     Frozen env accessor (dotenv) — import { env } from "./env.js"
client.js                  Shared Cloudflare SDK + S3 clients (singletons)
ingest.js                  WP → Markdown → chunks → R2 → Vectorize pipeline (abortable)
jobs.js                    Job registry for scheduler (testing, ingest)
streamTest.js              LLM stream smoke test (used by POST /test)
config/                    Multi-tenant config: schema, SQLite store, validation, prompts, company CRUD, write path (updateConfig/reset), presets
query/                     RAG pipeline: intent, llm, cache, retrieval, scoring, reranker, context, prompts, answer, cli (REPL), stream-contract (wire protocol + SSE parser)
services/                  cloudflare_embeddings, vectorize (+ stale .old), r2, wp
utils/                     chunker, cleaner, fileWriter, helpers (retry/abort/chunkArray/sleep), logger
routes/                    ask.js (POST /ask, /ask-stream — company gate, API-key gate, AI limiter, SSE contract), cron.js (scheduler + presets API), cloudflare.js (companies/indexes/buckets/config/prompt)
cron/                      standalone.js, scheduler.js, state.js, status.js
web/                       React admin portal (Vite); build into web/dist
docs/                      architecture, API references, models, getting-started (partially stale), openapi.js (Swagger/OpenAPI spec)
```
