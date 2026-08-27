# Getting Started

## Quick Start

```bash
# Install dependencies
npm install

# Create .env file (see Environment Variables below)
cp .env.example .env

# Apply MySQL migrations (required for the gateway layer + MySQL config store)
node mysql/migrate.js

# Build the admin portal UI (served by the API server)
cd web && npm install && npm run build && cd ..

# Start the server
node app.js
```

The server starts on `http://localhost:3000` by default. Browsers get the admin dashboard; API clients get JSON. For UI development with hot reload, run `cd web && npm run dev` — the Vite dev server (port 5173) proxies API requests to the backend on :3000.

## Commands

| Command | Purpose |
|---------|---------|
| `node app.js` | Start the API server (also serves the built UI from `web/dist`) |
| `node mysql/migrate.js` | Apply MySQL migrations (`--dry-run` previews without applying) |
| `node scripts/test.js` | MySQL connectivity + migration status check |
| `cd web && npm run build` | Build the admin portal into `web/dist` — required before the server serves the UI |
| `cd web && npm run dev` | Vite dev server with API proxying (:5173) |

There are **no `npm test` / `npm run lint` scripts** in the root `package.json`. Run the test suite directly:

```bash
node --test "config/__tests__/*.test.js" "query/__tests__/*.test.js" \
  "cron/__tests__/*.test.js" "ingest/__tests__/*.test.js" \
  "routes/__tests__/*.test.js" "mysql/__tests__/*.test.js"
```

---

## Environment Variables

**All company + AI/RAG configuration lives in the database — never in env vars.** Models, URLs, system prompts, Cloudflare credentials, vector index / R2 bucket names, and per-company ask API keys are stored per company in MySQL (`CONFIG_STORE=mysql`) or SQLite files (`db/<company>.db`). The environment only carries server knobs, the admin login, and the MySQL connection:

