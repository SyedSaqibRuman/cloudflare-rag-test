# Platform Buildout — Detailed Plan & UI Design

> **Status:** ✅ **FROZEN — Architecture v1.0** (approved after four design-review passes, final
> 10/10). No further structural changes without a new decision; implementation starts at Phase 0.
> Post-v5 schema additions: §10 · Extension points: §11 · ADRs: §12 · Code map: §13 · Cache: §14.
> **Scope:** Wire the seven schema-only modules of the v5 database (`001_init.sql`) into the live
> Express + React admin platform: provider endpoints & pricing, knowledge bases, assistants,
> chatbots, agent workflows, credential usage logs, and the stored procedures.
> **Schema source of truth:** `migrations/001_init.sql` + `migrations/002_company_config.sql`
> (checksummed — evolve with `003_…`, never edit applied migrations).

---

## 1. Context & Goal

The v5 schema defines a full multi-tenant AI gateway: company → credentials → provider →
resources → knowledge bases → assistants → chatbots → agent workflows. Today the app uses only
two slices of it:

| Layer | Live today | Location |
|---|---|---|
| Tenant + RAG config | `companies`, `company_config`, `schema_migrations` | `config/mysql-store.js`, `config/store.js` |
| Provider registry + credentials + resources + audit | `providers`, `provider_auth_schemas`, `provider_capabilities`, `provider_resource_types`, `provider_models`, `company_environments`, `credentials`, `credential_model_access`, `provider_resources`, `audit_logs` | `mysql/repositories/`, `mysql/routes/` (mounted at `/gateway`) |

Everything below is **defined in the schema but has zero application code**:

| Pending table | Purpose | Notes |
|---|---|---|
| `provider_endpoints` | API endpoints per provider (provisioning/health hints) | No code at all |
| `provider_model_pricing` | Time-bucketed price history per model | Read-only JOINs in `mysql/repositories/`; no writes, no seed |
| `knowledge_bases` | Chunking/retrieval config + links to vector/graph/storage resources | No code |
| `assistants` | AI personality: prompt, model, temperature, KBs, tools | No code |
| `chatbots` | Deployable widget/API fronting an assistant | No code |
| `agent_workflows` | JSON-defined automation with triggers | No code |
| `credential_usage_logs` | Append-only operational metrics + cost | No code (partitioned; MariaDB strips the clause) |
| Stored procs `GetCompanyCredential`, `IsModelAllowedForCredential`, `ResolveDispatch` | Applied to DB, never called | Dispatch is done in JS today |

**Goal:** turn those schema rows into working product surface — backend CRUD + business logic wired
to the existing RAG pipeline (`query/`, `ingest.js`, `services/`) and the existing scheduler
(`cron/`), with full admin-portal UI for each module.

---

## 2. Target Architecture

The existing app maps onto the ER model as follows, and the buildout fills the gaps:

```
Provider Catalog (global, admin-maintained) — the Provider owns everything under it:
```
Provider
  ├── Auth Schema      (provider_auth_schemas)   (live)
  ├── Capabilities     (provider_capabilities)   (live)
  ├── Resource Types   (provider_resource_types) (live)
  ├── Models           (provider_models)         (live)
  │      └── Pricing   (provider_model_pricing)  (BUILD)
  └── Endpoints        (provider_endpoints)      (BUILD)
```
Endpoints are provider metadata (method, URL, timeout); credentials merely choose one — they are
never per-credential.

Tenant (per company) — the full ownership tree:
```
Company
  ├── Environments            (company_environments)   (live)
  │      └── Credentials      (credentials)            (live)
  │              ├── Resources            (provider_resources)        (live)
  │              └── Model Access         (credential_model_access)   (live)
  ├── Knowledge Bases         (knowledge_bases)        (BUILD)
  ├── Assistants              (assistants)             (BUILD) ── reference KBs (primary_kb_id, kb_ids)
  ├── Chatbots                (chatbots)               (BUILD) ── deploy exactly one assistant
  └── Agent Workflows         (agent_workflows)        (BUILD)

Observability
  credential_usage_logs  (BUILD) ── written by query/answer + ingestion, read by Usage UI
  audit_logs             (live, extend to new entities)  (+ future metrics, traces, alerts)
