---
type: development
status: active
area: dev
tags: [debugging]
related:
  - "[[Logging & Audit]]"
  - "[[Common Problems]]"
---

# Debugging

## Quick signal routes

| Symptom | First look |
|---|---|
| Request misbehaves | logs/requests.log JSON line — has requestId echo header X-Request-Id, company tag, duration, status≥400 body snippet |
| Answer quality off | dev console shows pipeline step logs; verify constants in retrieval/reranker unchanged; check cache hit via `cached:true` flag (reset with /ask/reset) |
| Ingest stuck/fails | GET /gateway/kbs/:key/status + lastError column; logs/process.log; standaloneJobs inspection endpoint /cloudflare/jobs/running |
| Auth weirdness | boot warnings about ADMIN_SECRET ephemeral; cookie scope on /api-docs only |
| Gateway 503 | env MYSQL_* presence → `gate` middleware message names the fix |
| Provider test failing | Test Results modal tag (AUTH/429/5XX/NET/RUNTIME/ERR from shared/error-tag) then raw message in verify history |

## Enable richer traces

Run non-production NODE_ENV for pipeline console detail (`env.NODE_ENV!==production` gates all query-path debug prints). Attach Node inspector: `node --inspect app.js` if deep stepping needed.

## Repro tools

- curl SSE: `curl -N -H 'x-company-name: acme' -H 'Content-Type: application/json' -d '{"question":"..."}' localhost:3000/ask-stream` to watch frame stream raw.
- Swagger Try-it-out at /api-docs carries session automatically (cookie/interceptor).
- query CLI (`node query/cli.js`) isolates pipeline w/o HTTP stack.

## Inspecting state quickly

runtimeConfig is module singleton — add temporary route or use existing config GET; provider registry exposes loaded flag; usePoll interval drives most portal refreshes (check network tab rather than guessing).

## When changing protocols

Update BOTH `query/stream-contract.js` and portal parser together plus its contract tests first (TDD pattern used historically for __start frames addition).

See also [[Testing]] for seam usage and [[Technical Debt]] pitfalls list before assuming bugs are yours.