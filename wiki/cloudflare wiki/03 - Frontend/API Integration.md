---
type: frontend
status: active
area: frontend
tags: [api-client, sse]
related:
  - "[[API Reference]]"
  - "[[Answer Streaming]]"
---

# API Integration

All HTTP funnels through **`web/src/api.js`** (518 lines of named wrappers over one core).

## Core client rules

1. `AUTH_PATHS = ["/cloudflare","/gateway","/auth","/logs"]` decide whether Bearer token attaches — ask paths excluded by design.
2. Optional `x-company-name` added whenever caller passes `company`.
3. JSON serialization automatic when body present.
4. Error extraction order: `data.error` → joined `data.errors[]` → `data.message` → generic HTTP status text.
5. 401 on protected path → `onUnauthorized()` event → global logout (State Management).
6. Binary downloads done with raw fetch preserving auth headers (`downloadFile` helper for logs/export).

## Streaming client (Ask Console)

Parses SSE manually following the exact wire contract owned server-side by `query/stream-contract.js`:

| Frame | Handling |
|---|---|
| `{"token":"..."}` tokens | append text |
| legacy sentinel token `__START_RESPONSE__` | recognized but no longer required (server still sends only in non-start meta mode) |
| `{"__start":true,sources,matches,graph}` | replaces "Thinking..." placeholder state and fills citations panel |
| legacy standalone `{"sources":[...]}` | also supported |
| `{"possibleQuestions":[...]}` | renders suggestion chips pre-DONE |
| `{"error":"..."}` | surfaces error bubble |
| `[DONE]` terminator | closes stream UI |

ReadBuffering details and parser test coverage live at [[Answer Streaming]]; portal mirrors contract exactly to avoid drift claims made on both sides' headers.

## Notable wrapper groups in api.js

- logsApi: list/read/tail/clear/download/downloadAll/logUiToast(fire-forget)
- companies CRUD + reset + apikey generate/revoke/status (`GET .../apikey` returns presence flag only)
- config sections get/put/reset + prompt get/put/reset
- indexes/buckets list/create/delete(+clear bucket)
- scheduler presets CRUD/job & cron start-stop/jobs/status
- gateway full-surface helpers incl KB options ingest source-pages documents progress; assistants CRUD; credentials create/test/rotate etc.

## Proxy environment

Dev runs Vite proxy to :3000 for the four prefixes above; production serves everything same-origin from Express so BASE stays "".