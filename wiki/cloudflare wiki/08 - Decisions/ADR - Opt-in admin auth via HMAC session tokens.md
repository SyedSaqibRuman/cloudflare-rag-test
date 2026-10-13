# ADR - Opt-in admin auth via HMAC session tokens

## Status
Accepted

## Context
The tool predates formal auth; forcing login would break existing single-admin deployments and local dev, while multi-user identity/roles were not requirements when the portal landed.

## Decision
Auth activates **only** when both `ADMIN_USERNAME` and `ADMIN_PASSWORD` exist. On login, issue stateless token = base64url payload `{u,exp}` + HMAC-SHA256 signature using `ADMIN_SECRET` (or ephemeral random per boot, warned); constant-time checks everywhere; tokens accepted via x-auth-token / Bearer / path-scoped cookie solely for Swagger docs. requireAdmin gates admin namespaces; global rate limiter exempts verified admins; portal fails closed on /auth/me and force-logouts on any 401 to protected paths.

## Rationale
Code comments justify ephemeral-secret choice as unforgeable-by-repo-readers while accepting restart invalidation tradeoff, and enumerate why hardcoding/falling-back-to-password would be unsafe. Fail-closed portal logic documented inline. No SSO/OAuth discussion exists in repo — richer identity needs remain future scope.

## Consequences
### Positive
Zero-dependency sessions without session store; instant enable/disable by env; brute-force limiter isolates login; open mode preserves legacy automation.
### Negative
Single credentials pair (no user granularity/audit actor differentiation); secret management is operator duty; restart invalidation surprises unset-secret users; cookie non-HttpOnly constraint required by JS token mirroring (scoped tightly instead).

## Alternatives
JWT lib usage unnecessary given HMAC simplicity already implemented; database-backed sessions rejected implicitly (stateless comment).

## Related Code
`auth.js`, `routes/auth.js`, mounts in `app.js`, portal `web/src/{auth.js,auth.jsx,api.js}`.

## Related Documentation
[[Authentication Flow]], [[Authorization Flow]], [[Security Model]].