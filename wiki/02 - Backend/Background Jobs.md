---
type: backend
status: active
area: backend
tags: [jobs, cron, scheduler]
related:
  - "[[Scheduler]]"
  - "[[Ingestion]]"
---

# Background Jobs

Single unified machine in **`cron/lifecycle.js`** (older docs splitting standalone.js/scheduler.js/state.js/status.js are outdated — consolidated file confirmed).

## Job registry — `jobs.js`

| id | handler | description |
|---|---|---|
| `testing` | `cron/testing-job.js` placeholder console job | scheduler smoke test |
| `ingest` | `ingest.js main({signal, companyName, kbKey, maxPages, scope, setProgress})` | full ingestion pipeline ([[Ingestion]]) |

Handlers receive `{ signal }` and must honor `AbortError`.

## Execution model

```mermaid
flowchart LR
    API["POST /cloudflare/job/start<br/>or /gateway/kbs/:key/ingest"] --> START[startJob(jobId, company, opts)]
    START --> G1{already running?}
    G1 -->|yes| DENY409-ish message
    G1 --> NO --> G2{size < MAX_CONCURRENT_JOBS=6}
    G2 -->|no| MAXMSG
    G2 --> OK["standaloneJobs.set(key,{status:'running',abortController,...})<br/>run async in background"]
    OK --> DONE["cleanup deletes entry; errors recorded"]
    TICK[node-cron schedule] --> GUARDS[same guards on cronSchedulers] --> HANDLER[handler w/ shared signal]
```

- Key = `jobId:company[:kb]` enabling per-KB parallel ingestions.
- Cron ticks skip overlap via `tickRunning` flag rather than queueing.
- Status strings: standalone `running`; cron `scheduled`; idleness reported with catalog fallback (`getStatus()`).
- In-memory only: process restart forgets schedules (documented limitation; [[Technical Debt]] TD-3).

## Abort story

Each start creates its own `AbortController`. Stop endpoints (`/job/stop`, `/gateway/ingest/cancel/:company`, `/cron/stop`) call `stopJob/stopCron` → abort signal → pipeline's `checkAbort` boundary throws `AbortError` (never retried) → KB status left as-is for aborts, flipped to error for real failures, cleanup removes map entry.

## Webhook side effects

On completion/failure, KB-configured webhooks fire asynchronously after audit writes ([[Ingestion]]); abort deliberately fires nothing.

## Observability

- `GET /cloudflare/jobs/running` & `GET /cloudflare/status` (portal Scheduler).
- `GET /gateway/ingest/jobs|status/:companyName`.
- Per-cron stats accumulate: lastRun/lastError/runCount/lastDuration/totalDuration→avg.

## Extending

Add registry entry in `jobs.js` + optional UI preset row through presets CRUD (`config/presets.js` seeds four defaults in `db/presets/app.db`). Wire any new scope options by extending the opts object into handler signature.