```env
# Server
PORT=3000
NODE_ENV=development

# Config store backend: "mysql" (recommended) or "sqlite" (default when unset)
CONFIG_STORE=mysql

# MySQL — companies + AI config (required for CONFIG_STORE=mysql and /gateway)
MYSQL_HOST=
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=

# Admin login (OPT-IN — every admin route stays open until both are set)
ADMIN_USERNAME=
ADMIN_PASSWORD=
ADMIN_SECRET=              # recommended when auth is enabled; falls back to an ephemeral per-boot secret (sessions reset on restart)
ADMIN_TOKEN_TTL_HOURS=12   # session length

# Master key for encrypting stored credentials at rest
# (generate with: openssl rand -hex 32)
APP_ENCRYPTION_KEY=
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | API server port |
| `NODE_ENV` | No | `development` | `production` suppresses console debug logs (file logs always written) |
| `CONFIG_STORE` | No | `sqlite` | Where company config lives: `mysql` (recommended) or `sqlite` |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | Only for `mysql` | — | MySQL connection. When unset, `/gateway/*` routes return 503 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | No | — | Enables admin auth (login page + protected routes). Unset = everything open |
| `ADMIN_SECRET` | Recommended when auth is enabled | ephemeral random (per boot) | HMAC secret used to sign session tokens. Without it, tokens are signed with a fresh random secret each restart — sessions do not survive restarts and cannot be forged from the repo. Generate: `openssl rand -hex 32` |
| `ADMIN_TOKEN_TTL_HOURS` | No | `12` | Session token lifetime in hours |
| `TRUST_PROXY` | No | `true` | Proxy hops (number), proxy IPs, or boolean for Express `trust proxy`. Keep `true` only when every client reaches the server through your proxy — otherwise rate-limit keys can be spoofed via X-Forwarded-For |
| `APP_ENCRYPTION_KEY` | No | — | AES-256-GCM master key; without it stored credentials stay plaintext (with a boot warning) |

---

## Admin Authentication

Admin auth is **opt-in**. When `ADMIN_USERNAME` and `ADMIN_PASSWORD` are both set, `POST /auth/login` issues an HMAC-signed session token and every `/cloudflare/*`, `/gateway/*`, `/logs`, and `/api-docs` route is protected (`401` without a valid token). When either is unset, auth is disabled and every route stays open (backwards compatible).

```bash
# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "secret"}'
# → { "success": true, "token": "<hmac-token>", "expiresIn": 43200 }

# Use the token on protected routes
curl http://localhost:3000/cloudflare/companies \
  -H "Authorization: Bearer <token>"
```

- Tokens are stateless (HMAC-signed) and last `ADMIN_TOKEN_TTL_HOURS` (default 12h).
- Send them as `Authorization: Bearer <token>` or `x-auth-token: <token>`.
- `GET /auth/me` reports whether a session is valid; `POST /auth/logout` discards it client-side.
- The portal stores the token in `localStorage` and shows a login page when auth is enabled. The Swagger UI at `/api-docs` re-attaches the token from a path-scoped cookie.
- **Legacy `x-api-key` / `ADMIN_API_KEY` auth was removed** — don't rely on it.

---

## Multi-Company Architecture

The API is multi-tenant. Every request to `/ask`, `/ask-stream`, or the config/prompt endpoints must include the `x-company-name` header specifying which company to use. Each company has its own isolated:

- **Vector index** (semantic search)
- **R2 bucket** (chunk storage)
- **WordPress source** (`BASE_URL`)
- **System prompt** and brand settings
- **AI models** (LLM, embedding, reranking)
- **Cloudflare credentials** (encrypted at rest)

### Creating a Company

Companies start as a blank slate — no default company is seeded. Create them from the admin portal (Companies page) or via the API:

```bash
curl -X POST http://localhost:3000/cloudflare/companies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "my-company",
    "config": {
      "BASE_URL": "https://mycompany.com",
      "VECTOR_INDEX": "my-company-vectors",
      "R2_BUCKET_NAME": "my-company-r2"
    }
  }'
```

### Where Config Lives

- **`CONFIG_STORE=mysql`** — company rows live in the MySQL `companies` + `company_config` tables (migration `002_company_config.sql`). On the first boot with an empty `companies` table, existing SQLite companies are auto-lifted into MySQL.
- **`CONFIG_STORE=sqlite`** (or unset) — one SQLite file per company: `db/<company>.db`.
- Values are loaded into an in-memory singleton at boot and mutated through the API (writes are persist-first: a failed DB write leaves memory untouched).
- Cloudflare credentials and per-company ask API keys are **encrypted at rest** (AES-256-GCM, master key `APP_ENCRYPTION_KEY`); plaintext exists only in memory.
- Nothing is seeded from env — new companies start with default model/URL values and empty credentials, filled in per company (Config page → "Cloudflare Credentials").

### Company Management Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/cloudflare/companies` | `GET` | List all companies |
| `/cloudflare/companies` | `POST` | Create a new company |
| `/cloudflare/companies/:name` | `GET` | Get a company's full config |
| `/cloudflare/companies/:name` | `PUT` | Update a company's config (incl. credentials) |
| `/cloudflare/companies/:name` | `DELETE` | Delete a company |
| `/cloudflare/companies/:name/reset` | `POST` | Reset a company to defaults |
| `/cloudflare/companies/:name/apikey` | `POST` / `DELETE` | Generate / revoke the per-company ask API key |

All of the above sit behind admin auth.

---

## Making Requests

All AI endpoints (`/ask`, `/ask-stream`) require the `x-company-name` header. Config and prompt endpoints also require it:

```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -H "x-company-name: my-company" \
  -d '{"question": "What is ISO 9001?"}'
```

If the header is missing, the API returns `400: Company is required (x-company-name header, ?company=, or body.company).`

If a company has an ask API key set (Config page → "Ask API Key"), `/ask` and `/ask-stream` additionally require it via `x-api-key` (or `Authorization: Bearer`), and browser requests must originate from `<company>.com` or a subdomain. Companies without a key stay open.

---

## Project Structure

```
.
├── app.js                    # Express server: middleware, /ask, /ask-stream, /test, SPA, /api-docs
├── env.js                    # Frozen env accessor — server/MySQL/admin knobs only (no company config)
├── auth.js                   # Admin auth: login check, HMAC token sign/verify, requireAdmin
├── client.js                 # Shared Cloudflare + S3 clients (per-company)
├── ingest.js                 # WordPress → Markdown → chunks → R2 → Vectorize pipeline (abortable)
├── jobs.js                   # Job registry for the scheduler (testing, ingest)
├── config/                   # Multi-tenant config: schema, SQLite/MySQL stores, encryption, validation, prompts
├── query/                    # RAG pipeline: intent, llm, cache, retrieval, scoring, reranker, answer, cli
├── services/                 # cloudflare_embeddings, vectorize, r2, wp
├── utils/                    # chunker, cleaner, helpers (retry/abort), logger
├── routes/                   # ask.js (company + API-key gates, SSE), cloudflare/ (companies, apikey,
│                             #   indexes, buckets, config, prompt sub-routers + barrel), cron.js, auth.js, logs.js
├── cron/                     # standalone jobs, cron scheduler, lifecycle, status
├── mysql/                    # MySQL gateway layer: pool, migrate runner, repositories/ (one file per
│                             #   entity + barrel), services/, routes/ (one router per resource group +
│                             #   barrel) + the MySQL company-config backend (mysql-store.js)
├── migrations/               # Checksummed MySQL migrations (001_init … 005_credentials_view_left_join)
├── schema/                   # Frozen v5 schema (reference only — never edit)
├── web/                      # React 18 + Vite + Tailwind admin portal (build into web/dist)
├── docs/                     # Architecture, API references, models, OpenAPI spec
└── db/                       # SQLite config store + scheduler presets (gitignored)
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js ≥ 22.5 (ES Modules) |
| Framework | Express 5 |
| Admin portal | React 18 + Vite 6 + Tailwind 4 |
| Database | MySQL / MariaDB (config + gateway) with a SQLite fallback |
| AI | Cloudflare Workers AI |
| Vector DB | Cloudflare Vectorize |
| Object Storage | Cloudflare R2 |
| Scheduler | node-cron |
| HTML Parsing | Turndown |
| Rate Limiting | express-rate-limit |
| API Docs | Swagger UI (`/api-docs`, OpenAPI 3.0.3) |