```

**Layered model & ownership (from design review)** — the platform groups into seven layers; every
grouping maps 1:1 to the schema except where flagged:

```
Provider Catalog providers · models · pricing · capabilities · endpoints     (global, admin-only)
Tenant        companies · credentials · resources · environments          (per company)
Knowledge     knowledge_bases                                             (per company)
AI Runtime    (JS services — no schema tables, see gaps below)            (per company)
Deployment    assistants · chatbots                                       (per company)
Automation    agent_workflows                                             (per company)
Observability credential_usage_logs · audit_logs · metrics/traces/alerts    (append-only)
```

**Ownership rules (schema-enforced):**

- **Company → Environment → Credential.** `credentials.environment_id` (FK →
  `company_environments`, ON DELETE SET NULL) scopes every credential to a production /
  staging / dev environment — environments can coexist per company. ✅ matches schema
- **Credential → Resources (each resource belongs to exactly one credential).**
  `provider_resources.credential_id` is NOT NULL (FK → `credentials`, ON DELETE CASCADE);
  resources are never shared across credentials — lifecycle management stays simple.
  ✅ matches schema
- **Credential → Model Access is the authorization layer.** `credential_model_access` per
  (credential, provider_model): `is_enabled`, `rate_limit_per_min/day`, monthly quotas,
  `is_default_for_category`. The runtime MUST pass through this gate before calling a model —
  an assistant cannot call any model on its credential. ✅ matches schema (enforcement is JS,
  Phase 3 — the ask path bypasses it today)
- **Assistant references Knowledge Bases — a KB does not own assistants.**
  `assistants.primary_kb_id` + `assistants.kb_ids` (JSON) point *up* at shared KBs: one KB →
  many assistants (`ISO Docs → Sarah, Support Bot, Sales Bot`), and one assistant → many KBs.
  ✅ matches schema
- **Assistant → one credential, optional one model, many KBs.** `assistants.credential_id` NOT
  NULL, `model_id` optional, `kb_ids` JSON. ✅ matches schema
- **Chatbot → exactly one assistant** (`chatbots.assistant_id` NOT NULL). ⚠️ partial — see gap #2
- **Workflow → optional primary assistant** (`agent_workflows.primary_assistant_id`, ON DELETE
  SET NULL). ✅ matches schema

> 🔒 **Frozen permanently** (ADR-001…ADR-003, §12): the Company ownership tree above is the
> schema's hierarchy and must not change. Everything else may evolve via incremental migrations.

**Schema alignment of the review feedback** — every review point checked against `001_init.sql`:

| Review point | Schema support | Verdict |
|---|---|---|
| One KB → many assistants | `assistants.kb_ids` JSON + `primary_kb_id` FK | ✅ Supported natively |
| Resource belongs to ONE credential | `provider_resources.credential_id` NOT NULL FK | ✅ Supported natively |
| Provider Gateway / adapter layer | `providers.default_api_base_url`/`auth_type`/`auth_header_name`, `provider_endpoints` (method, URL, timeout) | ✅ Backed by schema; the adapter itself is a JS service |
| Chatbot = assistant + channel + theme + security | `chatbots.assistant_id`, `theme_config`, `welcome_message`, `placeholder_text`, per-user rate limits | ⚠️ Partial — schema models ONE channel (`web_widget_enabled`); Slack/Teams/WhatsApp need a `chatbot_channels` table (migration 004) |
| KB internals: documents, chunks, embeddings, entities, relationships | `knowledge_bases` has **no child tables** | ⚠️ Not in schema — chunks/embeddings live in R2 + Vectorize, not MySQL; graph entities/relationships need a `knowledge_graph` table (migration 004) |
| Conversation Engine (state, memory, sessions) | Only `chatbots.enable_history` + `max_history_messages`; no session/message tables | ❌ Not in schema — build as JS service (`query/conversation.js`); DB-backed sessions need migration 004 |
| Environment scopes credentials | `credentials.environment_id` FK → `company_environments` (ON DELETE SET NULL) | ✅ Supported natively; runtime must resolve it (Phase 3) |
| Credential Model Access is the runtime authorization gate | `credential_model_access` (`is_enabled`, `rate_limit_per_min/day`, monthly quotas, `is_default_for_category`) — admin CRUD exists today, but the ask path bypasses it | ⚠️ Table matches schema; runtime enforcement missing (Phase 3) |

**Key integration points with the existing code:**

- **Knowledge base = the RAG config today.** The per-company key/value `company_config`
  (`VECTOR_INDEX`, `R2_BUCKET_NAME`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`,
  `CHUNK_SIZE`, retrieval thresholds…) becomes the *default* KB for each company.
  New KBs reuse `utils/chunker.js`, `services/cloudflare_embeddings.js`,
  `services/vectorize.js`, `services/r2.js` from `ingest.js`.
- **Assistant = the ask pipeline today.** `query/answer.js`, `query/intent.js`, `query/llm.js`,
  `query/cache.js`, `query/context.js`, `query/scoring.js` already implement the runtime
  behavior. An assistant row binds a credential, a model, prompts, and one or more KBs to that
  pipeline — no new retrieval engine needed.
- **Chatbot = the ask HTTP contract + a public widget.** `routes/ask.js` owns
  `/ask` + `/ask-stream` (company gate, per-company API key, AI limiter, SSE wire protocol in
  `query/stream-contract.js`). A chatbot adds a `chatbot_key`-based public path plus an
  embeddable script served from `web/` or a tiny standalone JS file.
- **Workflow triggers reuse the scheduler.** `cron/scheduler.js`, `cron/standalone.js`,
  `jobs.js`, and `routes/cron.js` provide the job registry + cron infra a `schedule`/`event`
  trigger needs.
- **Usage logging hooks in.** `query/answer.js` (LLM call, tokens, latency), `ingest.js`
  (embedding calls), and `routes/ask.js` (response status) are the natural write points.
- **Gateway Router is the dispatch layer.** `mysql/routes/` (composed by the `mysql/gateway-router.js`
  barrel) + `mysql/repositories/` already own credential lookup, model access, and resource
  resolution for the admin API; the
  runtime ask path needs the same chain (Environment → Credential → Model Access → Provider
  Model → Endpoint) instead of calling the LLM client directly (see §7 chain).

---

## 3. Cross-Cutting Decisions (locked early)

1. **Company scoping via `x-company-name` header** — same contract as `routes/cloudflare/helpers.js`
   (`companyFromHeader`). The gateway layer has its own tenant resolution in
   `mysql/services/company-scope.js` (`resolveGatewayCompany`); keep `/gateway/*`
   KB/assistant/chatbot/workflow routes on that single source of truth. All new tenant tables
   carry `company_id` resolved from the header.
2. **New routes live under `/gateway`** (already mounted with `requireAdmin` in
   `app.js`; admin routes carry no rate limiter — authenticated admin sessions
   bypass the global baseline). Public chatbot endpoints are a *separate* router
   (`/chat/*`) mounted *without* admin auth, mirroring `createAskRouter()`.
3. **Repos in `mysql/repositories/`** — one file per entity (split during the Clean
   Architecture pass; `mysql/repositories.js` is now a barrel) — follow the existing
   per-entity repository pattern
   (`KbRepository`, `AssistantRepository`, `ChatbotRepository`, `WorkflowRepository`,
   `UsageRepository`, `EndpointRepository`, `PricingRepository`). Extend the gateway
   `Registry` service (`mysql/services/provider-registry.js`) for endpoint/pricing writes.
4. **Keep `company_config` as the compatibility layer.** KB/assistant rows are the new source
   of truth going forward, but reads fall back to `company_config` until a company has
   explicit KBs/assistants, so nothing breaks mid-migration.
5. **Stored procedures stay dormant.** `ResolveDispatch` etc. remain in the DB but the app
   keeps JS-side resolution (testable, debuggable). Do not call them.
6. **`credential_usage_logs` + `audit_logs` are append-only.** Writers never UPDATE rows;
   UIs read with time filters + aggregate queries. MariaDB-safe (partition clause already
   stripped by `mysql/migrate.js:93`).
7. **Migration `003_platform_seed.sql`** seeds `provider_endpoints` + `provider_model_pricing`
   from the reference data in `schema/v5.sql` (the v5 file seeds pricing; the migrations never
   did). Checksummed like the rest — one-time seed, idempotent (`INSERT … WHERE NOT EXISTS`).
8. **UI conventions** (match `web/src`): hash routes, sidebar groups + page metadata in
   `web/src/components/layout/nav.js` (icons in `layout/icons.jsx`),
   components from `web/src/components/ui.jsx` (`Card`, `Button`, `Input`, `Select`,
   `TextArea`, `Badge`, `Spinner`, `Empty`, `StatCard`, `Modal`, `Toast`), inline SVG icons,
   dark-first Tailwind, company selected via `CompanyProvider` (`pc_selected_company`).
