---
type: development
status: active
area: dev
tags: [setup]
related:
  - "[[Development Workflow]]"
  - "[[Common Problems]]"
---

# Local Setup

## Prerequisites

- Node.js **≥22.5** (`node:sqlite` builtin). Repo verified on v26.5.
- MySQL 8.0+ running & reachable (MariaDB tolerated with automatic PARTITION shim).
- A Cloudflare account token + account id (per company later), optional Neo4j for graph features.

## Install

```bash
npm install                      # root deps (server + tests + cron)
cd web && npm install && npm run build && cd ..   # portal → web/dist (required before serving UI)
```

Install-scripts are policy-gated by package.json `allowScripts` (esbuild/sharp/workerd approved; telemetry like @scarf blocked). Maintenance tooling exists (`npm install-scripts ls|approve|deny`).

## Configure `.env`

```bash
cp .env.example .env
```

Minimum viable dev picks:

| Profile | Values |
|---|---|
| Full platform | CONFIG_STORE=mysql + MYSQL_* (+ run `node mysql/migrate.js`) |
| RAG-only quick start | leave CONFIG_STORE unset (sqlite auto) — but /gateway routes will 503 without MySQL |
| Auth on | ADMIN_USERNAME/PASSWORD (+ADMIN_SECRET recommended; `openssl rand -hex 32`) |
| Secrets-at-rest | APP_ENCRYPTION_KEY=`openssl rand -hex 32` |

## Run

```bash
node app.js            # http://localhost:3000 serves API+portal(+swagger at /api-docs)
npm run dev            # nodemon variant
node query/cli.js      # terminal REPL against a company
cd web && npm run dev  # Vite :5173 hot-reload proxying API to :3000
```

## First-run smoke path

1. Login (if auth configured) → Companies page create tenant.
2. Providers page add Cloudflare connection (creds mirror automatically).
3. Provision vector index + bucket rows (Cloudflare card) — dimensions must match chosen embedding model ([[Config Store Schema]]).
4. Create KB → ingest (Scheduler page or KB page).
5. Ask Console question → streaming answer.

Troubleshooting shortcuts: [[Common Problems]]; deeper debugging tools [[Debugging]].