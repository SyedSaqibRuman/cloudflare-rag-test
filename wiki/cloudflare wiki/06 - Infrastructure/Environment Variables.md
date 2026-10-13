---
type: infrastructure
status: active
area: infra
tags: [env, variables]
related:
  - "[[Configuration]]"
---

# Environment Variables

Single source: `.env` loaded via dotenv; accessor `env.js` (frozen object). **Company/AI config never lives here** by design ([[ADR - Dual config store with CONFIG_STORE switch]]).

| Variable | Default | Effect |
|---|---|---|
| `PORT` | 3000 | listen port |
| `NODE_ENV` | development | `"production"` silences debug console logs |
| `CONFIG_STORE` | sqlite | `mysql` or `sqlite` backend for company config |
| `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` | — | gateway + mysql config store; required when CONFIG_STORE=mysql and for /gateway at all |
| `MYSQL_SSL` | unset | `"true"` enables TLS (remote hosts) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | unset | both required to enable admin auth [[Authentication Flow]] |
| `ADMIN_SECRET` | random-per-boot | HMAC signing secret; persistent sessions need it set |
| `ADMIN_TOKEN_TTL_HOURS` | 12 | session lifetime |
| `APP_ENCRYPTION_KEY` | unset(=plaintext+warning) | AES-256-GCM master key (`openssl rand -hex 32`) |
| `TRUST_PROXY` ⚠️ | undefined | documented in .env.example + parsed in app.js but **missing from env.js** so currently ineffective — TD-1 |

## Read outside env.js (confirmed list)

- `APP_ENCRYPTION_KEY` read directly inside `config/encryption.js`.
- `CONFIG_STORE` re-read directly in `config/store.js` (backend switch) and app.js boot branch.
- `MIGRATIONS_DIR` override honored by mysql/migrate.js.
- Node runtime requirement itself comes from package engines absence → doc-level floor only.

## Forbidden-by-convention

Cloudflare tokens/R2 keys/models/prompts in env — PR reviewers should reject such additions; tests assert config paths don't fall back to process.env for company values.