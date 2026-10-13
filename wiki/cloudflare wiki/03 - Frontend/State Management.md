---
type: frontend
status: active
area: frontend
tags: [state, context, hooks]
related:
  - "[[Component Architecture]]"
---

# State Management

Deliberately minimal: **two React contexts + local page state + shared hooks**; no Redux/Zustand/Query libs.

## Contexts

### AuthProvider (`web/src/auth.jsx`)
- Boot check calls `GET /auth/me` with stored token (fail-closed: any error → logged out).
- Listens for global event **`admin-unauthorized`** → clears token + flips state (api.js fires it on 401s to protected paths).
- login() persists token via `setToken`, best-effort fetches username from /auth/me.
- exposes `{ checking, authed, username, login, logout }`.

Token storage itself is framework-free module `web/src/auth.js` (localStorage key `pc_admin_token` plus docs-cookie mirroring `refreshDocsCookie()`).

### CompanyProvider (`web/src/context.jsx`)
- Selected tenant persisted in localStorage **`pc_selected_company`**.
- On mount fetches company list (`GET /cloudflare/companies`) and stores array.
- All pages read `company` to pass header values.

## Shared hooks (`web/src/hooks.js`)

| Hook | Behavior |
|---|---|
| useHashRoute | routing primitive ([[Pages and Routing]]) |
| useToast | one-toast-at-a-time queue that also POSTs /logs/ui (audit trail) |
| usePagination | page/perPage/resetPage + ready-made paginationParams object |
| usePoll | interval invoker skipping ticks when tab hidden (`document.hidden`), deps-array injected by caller |

## Data-flow conventions

```
User action → local setState or api() call → server response
→ response-shaping in page helper (e.g. catalog/utils.js)
→ toast notify on success/failure
→ selective re-poll (usePoll) instead of store invalidation.
```

Server-derived validation errors surface through the same `data.errors` joins implemented inside api.js — components never parse HTTP bodies directly.

## Derived/shared enums

Portal never hardcodes model lists: imports `web/src/models.js` which re-exports backend schema arrays. Same for regexes and enum vocabularies via `#shared/*` alias ([[UI Patterns]] shows consumption points).

## Anti-patterns to avoid

Reaching for effects outside these hooks patterns will bypass the unauthorized-event logout contract; keep fetches centralized in api.js exports per existing layout.