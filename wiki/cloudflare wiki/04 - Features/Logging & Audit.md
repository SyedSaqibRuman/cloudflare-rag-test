---
type: feature
status: active
area: backend
tags: [feature, logging, audit]
related:
  - "[[Debugging]]"
---

# Logging & Audit

## File logging (`utils/logger.js`)

Every `logToFile(name,msg)` appends `[ISO-ts] msg\n`; writes are batched and flushed on microtask (never block callers), exit-hook flushes synchronously; each file rotates **once per session** when >5 MB. Directory `logs/` auto-created. Files observed in code: `error.log`, `vector.log`, `process.log`, `r2-uploads.log`, `skipped.log`, `requests.log`, plus UI toasts sink.

## Request logging middleware (`utils/request-logger.js`)

Per finished request one JSON line: `{requestId, ts, method, path, status, durationMs, company?, ip, userAgent(≤120), errorBody?≤200}` → requests.log; echo `X-Request-Id` (inbound honored or generated); dev console gets colored compact line skipping /_health + favicon.

## Portal Logs page ↔ `/logs` router (requireAdmin)

list files · read with `?tail=` · per-file download · whole-bundle `/export` txt · clear single/all · `POST /ui` writing toast lines (fired from every portal notify — audit trail of UI feedback).

## Console policy

Verbose debug logs gated behind `NODE_ENV !== "production"` in query/services paths; file logs always written regardless.

## Gateway audit trail (`audit_logs`)

Written through `AuditRepository.log({actorType, companyId, action, entityType, entityId, beforeState?, afterState, reason, isSensitive?})`. Actors: "system" for pipeline events, request-derived actor for admin ops (`actorFromReq`). Confirmed actions across code/tests: `kb.ingest.completed|failed`, `provider.execute.chat|embeddings`, credential create/rotate/verify family, catalog mutations via services. Exposed read-only under gateway companies subresources; failures never mask the triggering operation.

## What's *not* centralized (honest note)

No structured app-wide logger interface — modules console.* directly for diagnostics; log level control doesn't exist beyond NODE_ENV gating ([[Technical Debt]] recommendation-level).