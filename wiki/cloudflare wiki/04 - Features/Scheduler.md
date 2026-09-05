---
type: feature
status: active
area: backend
tags: [feature, scheduler]
related:
  - "[[Background Jobs]]"
---

# Scheduler

## Purpose

Portal-driven execution of the job registry: run something now (standalone) or on a cron expression, watch status live, and manage reusable cron presets.

## Surfaces

### HTTP (`routes/cron.js` under /cloudflare ×requireAdmin)
- Presets CRUD over its own SQLite file (`db/presets/app.db`; seeded defaults defined in `config/presets.js`).
- `POST /job/start` `{jobId, companyName, ...opts}` / `POST /job/stop`
- `POST /cron/start` `{jobId, companyName, schedule}` / `POST /cron/stop`
- `GET /jobs` catalog · `GET /jobs/running` · `GET /status`

### Gateway mirror
`/gateway/ingest/start|status/:companyName|cancel/:companyName|jobs` wraps the same runner for KB-centric flows.

### Portal page (#scheduler)
Presets table, start-form for ingest/testing incl. scope selection hooks passing `{kbKey?, maxPages?, scope?}`, running-jobs panel polled via usePoll.

## Runtime guarantees

| Rule | Value/behavior |
|---|---|
| Max concurrent | 6 either mode (`MAX_CONCURRENT_JOBS`) |
| Duplicate guard | same key denies start with explicit message |
| Overlap | cron ticks skip when previous tick still running |
| Abort | stop endpoints abort controllers → `AbortError` honored at pipeline boundaries |
| Cleanup | finished standalone entries deleted; cron entries kept until stopped |
| Persistence | **none** — schedules/jobs are process-local Maps (restart loses them) ([[Technical Debt]] TD-3) |

Job ids fixed today: `testing`, `ingest` ([[Background Jobs]]). Ingest-specific extras: per-company cancel lookup ignoring kbKey suffix; history endpoint stubbed returning empty array (confirmed TODO in source).

Design consolidated in `cron/lifecycle.js` shared-guard machine so both adapters can't drift on messages/status strings.