9. **Every mutation writes an `audit_logs` row** (`action`, `entity_type`, `before/after`
   state JSON) — `credential.*`, `resource.*` already do; extend to `kb.*`, `assistant.*`,
   `chatbot.*`, `workflow.*`, `endpoint.*`, `pricing.*`.
10. **Conversation Engine is a JS layer, not a schema table.** Sessions, history, and intent
    routing live in `query/conversation.js` (in-memory Map mirroring `query/cache.js`; Redis
    later). The schema's only conversation surface is `chatbots.enable_history` /
    `max_history_messages` — DB-backed sessions are deliberately deferred (migration 004).

---

## 4. Phase Plan

### Phase 0 — Foundations (`003_platform_seed.sql`, shared plumbing)

- **DB:** migration `003` seeds `provider_endpoints` + `provider_model_pricing` (idempotent).
  Add `provider_resources.config` usage docs if needed (no DDL change).
- **Backend:**
  - `companyFromHeader` lives in `routes/cloudflare/helpers.js` (shared by the cloudflare
    sub-routers); the gateway layer uses `mysql/services/company-scope.js`.
  - Add `requireAskApiKey`-style public chatbot auth later in Phase 4; nothing now.
  - Extend `mysql/services/provider-registry.js` with `listEndpoints`, `saveEndpoint`,
    `listPricing`, `savePricing`.
- **Tests:** migration 003 applies on a fresh DB; existing 190 tests still green.
- **Acceptance:** `node mysql/migrate.js` applies 003; `/gateway/registry/:key` responses now
  include `endpoints` and `pricing` alongside models.

### Phase 1 — Provider catalog completion (endpoints + pricing)

- **Backend (repo + router, admin-only):**
  - `EndpointRepository`: CRUD on `provider_endpoints` (validate `endpoint_key` uniqueness
    per provider, `http_method` enum, `endpoint_url` URL).
  - `PricingRepository`: CRUD on `provider_model_pricing` (validate `effective_from`,
    price columns `DECIMAL(12,6)`, currency). Listing joins `provider_models` for display.
  - Routes under `/gateway/registry/:providerKey/endpoints` and
    `/gateway/registry/:providerKey/models/:modelKey/pricing` (or a flat
    `/gateway/endpoints`, `/gateway/pricing` with `provider` in body — pick flat, matching
    the existing `Registry` style).
- **Frontend:** "Provider Catalog" page (see §6.1).
- **Acceptance:** admin can add an endpoint (e.g. Cloudflare `POST /accounts/{id}/ai/run`),
  see it in the provider detail, and add a price row for a model with an effective date.

### Phase 2 — Knowledge Bases

- **DB:** no DDL (tables exist). Rows only.
- **Backend:**
  - `KbRepository`: CRUD on `knowledge_bases`; validate `kb_key` unique per company
    (`/^[a-z0-9-]+$/`), FK-safe deletes (assistants reference `primary_kb_id` → SET NULL).
  - Routes `/gateway/kbs` (list/create), `/gateway/kbs/:key` (get/update/delete),
    `/gateway/kbs/:key/ingest` (POST — start an ingest job bound to this KB).
  - **Ingestion binding:** extend `jobs.js` `ingest` handler to accept a KB context
    (`{ kbKey }`). The handler resolves chunk settings (`chunk_size`, `chunk_overlap`),
    embedding model, vector resource (`vector_resource_id` → `external_resource_id`),
    storage resource (R2 bucket) *from the KB row*, falling back to `company_config`.
    R2 keys gain a `kb/<kb_key>/…` prefix; the `processed-<company>.json` registry becomes
    per-KB (`processed-<company>-<kb_key>.json`).
  - GET `/gateway/kbs/:key/status` → last sync time, document count, vector count,
    indexing status (reuse `cron/state.js` job tracking).
- **Frontend:** KB list + KB detail pages (see §6.2).
- **Acceptance:** create KB → run ingest from UI → vectors land in the KB's vector index,
  R2 objects under `kb/<kb_key>/`, status flips `indexing → active`; changing
  `chunk_size` re-chunks on next ingest.

### Phase 3 — Assistants

