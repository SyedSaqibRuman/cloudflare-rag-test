---
type: infrastructure
status: active
area: infra
tags: [ops, runbook]
related:
  - "[[Deployment Architecture]]"
---

# Deployment (Runbook)

Ops-facing steps; architecture rationale lives in [[Deployment Architecture]].

## First deploy

1. Provision Node ≥22.5 host; clone repo; `npm install` (allowScripts policy auto-manages esbuild/workerd/sharp approvals).
2. Create `.env` from `.env.example` filling MySQL creds/admin login/`APP_ENCRYPTION_KEY` (generate: `openssl rand -hex 32`) — decide explicit `ADMIN_SECRET` now to survive restarts.
3. Build portal: `cd web && npm install && npm run build`.
4. Apply migrations manually first (`node mysql/migrate.js --dry-run` then real run) — auto-boot migration is a convenience, not a substitute for review on first install.
5. Start behind TLS terminator (`node app.js` / pm2 equivalent). Set intended TRUST_PROXY intent AFTER TD-1 fix ships; until then rely on proxy-level throttling.
6. Login portal → create company → add CF connection → provision resources → create KB → ingest (quickstart order mirrors docs/architecture.md flow).

## Upgrades

1. git pull; review new migrations checksum list via dry-run.
2. Rebuild portal whenever web/ changed (`hasWeb` snapshot taken at boot).
3. Restart process (cache warm-up note: answer cache cold start).
4. Watch boot lines: SQLite-lift warning, MariaDB partition shim notice, encryption-key warning must be absent.

## Backups (minimum viable)

MySQL dumps (companies+company_config+gateway tables incl audit), `.env` (secrets!), registries `processed-*.json`, optional R2 bucket versioning on the chunk buckets. `logs/`,`content/` disposable.

## Rollback caution

DDL migrations are non-transactional; downgrades aren't automated. Roll forward policy: fix-forward via new migration file.

## Health gates post-deploy

curl /_health expecting healthy status incl MySQL+Vectorize+R2 latencies; POST one /ask smoke for tenant; login cycle; schedule a cron tick in Scheduler page to confirm runner alive.