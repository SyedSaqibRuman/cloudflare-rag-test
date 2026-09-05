---
type: feature
status: active
area: backend
tags: [feature, api-keys]
related:
  - "[[Authentication Flow]]"
  - "[[Security Model]]"
---

# Ask API Keys

## Purpose

Optional per-company secret protecting the money-spending endpoints (`/ask`, `/ask-stream`, `/ask/reset`) and pinning widget traffic to that company's web origin. Companies without a key remain open (back-compat default).

## Management API (under /cloudflare ×requireAdmin)

| Call | Effect |
|---|---|
| `POST /companies/:name/apikey` | generate/rotate: `pk_` + 24 random bytes base64url, stored encrypted (`SECRET_KEYS` set), returned **exactly once** in this response |
| `GET /companies/:name/apikey` | status only — `{enabled: true/false}` style flags; value never readable again |
| `DELETE /companies/:name/apikey` | revoke → endpoints fall back to open |

Portal UI: Config page "Ask API Key" card consumes these three calls.

## Enforcement chain (`routes/ask.js requireAskApiKey`)

1. Read tenant config `API_KEY`; absent ⇒ next() immediately.
2. Accept header `x-api-key` **or** `Authorization: Bearer <key>`.
3. Constant-time compare (length pre-check then `crypto.timingSafeEqual`) — no early-exit oracle.
4. Browser-origin binding: if Origin/Referer present, host must be `<company>.com` or subdomain (dev localhost always allowed; null-origin server-side clients bypass). Mismatch → 403 typed message.
5. Failures return 401 JSON envelope.

Rate limiting independent layer remains aiLimiter 20/min ([[Middleware]]).

## Configuration exposure rules

- GET `/cloudflare/config` exposes only a boolean-ish flag under AUTH section, never the key material.
- Company detail responses redact value; return presence indicator instead ([[Security Model]] redaction bullet).

## Invalidation semantics

Rotation replaces ciphertext via persist-first company update; cache keys unaffected (keys aren't part of answer caching); revocation immediate since middleware reads runtimeConfig live.

Test coverage: routes/__tests__/ask-routes.test.js exercises gate pass/fail paths against injected fake pipeline. Related feature owner page: [[Multi-Tenancy & Company Config]].