- **Backend:**
  - `AssistantRepository`: CRUD on `assistants`; validate `assistant_key` per company;
    enforce `credential_id` NOT NULL (belongs to company), optional `model_id`,
    `primary_kb_id`, `kb_ids` JSON array. The model must pass
    `credential_model_access` (`is_enabled`, rate limits, quota) before any LLM call.
  - Routes `/gateway/assistants`, `/gateway/assistants/:key` (CRUD),
    `/gateway/assistants/:key/test` (POST — run one question through the pipeline with this
    assistant's prompt/model/KBs, non-streaming, returns answer + sources).
  - **Pipeline binding:** new `query/assistant.js` builds a pipeline config from the
    assistant row (system prompt, temperature, max tokens, streaming flag, KB list) and
    calls the existing `askQuestion`/`askQuestionStream` internals. Credentials resolve via
    `resolveCreds(companyName)` (company's SQLite/MySQL config) — the assistant's
    `credential_id` must point at a credential whose provider matches `model_key`.
  - `/gateway/assistants/:key/duplicate` — clone with new key (useful for A/B prompts).
- **Frontend:** Assistant list + editor (see §6.3).
- **Acceptance:** create an assistant bound to KB "ISO Docs" + Llama 3.3 + a Cloudflare
  credential; "Test" returns a streamed answer grounded in that KB; switching
  temperature/prompt takes effect without restart (runtime config is in the DB row, read per
  call via a small cache like `query/cache.js`).

### Phase 4 — Chatbots (deployable widgets)

- **Backend:**
  - `ChatbotRepository`: CRUD on `chatbots`; `status` lifecycle `draft → live → paused →
    archived`; validate `chatbot_key` per company; `api_endpoint_path` auto-suggested as
    `/chat/<chatbot_key>`.
  - Routes `/gateway/chatbots`, `/gateway/chatbots/:key` (CRUD),
    `/gateway/chatbots/:key/publish` (POST — draft → live; generates/regenerates the widget
    token), `/gateway/chatbots/:key/archive`.
  - **Public router** `routes/chat.js` mounted at `/chat` (no admin auth):
    - `GET /chat/:chatbotKey` — widget page (iframe-safe, themed via `theme_config`).
    - `GET /chat/:chatbotKey/widget.js` — embed script (host-origin allowlist from
      `theme_config`/company `website`; loads `chat` widget against the JSON API).
    - `POST /chat/:chatbotKey` — JSON ask (same contract as `POST /ask` but scoped to the
      chatbot's assistant, rate-limited per user via `rate_limit_per_user`/`rate_limit_window`).
    - `POST /chat/:chatbotKey/stream` — SSE variant (reuse `stream-contract`).
  - Widget token in `chatbots.theme_config` or a new column via `003`; keep it simple:
    store an HMAC secret per chatbot in `theme_config.embed_token`.
- **Frontend:** Chatbot list + editor with live preview + "Copy embed code" (see §6.4).
- **Acceptance:** publish "Website Widget" for assistant Sarah → copy `<script>` tag into a
  static HTML page → widget renders, carries history (`enable_history`,
  `max_history_messages`), and answers from Sarah's KB. Pausing the chatbot 403s the public
  endpoints while `/ask` still works.

### Phase 5 — Agent Workflows

- **Backend:**
  - `WorkflowRepository`: CRUD on `agent_workflows`; `definition` JSON validated against a
    small step schema (step types: `assistant`, `http`, `ingest`, `notify`, `delay`,
    `condition`, `loop`). `trigger_type` enum from schema.
  - Routes `/gateway/workflows`, `/gateway/workflows/:key` (CRUD),
    `/gateway/workflows/:key/run` (POST — manual run), `/gateway/workflows/:key/runs`
    (history), `/gateway/workflows/:key/activate|pause`.
  - **Runner** `mysql/services/workflow-runner.js`: async executor with per-step status,
    abort support (reuse `utils/helpers.js` `retry`/`checkAbort`), step results stored in a
    JSON `definition.runs` scratch area (or a `workflow_runs` table added by migration 004
    if persistence is wanted — recommend 004 for observability).
  - **Triggers:** `schedule` reuses `node-cron` (extend `cron/scheduler.js` registry with
    workflow jobs); `webhook` adds `POST /gateway/workflows/:key/webhook` (bearer token from
    `trigger_config`); `event` subscribes to internal events (ingest complete, credential
    rotated); `chatbot` fires from chatbot `on_message` hooks.
- **Frontend:** Workflow list + visual editor (see §6.5).
- **Acceptance:** build a "Nightly Ingestion" workflow (schedule trigger → ingest KB →
    notify Slack) and a "Lead Qualifier" (chatbot trigger → assistant → condition → http to
    CRM); run history shows each step's status/duration; abort mid-run cleans up.

### Phase 6 — Observability (usage + audit)

- **Backend:**
  - `UsageRepository`: append-only insert + aggregate reads:
    - `INSERT INTO credential_usage_logs` from `query/answer.js` (LLM call: model, tokens,
      latency, estimated `cost_usd` from `provider_model_pricing`), `ingest.js` (embedding
      batches), and `routes/ask.js`/`routes/chat.js` (response status, `client_ip`,
      `user_agent`, `trace_id` — thread the existing `requestId`).
    - Reads: `GET /gateway/usage?company=&from=&to=&groupBy=day|model|credential`
      (cost, calls, latency percentiles), `GET /gateway/usage/top` (top KBs/models by cost).
  - Cost calc helper `mysql/services/cost.js`: look up `provider_model_pricing` row with
    `effective_to IS NULL` (current price) → `input_price_per_million` × input tokens.
  - Extend `audit_logs` writes to all new mutations (Phase 0 decision #9).
- **Frontend:** Usage dashboard (see §6.6).
- **Acceptance:** ask 10 questions, ingest a page → Usage shows calls/tokens/cost per day and
  per model; audit trail shows every KB/assistant/chatbot/workflow mutation with
  before/after.

---

## 5. New API Surface (summary)

All `/gateway/*` routes: `requireAdmin` (app.js; admin routes carry no rate limiter),
company from `x-company-name` header for tenant entities.

| Method | Path | Phase | Notes |
|---|---|---|---|
| GET/POST | `/gateway/endpoints` | 1 | admin, optional `?provider=` |
| PUT/DELETE | `/gateway/endpoints/:id` | 1 | |
| GET/POST | `/gateway/pricing` | 1 | `?modelId=` |
| PUT/DELETE | `/gateway/pricing/:id` | 1 | |
| GET/POST | `/gateway/kbs` | 2 | company-scoped |
| GET/PUT/DELETE | `/gateway/kbs/:key` | 2 | |
| POST | `/gateway/kbs/:key/ingest` | 2 | starts job |
| GET | `/gateway/kbs/:key/status` | 2 | |
| GET/POST | `/gateway/assistants` | 3 | company-scoped |
| GET/PUT/DELETE | `/gateway/assistants/:key` | 3 | |
| POST | `/gateway/assistants/:key/test` | 3 | non-stream answer |
| POST | `/gateway/assistants/:key/duplicate` | 3 | |
| GET/POST | `/gateway/chatbots` | 4 | company-scoped |
| GET/PUT/DELETE | `/gateway/chatbots/:key` | 4 | |
| POST | `/gateway/chatbots/:key/publish` | 4 | draft→live, embed token |
| POST | `/gateway/chatbots/:key/archive` | 4 | |
| GET | `/chat/:chatbotKey` | 4 | public widget page |
| GET | `/chat/:chatbotKey/widget.js` | 4 | public embed script |
| POST | `/chat/:chatbotKey` | 4 | public JSON ask (per-user rate limit) |
| POST | `/chat/:chatbotKey/stream` | 4 | public SSE |
| GET/POST | `/gateway/workflows` | 5 | company-scoped |
| GET/PUT/DELETE | `/gateway/workflows/:key` | 5 | |
| POST | `/gateway/workflows/:key/run` | 5 | manual |
| GET | `/gateway/workflows/:key/runs` | 5 | history |
| POST | `/gateway/workflows/:key/activate` / `…/pause` | 5 | |
| GET | `/gateway/usage` | 6 | aggregates `?from&to&groupBy` |
| GET | `/gateway/usage/top` | 6 | top models/KBs by cost |

---

## 6. UI Design

### 6.0 Navigation (sidebar, `web/src/components/layout/nav.js` + `icons.jsx`)

New sections/groups — "AI" gains Knowledge Bases + Assistants + Chatbots; new "Automation"
group for Workflows; "Infrastructure" gains Usage. Company-scoped pages still require a
selected company (badge in sidebar shows current tenant).

```
Overview      Dashboard
AI            Ask Console · Prompt
              Knowledge Bases   (new)  →  #kbs
              Assistants        (new)  →  #assistants
              Chatbots          (new)  →  #chatbots
Companies     Companies · Configuration
Infrastructure Cloudflare · Scheduler
Automation    Workflows         (new)  →  #workflows
              Usage             (new)  →  #usage
Catalog       Providers         (new)  →  #catalog   (admin-only)
System        Logs
```

Routing additions in `web/src/App.jsx` (`useHashRoute`): `#kbs`, `#assistants`, `#chatbots`,
`#workflows`, `#usage`, `#catalog` (+ detail routes `#kbs/<key>`, etc. — parse hash segments).

### 6.1 Provider Catalog page (`#catalog`)

```
┌─ Provider Catalog ─────────────────────────────────────────────┐
│  [Search providers…]                          [+ Add Provider] │
│                                                                │
│  ┌─ Cloudflare ────────────────┐  ┌─ OpenAI ────────────────┐  │
│  │ Models 12 · Endpoints 5 ·   │  │ Models 8 · Endpoints 4  │  │
│  │ Pricing 30 · Capabilities 6 │  │ Pricing 22 · Capability │  │
│  └─────────────────────────────┘  └─────────────────────────┘  │
│  ┌─ Anthropic ────────────────┐  ┌─ Pinecone ───────────────┐  │
│  │ …                          │  │ …                        │  │
│  └─────────────────────────────┘  └─────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

Provider detail (click-through, tabs):
- **Models** — table (existing, read-only) + per-row **Pricing** sub-table:
  `Effective from → to · input $/M · output $/M · currency · [Edit] [Add price]`.
  Add/Edit opens a `Modal` with `Input`/`Select` fields; latest price (no `effective_to`)
  highlighted as "current".
- **Endpoints** — table: `key · name · method badge · URL · timeout · default? · [Edit] [Delete]`.
- **Capabilities / Resource types** — existing read-only tables.

### 6.2 Knowledge Bases (`#kbs`, `#kbs/<key>`)

**List page** — table with status badges:

```
┌─ Knowledge Bases ───────────────────────────── [+ Create KB] ─┐
│  Name              │ Model       │ Vector Index │ Status      │
│  ISO Documentation │ bge-base    │ popularcert-vector │ [indexing] │
│  Sales Playbook    │ bge-base    │ popularcert-vector │ [active]   │
│  HR Handbook       │ —           │ —                  │ [error]    │
└───────────────────────────────────────────────────────────────┘
```

**Create modal** (auto-suggested names, matching the Cloudflare pattern):
- `kb_key` — prefilled `<company>-kb` (validated `[a-z0-9-]` 3–63).
- `kb_name`, `description` (Input/TextArea).
- `vector_resource_id` → Select of the company's vector indexes (`provider_resources`,
  `resource_type='vector_index'`).
- `storage_resource_id` → Select of R2 buckets.
- `embedding_model_id` → Select of embedding models (provider catalog, category
  `embedding`).
- Advanced collapsible: `chunk_size`, `chunk_overlap`, `retrieval_top_k`,
  `retrieval_score_threshold`, `enable_hybrid_search`, `enable_graph_rag`.

**Detail page** (`#kbs/iso-docs`):

```
┌─ ISO Documentation ── active ─────────────────────────────────┐
│  [Run Ingest] [Edit] [Delete]     Last sync: 2h ago · 1,204   │
│                                                      vectors │
│  ┌─ Settings ──────────────┐  ┌─ Status ───────────────────┐ │
│  │ Embedding  bge-base     │  │ Vector index  …index       │ │
│  │ Chunk size  512/50      │  │ Storage      …-data        │ │
│  │ Top-K       10 · ≥0.70  │  │ Documents    142           │ │
│  │ Hybrid      on          │  │ Vectors      1,204         │ │
│  └─────────────────────────┘  │ Last ingest  2h ago · ok   │ │
│                                └────────────────────────────┘ │
│  ┌─ Recent ingests ──────────────────────────────────────────┐│
│  │ 2h ago  142 docs · 1,204 vectors · 3m 12s · ✅ · [view]  ││
│  │ yesterday 138 docs · 1,190 vectors · 2m 58s · ✅ · [view] ││
│  └───────────────────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

"Run Ingest" confirms then calls `POST /gateway/kbs/:key/ingest`; the page polls
`GET /gateway/kbs/:key/status` (reuse `usePoll`) until `indexing → active/error`.

### 6.3 Assistants (`#assistants`, `#assistants/<key>`)

**List page** — cards or table: name, model, primary KB, active toggle, `[Test] [Edit] [Duplicate]`.

**Editor** (two-column layout):

```
┌─ Edit Assistant · Sarah ─────────────────────────────────────┐
│ ┌─ Basics ──────────────────┐  ┌─ Behavior ────────────────┐ │
│ │ Key       sarah           │  │ Temperature     [0.7 ───]  │ │
│ │ Name      Sarah           │  │ Max tokens      [4096]     │ │
│ │ Credential  [Cloudflare ▲]│  │ Streaming       [x]        │ │
│ │ Model      [llama-3.3-70b]│  │ Function calling [x]       │ │
│ └───────────────────────────┘  └────────────────────────────┘ │
│ ┌─ Knowledge ────────────────┐  ┌─ Prompt ──────────────────┐ │
│ │ Primary KB [ISO Docs    ▲] │  │ You are {{NAME}}, a …     │ │
│ │ Also uses  [x] Sales        │  │ (TextArea, {{VARIABLE}}   │ │
│ │            [ ] HR Handbook  │  │  interpolation hint)      │ │
│ └─────────────────────────────┘  └───────────────────────────┘ │
│  [Duplicate]  [Delete]         [Save]  [▶ Test in console]    │
└───────────────────────────────────────────────────────────────┘
```

"Test" opens a `Modal` with a chat input; it POSTs to
`/gateway/assistants/:key/test` and renders the answer + `[Source N]` chips (reuse the
AskConsole streaming UI for the stream variant).

### 6.4 Chatbots (`#chatbots`, `#chatbots/<key>`)

**List page** — table: name, assistant, status badge (`draft/live/paused/archived`),
endpoint path, `[Publish] [Edit] [Archive]`.

**Editor** with a live preview panel:

```
┌─ Chatbot · Website Widget ───────────────────────────────────┐
│ ┌─ Settings ────────────────┐  ┌─ Preview (live) ──────────┐ │
│ │ Key     website-widget    │  │  ┌──────────────────────┐ │ │
│ │ Assistant [Sarah      ▲]  │  │  │ Sarah                │ │ │
│ │ Status  ● live            │  │  │  hi! how can I help? │ │ │
│ │ Welcome "Hi! How can I…"  │  │  │ ┌──────────────────┐ │ │ │
│ │ Placeholder "Ask about…"  │  │  │ │ ask about certs… │ │ │ │
│ │ History  [x] max 20       │  │  │ └──────────────────┘ │ │ │
│ │ Rate limit 60 / minute    │  │  └──────────────────────┘ │ │
│ │ Theme     [indigo ▲]      │  │                           │ │
│ └───────────────────────────┘  └────────────────────────────┘ │
│ ┌─ Embed ────────────────────────────────────────────────────┐ │
│ │  <script src="https://….com/chat/website-widget/widget.js" │ │
│ │  data-chatbot="website-widget" data-theme="indigo"></script│ │
│ │  [Copy]  [Open live widget ↗]                             │ │
│ └────────────────────────────────────────────────────────────┘ │
│  [Archive]                 [Save]  [Publish / Republish]      │
└───────────────────────────────────────────────────────────────┘
```

- Preview re-renders from saved state (no persistence needed).
- "Copy" writes the embed snippet (already shown) to the clipboard.
- Publish calls `POST /gateway/chatbots/:key/publish` and flips status to `live` with a
  success toast; the widget token is regenerated (previous embeds stop working).

### 6.5 Workflows (`#workflows`, `#workflows/<key>`)

**List page** — cards: name, trigger badge (`schedule/webhook/manual`), status
(`active/paused/draft`), last run + outcome.

**Editor** — step list with a live-run panel:

```
┌─ Workflow · Nightly Ingestion ───────────────────────────────┐
│ ┌─ Trigger ─────────────────┐  ┌─ Steps (top→bottom) ──────┐ │
│ │ Type    [schedule     ▲]  │  │ 1. ingest KB "iso-docs"  ▸│ │
│ │ Cron    0 2 * * *         │  │    chunk_size 512         │ │
│ │ Status  ● active          │  │ 2. notify slack #rag      │ │
│ └───────────────────────────┘  │ 3. [if success] http POST │ │
│                                │    crm.example.com/import │ │
│  [+ Add step]  [Save]         └────────────────────────────┘ │
│ ┌─ Run history ──────────────────────────────────────────────┐│
│ │ 5m ago  active · step1 ✅ · step2 ✅ · step3 ✅ · 4m 2s    ││
│ │ 1d ago  failed · step1 ✅ · step2 ❌ (rate limit)          ││
│ └────────────────────────────────────────────────────────────┘│
│  [Pause] [Run now] [Delete]                                  │
└──────────────────────────────────────────────────────────────┘
```

- Step palette (modal): `assistant`, `http`, `ingest`, `notify`, `condition`, `delay`,
  `loop`. Each step is a `Card` with fields per step type (assistant: pick assistant +
  input template; http: URL, method, headers, body; notify: channel + message; condition:
  `{{step2.output}} == ok`).
- "Run now" executes via the runner; the history panel polls `…/runs`.

### 6.6 Usage dashboard (`#usage`)

```
┌─ Usage · popularcert ────────────────────────────────────────┐
│  [last 7 days ▾] [group by: day ▾]        [Export CSV]       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │ Requests │ │ Tokens   │ │ Cost     │ │ Avg. lat │         │
│  │ 1,204    │ │ 4.2M     │ │ $12.40   │ │ 812 ms   │         │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
│  ┌─ Requests / day (bar chart, Chart.js) ──────────────────┐  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─ Top models ───────────┐  ┌─ Recent calls ──────────────┐  │
│  │ llama-3.3   $8.10      │  │ 12:04  ask  200 · 1.2k tok  │  │
│  │ bge-base    $3.90      │  │ 12:03  ingest · 4k tok      │  │
│  │ (embedding)            │  │ 12:01  ask  429 · timeout   │  │
│  └─────────────────────────┘  └────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

- StatCards (`StatCard`) at top; bar chart uses Chart.js (already a dependency for the
  `slides` skill/`Dashboard` patterns — verify `web/package.json`; else render a simple
  CSS bar list).
- Filters (`from/to`, `groupBy`) hit `GET /gateway/usage`; CSV export reuses the
  `routes/logs.js` download pattern (blob + anchor, auth header attached).

### 6.7 Reused UI patterns

- All list pages: `Card` + table (`-mx-5 px-5` overflow pattern from `Cloudflare.jsx`),
  `Empty`, `Spinner`, poll via `usePoll`.
- All create/edit modals: `Modal` + `Input`/`Select`/`TextArea` + footer
  `Cancel`/`Submit`, resource-name validation regex shown inline (copy from
  `Cloudflare.jsx` `ModalForm`).
- Status badges: `Badge` tones — active/live `green`, indexing/provisioning `amber`,
  error/archived `rose`, paused `slate`.
- Detail pages: `Card` grids (2-col) + header actions registered via
  `useHeaderActions` (Refresh / Run Ingest / Save), matching `Cloudflare.jsx`/`Config.jsx`.
- Audit: every destructive action uses `window.confirm` (house pattern) and shows a
  `Toast` on success.

---

## 7. Data & Runtime Flows (after buildout)

**Chat flow (chatbot):**
```
User → /chat/<key>/widget.js → POST /chat/<key>/stream
  → Conversation Engine (query/conversation.js — session, history, intent routing)
  → resolve chatbot (live?) → resolve assistant → KB list → resolveCreds(company)
  → query pipeline (intent fast-path → rewrite → cache → embed → vector top-k
    → hybrid score → rerank → R2 chunks → LLM) — retrieval reads the KB's Provider
    Resources (vector index / R2 bucket), resolved from the KB row
  → Gateway Router (mysql/services/gateway.js) — walks the LLM chain, enforces
    credential_model_access, selects the provider endpoint
  → LLM → SSE tokens → widget
  → write credential_usage_logs (credential_id, model_used, tokens, latency, cost)
```

**Runtime resolution chain (schema-faithful) — what the Gateway Router walks per call:**
```
User
  ↓
Conversation Engine   (query/conversation.js — JS service, not a schema table; see §10)
  ↓
Assistant            (assistants.credential_id NOT NULL · kb_ids / primary_kb_id)
  │
  │  LLM path                                    RAG path
  ├─ Credential ──────────────────────────────►  Knowledge Base (BUILD)
  │    ↓ environment_id                             ↓ vector_resource_id / storage_resource_id
  │  Company Environment                        Provider Resources (vector index · R2 · graph)
  │    ↓ credential_model_access (gate)             ↓
  │  Credential Model Access                    Retrieval: embed → top-k → hybrid → rerank → chunks
  │    ↓ provider_models                            ↓
  │  Provider Model                             buildContext → [Source N]
  │    ↓ endpoint selection (chat / embedding /     ↓
  │  Provider Endpoint   (provider_endpoints —  context
  │    method, URL, timeout)                        ↓
  └────────────────────────────────────────────►  LLM  → credential_usage_logs (append-only)
```
- **Endpoint selection:** a provider exposes multiple endpoints (Cloudflare chat / embedding /
  vision; OpenAI Responses / Embeddings / Realtime); the router picks per call. Endpoints are
  provider metadata — a credential never owns one.
- **`credential_model_access` is the authorization gate:** if the (credential, model) pair is
  not enabled or is over quota/rate limit, the call is rejected — the ask path must not bypass
  it (see Risk #2).

**Ingestion flow (KB-bound):**
```
Admin → Run Ingest → cron/standalone job { kbKey, company }
  → WP crawl (services/wp.js) → cleanContent → chunkMarkdown (kb.chunk_size/overlap)
  → Provider Resources (from KB row: storage_resource_id → R2 kb/<key>/ prefix)
  → embeddings (kb.embedding_model)
  → vectorize upsert (vector_resource_id → vector index) → registry processed-<company>-<kb_key>
  → status indexing→active → audit_logs + usage_logs (embedding tokens)
```

**Workflow flow:** trigger (cron/webhook/chatbot/manual) → runner executes steps in order →
per-step status persisted → history endpoint → UI.

---

## 8. Milestones & Effort (rough)

| Milestone | Phases | Est. | Depends on |
|---|---|---|---|
| M1 — Catalog + foundations | 0, 1 | 2–3 days | — |
| M2 — Knowledge Bases end-to-end (DB→ingest→UI) | 2 | 4–6 days | M1 |
| M3 — Assistants + test console | 3 | 3–4 days | M2 |
| M4 — Chatbots + public widget | 4 | 4–6 days | M3 |
| M5 — Workflows | 5 | 5–7 days | M3 (assistant step) |
| M6 — Usage + audit hardening | 6 | 3–4 days | M1 (cost data), M2/M3 (hooks) |

Total ≈ 3–4 weeks single-track. Each milestone ends with a working UI + `node --test` suite
additions (target: +40–60 tests across `mysql/__tests__/` and new `routes/__tests__/`).

---

## 9. Risks & Open Questions

1. **`company_config` vs KB/assistant rows.** Dual-source reads add complexity; plan keeps
   `company_config` as fallback and flags which source won per company. Consider a migration
   that backfills one default KB + assistant per company from `company_config` (Phase 2
   start) — pending user decision.
2. **Credential → provider/model consistency + model-access enforcement.**
   `assistants.credential_id` is NOT NULL but `model_id` is optional; runtime must validate the
   credential's provider actually serves the chosen model (schema's
   `IsModelAllowedForCredential` proc exists precisely for this — implement equivalent JS check
   in `query/assistant.js`). The runtime must ALSO pass through `credential_model_access`
   (`is_enabled`, per-minute/day rate limits, monthly quota) before every LLM call — today the
   ask path calls the model directly and bypasses the gate; Phase 3 wires the check in.
3. **Widget security.** Public `/chat/*` needs origin allowlisting (like the per-company
   API-key gate in `routes/ask.js`) + per-user rate limits + HMAC embed token. Phase 4 must
   not ship without these.
4. **MariaDB partitioning.** `credential_usage_logs`/`audit_logs` partition clauses are
   stripped on MariaDB (migrate.js) — acceptable, but monthly partition pruning won't exist
   there; retention cleanup must be a `DELETE WHERE created_at < now()-90d` job.
5. **Cost accuracy.** Pricing seed comes from `schema/v5.sql` (may be stale vs current
   provider prices). Mark pricing as "estimated" in UI until a refresh workflow exists.
6. **Workflow run persistence** — `agent_workflows.definition` is JSON; long run histories
   will need `migration 004` (`workflow_runs` table). Scoped to M5.
7. **Docs sync** — after each milestone, update `docs/AI_API_REFERENCE.md` +
   `docs/openapi.js` (Swagger) so the spec stays current with `/gateway/*` and `/chat/*`.
8. **Multi-channel deployment is NOT in the schema.** `chatbots` only has
   `web_widget_enabled` (plus `api_endpoint_path`). Slack/Teams/WhatsApp channels require
   migration 004 (`chatbot_channels` table: chatbot_id, channel_type, config, status).
   The doc keeps chatbots web-widget-first; channels are roadmap, not schema.
9. **KB internals (documents/chunks/entities) are NOT in the schema.** Chunks + embeddings
   live in R2 (`kb/<key>/…`) and Vectorize — there are no MySQL rows per document. If
   per-document status/pinning is wanted in the UI, add a `kb_documents` table (migration
   004). Graph RAG entities/relationships likewise need a `knowledge_graph` table;
   `knowledge_bases.enable_graph_rag` is only a boolean flag.
10. **Conversation Engine has no schema home.** Sessions/history are in-memory (lost on
    restart) until a `conversations` / `conversation_messages` table is added (migration 004)
    or Redis is introduced. The review's "Conversation Engine" is roadmap, not schema.

---

## 10. Post-v5 Schema Roadmap (migration 004+)

Tables raised during design review that **do not exist in v5** — each becomes a checksummed
migration only when implementation reaches it. (`003_platform_seed.sql` is NOT listed here: it
only **seeds existing tables** — `provider_endpoints`, `provider_model_pricing` — and is DML,
not DDL.)

| Migration | Table(s) | Needed by | Purpose |
|---|---|---|---|
| 004 | `workflow_runs` | Phase 5 | Persistent per-execution history for `agent_workflows` (steps, status, duration, output) |
| 004 | `chatbot_channels` | Phase 4 (post-web) | Slack / Teams / WhatsApp deployments — `chatbots.web_widget_enabled` only models the web widget |
| 004 | `kb_documents` | Phase 2 (if per-document UI) | Document-level rows for KBs (chunks/embeddings stay in R2 + Vectorize) |
| 004 | `knowledge_graph` | Phase 2 (Graph RAG) | Entities + relationships for `knowledge_bases.enable_graph_rag` |
| 004 | `conversation_sessions` + `conversation_messages` | Phase 4 (if DB history) | DB-backed conversation state; until then in-memory (`query/conversation.js`) |

---

## 11. Extension Points

Where the platform is **intentionally extensible** — no architectural change required to add
one; each entry maps to the mechanism that makes it pluggable:

| Extension | Mechanism | Schema surface |
|---|---|---|
| New Provider | `providers` row + `provider_auth_schemas` + `provider_endpoints` (+ optional `provider_models`/`pricing`) | v5 — ✅ no migration |
| New Resource Type | `provider_resource_types` row (`resource_type`, `config_schema`, `provision_endpoint_key`) | v5 — ✅ no migration |
| New Workflow Step | step schema in `agent_workflows.definition` JSON (Phase 5 runner registry) | v5 — ✅ no migration |
| New Chat Channel | `chatbot_channels` table | migration 004 |
| New Tool / Function | `assistants.tools` JSON + function-calling support | v5 — ✅ no migration |
| New Retriever | KB `retrieval_*` config + `query/` retrieval service registry | v5 — ✅ no migration |
| New Model | `provider_models` row + `credential_model_access` grant | v5 — ✅ no migration |

---

## 12. Architecture Decision Records (ADR)

ADRs freeze the *why* behind the ownership rules in §2 so future changes are evaluated against
intent rather than re-derived:

| ADR | Decision | Consequence |
|---|---|---|
| ADR-001 | Company owns Credentials (`credentials.company_id` NOT NULL FK, CASCADE) | Deleting a company cascades its credentials; cross-tenant credential sharing is impossible |
| ADR-002 | Credential owns Resources (`provider_resources.credential_id` NOT NULL FK, CASCADE) | Resource lifecycle is tied to its credential; resources are never shared across credentials |
| ADR-003 | Assistant references KBs (`assistants.primary_kb_id` + `kb_ids`) — KBs do not own assistants | One KB → many assistants; deleting a KB nulls references (ON DELETE SET NULL) |
| ADR-004 | Environment scopes Credentials (`credentials.environment_id` FK, SET NULL) | prod/staging/dev can coexist per company; unassigning an environment leaves the credential usable |
| ADR-005 | `credential_model_access` is the runtime authorization gate | No LLM call without an enabled, under-quota (credential, model) pair |
| ADR-006 | Endpoints are provider metadata (`provider_endpoints`), never per-credential | Router selects the endpoint per call (chat vs embedding vs vision) |
| ADR-007 | Chatbot deploys exactly one Assistant (`chatbots.assistant_id` NOT NULL) | Deployment channels extend via `chatbot_channels` (004), not new assistant types |
| ADR-008 | `credential_usage_logs` + `audit_logs` are append-only | No UPDATE/DELETE; retention is a scheduled DELETE by `created_at` |

---

## 13. Code Map — Repositories & Services

Where new code lands (complements §3 decision #3 and the §7 runtime chain).

**Repositories** — one file per entity in `mysql/repositories/` (barrel `mysql/repositories.js`
re-exports them; split during the Clean Architecture pass):

```
mysql/repositories/
  company.js             CompanyRepository   (live) — companies, company_environments
  provider.js            ProviderRegistry    (live) — providers, auth_schemas, capabilities, resource_types, models
  credential.js          CredentialRepository (live) — credentials, credential_model_access
  resource.js            ResourceRepository  (live) — provider_resources (+ model access reads)
  audit.js               AuditRepository     (live) — audit_logs
  endpoint.js            EndpointRepository  (BUILD) — provider_endpoints          (Phase 1)
  pricing.js             PricingRepository   (BUILD) — provider_model_pricing      (Phase 1)
  kb.js                  KbRepository        (BUILD) — knowledge_bases             (Phase 2)
  assistant.js           AssistantRepository (BUILD) — assistants                  (Phase 3)
  ...                    Chatbot/Workflow/Usage — later phases (4/5/6)
```

**Services** — runtime behavior, JS only (no schema tables):

```
mysql/services/
  gateway.js            (BUILD)   Gateway Router — credential chain + endpoint selection + model-access gate
  workflow-runner.js    (BUILD)   step executor, abort support, run history            (Phase 5)
  cost.js               (BUILD)   price lookup → estimated cost_usd                    (Phase 6)

query/
  conversation.js       (BUILD)   Conversation Engine — sessions, history, intent routing
  assistant.js          (BUILD)   assistant row → pipeline config, credential binding   (Phase 3)
  cache.js              (live)    in-memory answer cache (MD5 key, 60-min TTL)
  retrieval.js          (live)    embed → top-k → hybrid score → rerank → chunks
  answer.js             (live)    LLM call + streaming (extended with usage + gate hooks)

services/               (live)    cloudflare_embeddings, vectorize, r2, wp
```

---

## 14. Cache Layer

Caching is a first-class stage of the runtime, not an afterthought:

```
User
  ↓
Conversation Engine
  ↓
Cache  ──(hit)→  answer (+ sources)   [in-memory Map, MD5(company:rewritten), 60-min TTL,
  ↓                                  max 200 entries FIFO — query/cache.js, live today]
Retrieval
  ↓
LLM
```

- **Read:** after the intent fast-path + query rewrite, before embedding/vector work.
- **Write:** on first answer, keyed by `company:rewrittenQuestion`; cached answers carry
  `cached: true`.
- **Limits:** 60-min TTL, 200 entries FIFO, lost on restart (acceptable; Redis is the §10/004
  upgrade path).
- **Phase 2/3:** add `kb_key`/`assistant_key` to the cache key for per-KB / per-assistant
  isolation — no schema change.

---

## 15. Freeze Record

- **v1** — schema inventory, 7-phase plan, UI wireframes (§6).
- **Review 1** (9.7/10) — layered model, ownership rules, schema-alignment verdict table;
  flagged chatbot channels / KB internals / conversation engine as out-of-schema.
- **Review 2** (9.4/10) — Provider owns Models→Pricing; Environment → Credential → Resources →
  Model Access ownership tree; runtime resolution chain; `credential_model_access` as the
  authorization gate.
- **Review 3** (9.9/10) — endpoint selection, RAG-resource path in runtime, Conversation Engine
  in the diagram, ingestion via Provider Resources, §10 roadmap, layer renamed to Observability.
- **Review 4** (10/10) — tagged **Architecture v1.0**; added §11 extension points, §12 ADRs,
  §13 code map, §14 cache layer; layer renamed to Provider Catalog; ownership tree frozen
  permanently.
- **✅ FROZEN.** Structural changes require a new review cycle. Incremental changes from
  implementation experience (e.g. the exact migration 004 DDL) do not.
