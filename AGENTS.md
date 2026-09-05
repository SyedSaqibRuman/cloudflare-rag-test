# AGENTS.md

Guidance for working in this repository: the **PopularCert RAG API** — a multi-tenant Retrieval-Augmented Generation backend (Express 5, Node ESM) backed by Cloudflare Workers AI, Vectorize, and R2, plus a small React/Vite admin portal.

> **📚 Knowledge base:** `wiki/cloudflare wiki/` is the project's **Obsidian vault** — start at `wiki/cloudflare wiki/00 - Home/Home.md`. For any significant change: read the relevant wiki pages first, inspect the code second, update affected wiki pages (feature/architecture/API/data/ADR, plus `08 - Decisions/Change Log.md`) as part of finishing the work. Validate links with `node scripts/validate-wiki.mjs`.

Good context sources before you dig in: `docs/AI_API_REFERENCE.md` (machine-readable API spec), `docs/architecture.md` (RAG pipeline), `docs/api/*.md`, and `README.md`. Note: `docs/getting-started.md` is partially **outdated** (see Gotchas).

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels used verbatim (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

---

## Commands

Run everything directly:

```bash
npm install                 # root deps (required for server + cron tests)
npm test                    # full test suite (see Tests below)
npm run lint                # eslint (flat config in eslint.config.js — see Lint below)
npm install-scripts ls      # list blocked install scripts; approve/deny per package
npm install-scripts approve <pkg>   # allow a blocked postinstall (e.g. esbuild, workerd)
npm install-scripts deny <pkg>      # keep a postinstall blocked (e.g. @scarf/scarf telemetry)
cd web && npm install       # admin portal deps
cd web && npm run build     # build UI into web/dist — REQUIRED or the server won't serve the dashboard
cd web && npm run dev       # Vite dev server on :5173, proxies /cloudflare, /ask, /_health → :3000

node app.js                 # start API server (port 3000, from env PORT)
node mysql/migrate.js       # apply MySQL schema migrations (001_init, 002_company_config)
```

Set `CONFIG_STORE=mysql` in `.env` to store all company/AI/RAG config in MySQL (the default is SQLite files in `db/`). On the first boot with the MySQL backend, existing SQLite companies are auto-lifted into MySQL.

Install scripts are gated by the `allowScripts` field in `package.json` (the `.npmrc` `allow-scripts` setting is ignored when that field exists). `@scarf/scarf` (telemetry) is deliberately denied; `esbuild`/`workerd` are approved. `npm audit` should report **0 vulnerabilities** — the `undici@7.29.0` override in `package.json` pins a transitive dep that has no upstream fix.

**Tests** — run the full suite with `npm test` (all module groups, incl. the pure-ESM web catalog tests):

```bash
npm test
```

(The script is the equivalent of `node --test` with explicit globs for every `__tests__` dir — `config`, `query`, `cron`, `ingest`, `routes`, `mysql`, `web/src/**`.)

- 504/504 pass. The route tests (`routes/__tests__/ask-routes.test.js`) run the ask HTTP contract through a real express app with a **fake pipeline injected** via `createAskRouter({ pipeline })` — no network. They `process.chdir()` to a temp dir before importing config so `db/` is isolated; each test file runs in its own process so this can't leak. The `mysql/__tests__/credential-service.test.js` suite (encrypt/decrypt/rotate/validate) is pure crypto — no MySQL needed; `catalog-importer-replace.test.js` (importer `replaceChildren` delete semantics) runs against a fake connection injected through the importer's `opts.getPool` test seam — no MySQL, no flags. `routes/__tests__/auth.test.js` covers `extractToken` (header / Bearer / docs-cookie priority).

- Tests use the built-in `node:test` runner + `node:assert/strict` (no Jest/Mocha, no mocking libs).
- `query/__tests__/query-modules.test.js` (scoring, cache, intent) passes **with zero `node_modules` installed** — it only touches node builtins (`node:sqlite`, `crypto`, `node:test`). 86/86 pass.
- `cron/__tests__/cron-modules.test.js` **requires `npm install` first**: it pulls in `jobs.js → ingest.js`, which imports `dotenv`.
- `web/src/**/__tests__/*.test.js` (catalog card-gating + error-tag helpers) is pure ESM like the query modules — no JSX, no node_modules needed.
- **Never run bare `node --test`** — the default file matching recurses and grabs the ad-hoc scripts under `scripts/` named like tests (`test.js`, `test-bot.js`, `test_upsert.js`, `vector_full_test.js`, `streamTest.js`), which need `.env` and network (or a live server) and will fail. `node scripts/test.js` on its own is fine — it's the MySQL connection test.

**Lint**: `npm run lint` runs eslint with the flat config in `eslint.config.js` (ESLint 10, `@eslint/js` recommended + `eslint-plugin-react-hooks` for the portal). One config covers the Node ESM backend (`globals.node`) and the React portal (`globals.browser` + JSX); `scripts/**` (ad-hoc CJS dev tools) and build/artifact dirs are ignored. `varsIgnorePattern: "^_"` permits the codebase's intentional `_ignored` destructure-rename convention. Match existing style (2-space indent, JSDoc on exported helpers, `// --------` banner comments, emoji-prefixed console logs).

**Node version**: requires **Node 22.5+** for `node:sqlite` (`DatabaseSync`). Verified on v26.5.0.

---

## Architecture

### Server entry — `app.js`

- Serves both the API and the built admin portal (`web/dist`, checked at boot via `hasWeb`).
- CORS allowlist is hardcoded in `app.js` (`ALLOWED_ORIGINS` — popularcert.com domains + localhost).
- `requireCompany` middleware runs on `/ask` and `/ask-stream` (defined in `routes/ask.js`, the router that owns the ask HTTP contract): the `x-company-name` header is **mandatory** (400 if missing) and stored on `req.companyName`.
- Rate limiting (express-rate-limit, fixed defaults — no env vars): global 100/min (all routes except `GET /`), AI tier 20/min on the ask endpoints, login brute-force guard 10/min on `POST /auth/login`. **Admin routes are not rate-limited**: authenticated admin sessions bypass the global baseline too (the wrapper checks `verifyToken(extractToken(req))`), so heavy portal/catalog work never 429s. Gotcha in code: Express 5 doesn't apply middleware via `app.use(regex, fn)`, so the global limiter is a wrapper function.
- `/cloudflare` is mounted **twice**: `cronRoutes` first (scheduler endpoints, no limiter), then `cloudflareRoutes` (also no limiter — admin sessions are exempt).
- SPA fallback: non-API GETs with `Accept: text/html` serve `web/dist/index.html`.
- `/api-docs` serves Swagger UI from the OpenAPI 3.0.3 spec in `docs/openapi.js`; raw JSON at `/api-docs/openapi.json`. Keep the spec in sync when routes change. Gated by `requireAdmin` (like everything admin). The portal opens the docs in a new tab, which can't set headers — at login the frontend mirrors the session token into a **path-scoped cookie** (`pc_admin_token`, path `/api-docs`, SameSite=Lax, never HttpOnly; `extractToken` in `auth.js` reads it last); a Swagger `requestInterceptor` re-attaches it as `Authorization: Bearer` to every "Try it out" call.
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
- **`query/graph.js`** (GraphRAG, optional): when a company has `NEO4J_URI`/`NEO4J_USERNAME`/`NEO4J_PASSWORD` (+ optional `NEO4J_DATABASE`) in its config store, the ask path retrieves knowledge from the company's Neo4j graph. **Phase 4 knowledge-aware path (primary)**: fixed-template queries (nothing LLM-supplied is interpolated) — `detectEntityMentions` (entities whose name/alias appears in the question, word-boundary filtered, company-scoped, optionally `kbKey`-scoped) → `fetchEntityNeighborhood` (typed edges + **accepted** claims with evidence, confidence >= 0.5) → `formatGraphKnowledge` (dedupes edge/claim pairs merging evidence, sorts by confidence, 2500-char budget) → `[Graph Knowledge]` context. **Cypher fallback** for structural questions: fetch schema → LLM `generateCypher` → `isSafeCypher` (requires a MATCH/UNWIND/OPTIONAL MATCH start, rejects CREATE/MERGE/DELETE/SET/REMOVE/DROP/FOREACH/CALL/LOAD CSV and multi-statement queries) → execute in a READ transaction (`session.executeRead`). Best-effort by design — any failure (bad config, LLM, network, invalid Cypher) yields no graph context, never an ask error; `neo4j-driver` is lazy-imported so modules without it still load. `getGraphConfig(company, database?)` accepts a database override — a selected assistant's `graph_resource_id` wins over the stored `NEO4J_DATABASE`, and `retrieveGraphContext(question, company, { enabled, database })` skips the step when the assistant has graph context off.
- **`query/assistant.js`** (assistant persona, optional): when a company has `ASSISTANT_KEY` set in its config store, the ask path resolves the selected gateway assistant (MySQL, lazy-imported so the module loads with zero deps) and overrides the pipeline persona — `system_prompt`, `model` (only `@cf/`/`@cloudflare/` models are runnable — see `isRunnableModel`), `temperature`/`max_tokens`, the primary KB's `vector_external_id` (retrieval index override), and the graph resource (`graph_database` → database name + `enable_graph_context` gate). Best-effort: unknown/inactive assistant, missing MySQL, or any DB error yields `null` overrides and the company defaults apply. The cache key includes the assistant key so switching assistants never serves stale answers. Set via the Config page's Assistant dropdown (`ASSISTANT_KEY`, validated `[a-z0-9-]` 3–63) — resources on the Config page (vector index / storage bucket / graph DB) list provisioned rows from **every** provider plus live Cloudflare account resources (`/gateway/kbs/options` now also returns `graphResources`).
- **`query/cache.js`**: in-memory Map, MD5 key of `company:rewrittenQuestion`, 60-min TTL, max 200 entries with FIFO eviction, lost on restart. Cached answers include `cached: true`. Entries are tagged with their company so `clearCompanyCache(company)` (POST `/ask/reset`) can purge one tenant's answers.
- **`query/answer.js`**: `askQuestion` (JSON) uses the `cloudflare` SDK client (`cfClient.ai.run`); `askQuestionStream` calls the CF REST endpoint **directly with raw `fetch`** (`stream: true`), parses SSE via `stream-contract.createSseParser`, emits tokens through the transport. 30s timeout combined with the client abort signal via `AbortSignal.any` (transport-owned). The CLI REPL lives in `query/cli.js` (`node query/cli.js`) — the pipeline module has no readline/dotenv dependency.
- **SSE wire protocol** (matches `web/src/api.js` parser): tokens as `data: {"token":"..."}\n\n`, a `__START_RESPONSE__` sentinel token before the first real token (frontend uses it to clear the "Thinking..." state), `data: [DONE]\n\n` terminator, errors as `data: {"error":"..."}\n\n`.
- **`query/context.js`**: `sanitizeText` strips prompt-injection phrases (`ignore previous instructions`, `system prompt`, …).

### Multi-tenant config (`config/`)

- `config/index.js` is a **facade** — the sanctioned import path (`getConfig`, `runtimeConfig`, `saveConfig`, `initConfig`, company CRUD, validation, prompt variable resolution). Don't import `config/store.js` internals directly from routes.
- **Persistence backend selected by `CONFIG_STORE`** (`.env`): `mysql` stores companies in the `companies` + `company_config` tables (migration `002_company_config.sql`); unset/`sqlite` uses one SQLite file per company: `db/<company>.db` (`key/value` table, JSON-encoded values, `db/` gitignored). `config/schema.js` defaults are hardcoded — nothing is seeded from env.
- **Boot-time load (`config/store.js`)**: `initConfig()` runs in `app.js` and `query/cli.js` **before the server listens** — MySQL reads are async, so the `runtimeConfig` singleton is populated there and then stays synchronous for the whole pipeline. On first MySQL boot, existing `db/` companies are auto-lifted into MySQL (`🔄 Migrated N company config(s)…`) **only when the MySQL companies table is empty** — never overwrites. A legacy `runtime-config.json` is still migrated (then deleted). **No default company is seeded — blank slate**; companies are created via `POST /cloudflare/companies` (admin portal → Companies page).
- **Write path is async, persist-first**: `saveConfig` / `createCompany` / `updateCompany` / `deleteCompany` / `setCompanyApiKey` / `updateConfig` / `reset*` `await` the backend **before** mutating `runtimeConfig`, so a failed write returns `{ error }` and leaves memory untouched (deletes restore the original entry). All route handlers that call them are `async`. Reads (`getCompanyConfig`, `getConfig`, `resolveCreds`) stay synchronous over the in-memory singleton.
- Allowed keys are whitelisted in `config/schema.js` (`COMPANY_KEYS`: 4 models, `EMBEDDING_DIMENSIONS`, 4 URLs, `CONSULTANT_NAME`, `COMPANY_NAME`, `SYSTEM_PROMPT`, `GUARDRAIL_PROMPT` + `BLOCKED_TOPICS` (company-level guardrail **fallbacks** — the UI edits guardrails per assistant on the Assistants page; `assistants.guardrail_prompt`/`assistants.blocked_topics` columns win at ask time via `resolveAssistantOverrides` → `getSystemMessage`'s guardrail override + the pre-retrieval blocked check in `runPipeline`), `VECTOR_INDEX`, `R2_BUCKET_NAME`, plus 6 `CREDENTIAL_KEYS`).
- **Credentials are per-company** (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_TOKEN_VALUE`, `R2_JURISDICTION_END_POINT`, plus GraphRAG's `NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD` / `NEO4J_DATABASE`), **encrypted at rest** (AES-256-GCM, `config/encryption.js`, master key `APP_ENCRYPTION_KEY` from `.env`, generate with `openssl rand -hex 32`). `config/codec.js` is the shared encode/decode layer used by both backends, so SQLite and MySQL store identical `gcm:` blobs; plaintext exists **in memory only**. Legacy plaintext values pass through unchanged and get encrypted on the next save. If `APP_ENCRYPTION_KEY` is unset, values stay plaintext (backwards compatible) with a boot warning. **Nothing is seeded from env** — new companies start with empty credentials, entered per company via the gateway connections on the Providers page: `mysql/services/rag-sync.js` mirrors a connection's fields into the RAG store on create/update/rotate (`syncRagCredentials`) and clears them on delete when no other connection still provides them (`clearRagCredentials`; `backfillRagCredentials` recomputes from all connections). Only fields the RAG pipeline consumes are mapped: `api_token`→`CLOUDFLARE_API_TOKEN`, `account_id`→`CLOUDFLARE_ACCOUNT_ID`, `access_key_id`→`R2_ACCESS_KEY_ID`, `secret_access_key`→`R2_SECRET_ACCESS_KEY` (`R2_TOKEN_VALUE`/`R2_JURISDICTION_END_POINT` are unused at runtime and not synced). Neo4j connections map `uri`/`username`/`password`→`NEO4J_URI`/`NEO4J_USERNAME`/`NEO4J_PASSWORD` (scoped to `providerKey === 'neo4j'`), and the `graph_database` resource's `config.database_name`→`NEO4J_DATABASE` (synced on resource create/update/delete via `syncRagResource`/`clearRagResource`). The API path still works too (`PUT /cloudflare/companies/:name`). Resolution via `resolveCreds(companyName)` (`config/creds.js`): reads the company's stored config **only** (no `process.env` fallback) and throws `Company 'x' not found` for unknown companies. `client.js` returns **per-company cached** Cloudflare/S3 clients (`getCFClient(companyName)`, `getS3Client(companyName)`); callers must thread `companyName` through. `config/creds.js` ↔ `config/store.js` used to have a circular import — `store.js` imports only `schema.js` + `encryption.js` + backend modules, keep it that way (ESM TDZ).
- Models are validated against `ALLOWED_MODELS`; changing `EMBEDDING_MODEL` auto-sets `EMBEDDING_DIMENSIONS` from the `EMBEDDING_DIMENSIONS` map (route + `config/company.js` + `config/legacy.js`).
- Company names and resource names (`VECTOR_INDEX`, `R2_BUCKET_NAME`) must match `/^[a-z0-9-]+$/`, 3–63 chars (validation in `config/validation.js`).
- `GET/PUT /cloudflare/config` and `GET/PUT /cloudflare/prompt` take the company via `x-company-name` header **or** `?company=` query / `body.company`.
- System prompts use `{{VARIABLE}}` templating, resolved via `resolvePromptVariables` (`config/prompts.js`).

### Ingestion (`ingest.js` + `services/` + `utils/`)

- WordPress REST API source (`services/wp.js`): `/wp-json/wp/v2/pages|posts`, `per_page=100`, pagination via `X-WP-TotalPages` header, 300ms delay.
- Per post: `cleanContent` (HTML→Markdown, turndown) → `chunkMarkdown` (`utils/chunker.js`) → `enforceChunkSize` (max 1000 chars) → filter chunks < 40 chars → upload chunk JSON to R2 under `site/<type>/<slug>/chunk-N.json` → `upsertVectors` in batches of 100 → record `modified` date in the registry (`processed-<company>.json` at repo root) so unchanged posts are skipped.
- **Abortable everywhere**: `checkAbort(signal)` at every loop boundary; `retry(fn, retries, delay, signal)` never retries `AbortError` and its sleep is interruptible (`utils/helpers.js`). Job handlers receive `{ signal, companyName }`.
- Embeddings (`services/cloudflare_embeddings.js`): raw fetch to CF REST, batch size 4, concurrency 2, 5 retries with exponential backoff on 429; results array is pre-allocated so ordering is preserved (failed batches become `null`).
- Vectorize (`services/vectorize.js`): SDK-based CRUD; upsert requires `chunk.id`, `chunk.r2_key`, `chunk.text` (throws otherwise) and dimension-validates embeddings. Metadata indexed: `r2_key, title, url, type, slug, chunkIndex`. Has a hardcoded `DIMENSIONS = 768` fallback.

### Scheduler (`cron/` + `routes/cron.js` + `jobs.js`)

- Job registry: `jobs.js` (`testing`, `ingest`); handlers receive `{ signal, companyName }`.
- Standalone jobs (`cron/standalone.js`): run immediately in background, tracked in `standaloneJobs` Map keyed `jobId:companyName` (`_default` if no company), max 6 concurrent (`MAX_CONCURRENT_JOBS`), abortable, entries deleted on completion.
- Cron (`cron/scheduler.js`): `node-cron`, same keying/limits, skips overlapping ticks.
- Endpoints (all under `/cloudflare`): `/presets` CRUD (SQLite `db/presets/app.db`, seeded with 4 defaults — kept in a subdir so company discovery ignores them), `/job/start`, `/job/stop`, `/cron/start`, `/cron/stop`, `/jobs`, `/jobs/running`, `/status`.

### Admin portal (`web/`)
- React 18 + Vite 6 + Tailwind 4, hash-based routing (`#dashboard`, `#ask`, `#companies`, `#config`, `#cloudflare`, `#scheduler`, `#logs`, `#catalog`, `#kbs` / `#kbs/<key>`, `#assistants`) via `useHashRoute`. The legacy `#prompt` page is gone — system prompts are edited per assistant on the Assistants page.
- Company selection lives in `CompanyProvider` (`web/src/context.jsx`), persisted in `localStorage` under **`pc_selected_company`**; every API call attaches `x-company-name` (`web/src/api.js`).
- Theme switcher is a Radix dropdown (`web/src/components/theme-toggle.jsx` + `dropdown-menu.jsx`, dep `@radix-ui/react-dropdown-menu`) in the Layout header. Preference (`light`/`dark`/`system`) persists in `localStorage` under **`pc_theme`** (default `system`); the blocking script in `web/index.html` and `Layout.jsx` both resolve it against `prefers-color-scheme` and toggle the `.dark` class. `@utility menu-enter/menu-exit` in `index.css` drive the open/close animation (reduced-motion respected via the global media query).
- `web/src/models.js` **re-exports** `config/schema.js` model/key lists (ALLOWED_MODELS, URL_KEYS, …) so the portal can never drift from the API — add a model there and it shows up in the portal.
- **Page modules are split per resource (Clean Architecture pass)**: `web/src/pages/catalog/` holds the list/detail view (`page.jsx`), the 5-step provider wizard (`wizard.jsx` + `wizard/` helpers/steps/inline-editor), one modal per file (`modals/`), and shared `components.jsx` / `constants.js` / `utils.js` / `icons.jsx`. The credential add/edit form is a shared hook — `web/src/pages/credentials/` = `use-credential-modal.js` + `modals.jsx` (`CredentialModal`/`DeleteCredentialModal`) + `fields.jsx` + `helpers.js`, consumed by the catalog provider detail's `connections-card.jsx` (there is no standalone Connections page — provider credentials are managed on the provider detail page). The Layout shell's nav data + icons live in `web/src/components/layout/` (`nav.js` = NAV/PAGE_META, `icons.jsx` = NAV_ICONS map keyed by nav item id).
- Vite dev server allows hosts `*.monkeycode-ai.live`.

### AI Gateway platform layer (`mysql/` + `schema/` + `migrations/`)

An optional **MySQL-backed** multi-tenant provider/credential layer running **alongside** the SQLite config system. Frozen schema in `schema/v5.sql` (v5 final, never edit), applied by incremental migrations in `migrations/`. Routes mount at `/gateway` behind `requireAdmin` (app.js); admin routes carry no rate limiter — authenticated admin sessions bypass the global baseline.

- **Config**: `MYSQL_HOST`/`MYSQL_PORT`/`MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE` in `.env`. When unset, the app boots fine and every `/gateway` route returns **503** (`mysql/pool.js` is lazy — no connection at import time). With `CONFIG_STORE=mysql` these same variables power the company config store (`config/mysql-store.js`); `initConfig()` warns and proceeds with an empty config if they're missing.
- **Migrations**: `node mysql/migrate.js` (or `--dry-run`). The runner parses statements itself, honoring `DELIMITER` blocks, tracks `schema_migrations` with a SHA-256 checksum — editing an applied migration fails loudly. `MIGRATIONS_DIR` env override supported. Requires **MySQL 8.0+** (`credential_usage_logs` = partitioning + FKs; MariaDB rejects that, drop the PARTITION clause to run on MariaDB).
- **Layers**: `mysql/pool.js` (lazy pool) → `mysql/repositories/` (one file per entity — `provider.js`, `model.js`, `endpoint.js`, `pricing.js`, `credential.js`, `company.js`, `resource.js`, `assistant.js`, `audit.js`, `kb.js`, `catalog-import.js` — re-exported through the `mysql/repositories.js` barrel; all SQL lives here, snake_case rows; callers shape responses) → `mysql/services/credential-service.js` (encrypt/decrypt/rotate/verify over AES-256-GCM blobs, reuses `config/encryption.js`; format validation driven by `provider_auth_schemas`) → `mysql/services/provider-registry.js` (cached catalog: providers + auth forms + resource templates + models, `invalidateRegistry()` after catalog changes) → `mysql/routes/` (one Express router per resource group — `providers.js` (incl. the `/providers/:key/models` model CRUD), `endpoints.js`, `pricing.js`, `companies.js`, `credentials.js`, `resources.js`, `assistants.js`, `kbs.js`, `health.js`, plus shared `helpers.js`/`probes.js` — composed by `mysql/routes/index.js` and exposed through the `mysql/gateway-router.js` barrel).
- **Encryption at rest**: `encrypted_credentials` is a JSON blob whose values are individually `gcm:` blobs; decrypted values exist only in memory, never in API responses. Requires `APP_ENCRYPTION_KEY`.
- **Endpoints**: `/gateway/health`, `/providers[/:key[/auth-form|/resources|/models]]`, `/companies` CRUD, `/companies/:key/credentials`, `/credentials/:id/verify|rotate` (DELETE too), `/credentials/:id/models`, `/companies/:key/resources|audit`. Live verification probes live in `mysql/routes/probes.js` (`PROBES` map, currently Cloudflare token verify) — add per provider_key.
- **No seed data** (per design): the catalog starts empty; add providers/auth schemas/models via SQL or future migrations. The v5 demo tenant seed (`schema/v5.sql`) is not applied.

---

## Gotchas (non-obvious, learned the hard way)

1. **Admin auth is opt-in via `.env`.** When `ADMIN_USERNAME` and `ADMIN_PASSWORD` are both set (see `.env.example`), `POST /auth/login` issues an HMAC-signed session token (12h default, `ADMIN_TOKEN_TTL_HOURS`), `requireAdmin` (`auth.js`) gates **all** `/cloudflare/*` routes (cron + admin) and the portal shows a login page (`web/src/pages/Login.jsx`). Tokens travel via `Authorization: Bearer`, `x-auth-token`, or — for the new-tab Swagger docs page only — the path-scoped `pc_admin_token` cookie. **If either env var is unset, auth is disabled and every route stays open** (backwards compatible) — `GET /auth/me` reports `authenticated: true` and the portal skips login. Legacy `ADMIN_API_KEY` was removed (never enforced). Note: `docs/AI_API_REFERENCE.md` / `getting-started.md` may still describe the old `x-api-key` auth claim — routes are only protected when the login env vars are set.
2. **Per-company ask API keys** (`API_KEY`, stored in the company's config — MySQL `company_config` or SQLite): generated/revoked via `POST|DELETE /cloudflare/companies/:name/apikey` (admin portal "Ask API Key" card in `Config.jsx`). When set, **only** `POST /ask` and `POST /ask-stream` are gated (middleware `requireAskApiKey` in `routes/ask.js`): the request must send `x-api-key` (or `Authorization: Bearer`) matching, and browser requests (Origin/Referer present) must come from the company's domain — `x-company-name` maps to `<company>.com` plus subdomains (`popularcert` → `popularcert.com`, `www.popularcert.com`, …). Companies without a key stay open (backwards compatible). The key value is never returned by GET endpoints (`/config` exposes only `AUTH.API_KEY_ENABLED`; `GET /companies/:name` redacts it and returns `hasApiKey`). CORS is now dynamic: static allowlist + any `<company>.com`/subdomain origin derived from the runtime company list, plus localhost for dev.
3. **Blank slate — no default company, no env credentials.** Companies are created via the admin portal (Companies page) or `POST /cloudflare/companies`; each gets a MySQL company row (or `db/<company>.db` on the SQLite backend) with default model/URL values and **empty credentials**. Credentials are entered **once** as gateway connections on the Providers page — `mysql/services/rag-sync.js` auto-mirrors them into the RAG config store (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`), so /ask/ingest/Vectorize/R2 use the same values. There is **no credentials card on the Config page** — models/providers live there, credentials live on the Providers page. (Direct API writes via `PUT /cloudflare/companies/:name` still work; `R2_TOKEN_VALUE`/`R2_JURISDICTION_END_POINT` have no gateway field source and are only settable that way.) `resolveCreds(companyName)` reads only the company's stored config (no `process.env` fallback) and throws for unknown companies; index/bucket routes and `/ask` return a **400 `Company 'x' not found`** for those. `.env` holds **only** the MySQL connection (`MYSQL_*` + `CONFIG_STORE`), the admin login (`ADMIN_*`), `PORT`, `NODE_ENV`, and optionally `APP_ENCRYPTION_KEY` — never company config (Cloudflare/R2 creds, models, URLs, prompts all live in MySQL). `docs/getting-started.md` may still describe the old env-seeded flow.
4. **Root `package.json` has `start` (`node app.js`), `dev` (nodemon), `test` (`npm test` — the full suite glob), and `lint` (`npm run lint` — eslint, see Lint above) scripts.** Use `node app.js`, `npm test`, and `npm run lint`.
5. **Bare `node --test` fails** on the `scripts/` `*test*` files that need credentials/network/live server (see Commands).
6. **Docs drift**: `docs/getting-started.md` and `docs/architecture.md` have been brought in line, but keep file-path references current across `docs/*.md` and `AGENTS.md` — several monoliths were split into directories during the Clean Architecture pass: `mysql/repositories.js` → `mysql/repositories/`, `mysql/gateway-router.js` → `mysql/routes/`, `routes/cloudflare.js` → `routes/cloudflare/`, `web/src/pages/catalog/` + `credentials/`, and `web/src/components/layout/`. The barrel files still exist and re-export everything, so imports never change — but docs should point at the split modules.
7. **Config is loaded once at process start** (runtime singleton, populated by `initConfig()` before `app.listen`). Editing the DB while the server runs has no effect; changing a company's config via the API mutates the singleton and persists **asynchronously** (persist-first — a failed DB write returns an error and leaves memory untouched).
8. **Vector index dimensions must match `EMBEDDING_DIMENSIONS`** for the company's `EMBEDDING_MODEL`, or upserts fail with "Invalid embedding detected". Changing `EMBEDDING_MODEL` on a populated index means re-ingesting (or recreating the index).
9. **History is capped at 6 messages** (`MAX_HISTORY`) and query rewriting only happens when history is non-empty.
10. **`processed-<company>.json` is the ingestion registry** (gitignored via `processed-*.json`). Deleting it forces full re-ingest; `content/` holds per-post Markdown from ingestion.
11. Console logging is gated on `NODE_ENV !== "production"` in the query path; file logs (`utils/logger.js`, `logs/`) are async/batched, rotate once per session at 5MB, and are always written.
12. The web dashboard is only served if `web/dist` exists at boot (`hasWeb` check). After pulling new UI changes, rebuild before restarting the server.
13. Emojis in log strings (`✅`, `❌`, `⚠️`) and `// ------` banner comments are the house style — keep it when editing existing files.

---

## Repo map (quick orientation)

```
app.js                     Express server: middleware, rate limits, /ask, /ask-stream, /test, SPA
env.js                     Frozen env accessor (dotenv) — mysql connection + admin login only, never company/AI config
client.js                  Shared Cloudflare SDK + S3 clients (singletons)
ingest.js                  WP → Markdown → chunks → R2 → Vectorize pipeline (abortable)
jobs.js                    Job registry for scheduler (testing, ingest)
scripts/                   Ad-hoc/dev scripts (test.js MySQL connection test, streamTest.js LLM stream smoke test used by POST /test, gen-key.js, m2-e2e.mjs, zip-project.sh, …) — not part of the app, but bare `node --test` still recurses into the `*test*` ones (see Gotchas)
config/                    Multi-tenant config: schema, SQLite/MySQL stores (CONFIG_STORE switch), codec (encryption), validation, prompts, company CRUD, write path (updateConfig/reset), presets
knowledge/                 AI-managed knowledge layer (Phases 1–5): graph-schema (allowlist + stable ids + SINGULAR_RELATIONSHIP_TYPES), neo4j session utils, provenance/evidence, validation (claim lifecycle + confidence + conflict + mutation policy), entity/relationship/claim services, knowledge-service facade, tools.js (internal AI tool layer: definitions + dispatcher + policy + executeKnowledgeTool), REST boundary at /gateway/knowledge
mcp/                       MCP stdio server adapter (Phase 7) over executeKnowledgeTool — `npm run mcp`, stdio JSON-RPC 2.0, zero deps
query/                     RAG pipeline: intent, llm, cache, retrieval, scoring, reranker, context, prompts, answer, cli (REPL), stream-contract (wire protocol + SSE parser)
services/                  cloudflare_embeddings, vectorize (+ stale .old), r2, wp
shared/                    Code shared between the API server and the admin portal: error-tag.js (9Router diagnosis tag), catalog-enums.js (category/auth-type/model-category ENUMs), patterns.js (model-key + resource-name validation regexes). All pure ESM, node --test friendly
utils/                     chunker, cleaner, helpers (retry/abort/chunkArray/sleep), logger
routes/                    ask.js (POST /ask, /ask-stream, /ask/reset — company gate, API-key gate, AI limiter, SSE contract), cron.js (scheduler + presets API), cloudflare/ (companies, apikey, indexes, buckets, config, prompt sub-routers + helpers, composed by cloudflare.js), auth.js, logs.js
mysql/                     MySQL layer: gateway (pool, migrate runner, repositories/ [one file per entity + barrel], services/ [provider-executor, credential-service, provider-registry, catalog-importer, rag-sync — gateway→RAG credential mirror], routes/ [one router per resource group + barrel]) + company config store backend (mysql-store.js)
schema/                    Frozen v5 MySQL schema (reference only — never edit)
migrations/                Incremental MySQL migrations (001_init: tables/views/procedures; 002_company_config: company_config table)
cron/                      standalone.js, scheduler.js, state.js, status.js
web/                       React admin portal (Vite); build into web/dist
docs/                      architecture, API references, models, getting-started (partially stale), openapi.js (Swagger/OpenAPI spec), plans/ (milestone planning docs: plan.md, plan-m1.md)
```
