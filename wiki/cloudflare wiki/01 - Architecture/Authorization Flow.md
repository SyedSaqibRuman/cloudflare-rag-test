---
type: architecture
status: active
area: architecture
tags: [authz, authorization, tenancy]
related:
  - "[[Authentication Flow]]"
  - "[[Multi-Tenancy & Company Config]]"
---

# Authorization Flow

The codebase has **two authorization axes**, nothing finer-grained.

## Axis 1 — Admin vs public (coarse binary)

Verified rules:

| Route family | Gate |
|---|---|
| `/auth/*` | open (login issues tokens) |
| `/ask`, `/ask-stream`, `/ask/reset` | company header + optional company API key ([[Ask API Keys]]) |
| `/cloudflare/*` | `requireAdmin` middleware at mount time (app.js) |
| `/gateway/*` | `requireAdmin` at mount **plus** inner `gate` (503 until MySQL configured) |
| `/logs`, `/api-docs`, `POST /test` | `requireAdmin` (+ aiLimiter for /test) |
| `/_health`, `GET /` | open |
| Global baseline limiter | authenticated admins skip it entirely |

When auth is disabled (`ADMIN_*` unset), all of the above stay open — deliberate back-compat, documented in [[ADR - Opt-in admin auth via HMAC session tokens]].

## Axis 2 — Tenant scoping (company isolation)

- Admin-scope reads/writes are parameterized by **companyKey** captured into MySQL user tables (`companies.company_key`): repositories always filter by `company_id`.
- Gateway routers enforce "this company exists" up-front via `requireGatewayCompany`-style helpers (e.g. `mysql/routes/kbs.js router.use("/kbs", requireGatewayCompany)`), returning 404 otherwise; a defensive middleware rejects double slashes (`/gateway/companies//credentials`) with a clear 400.
- The visitor-facing axis never crosses tenants: `x-company-name` selects **exactly one** config object used for creds/models/resources; there is no shared context between companies inside a single request.

## What does NOT exist (absence confirmed in source/tests)

- Roles, permissions matrices, or per-endpoint ACLs inside admin scope — any authenticated admin can do everything.
- Portal-side authorization differences between users — there is only one credential pair.
- Row-level multi-user audit actor semantics: `actorFromReq` tags actions generically (admin/system).

Consequently any hardening conversation starts at [[Security Model]]; e.g., adding roles would touch `auth.js requireAdmin`, gateway routers' shared helpers, and the portal nav gating simultaneously.