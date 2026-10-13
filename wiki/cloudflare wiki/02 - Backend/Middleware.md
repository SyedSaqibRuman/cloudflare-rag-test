---
type: backend
status: active
area: backend
tags: [middleware, rate-limiting, cors]
related:
  - "[[Application Flow]]"
---

# Middleware

## Global stack (`app.js`, exact order)

1. **trust proxy** — `app.set("trust proxy", parseTrustProxy(...))` then unconditional re-set later in file (second call wins: `true`). Comment explains Express 5 rejects `app.use(regex, fn)` patterns, hence wrapper style. *Gap note:* env accessor missing TRUST_PROXY ([[Technical Debt]] TD-1).
2. **cors** — `origin: isAllowedOrigin(origin)` callback always passes through `cb(null, allowedBoolean)`; methods GET POST DELETE OPTIONS; headers Content-Type, X-WP-Nonce, X-Company-Name, X-Api-Key, Authorization, X-Auth-Token.
3. **express.json** — limit 1 mb.
4. **requestLogger** (`utils/request-logger.js`) — assigns `req.id` from inbound X-Request-Id or randomUUID; echoes header on response; intercepts `res.send` for ≥400 body preview (200 chars); writes one JSON line per finished request into `logs/requests.log` with method/path/status/duration/company/ip/UA/error; colored dev console line. Skips `/_health` and favicon.
5. **globalLimiter wrapper** — skips when: path === "/" ; OR (`AUTH_ENABLED && verifyToken(extractToken(req))`) i.e. authenticated admins are exempt from the baseline limiter entirely. Otherwise applies express-rate-limit window 60 s max 100 with fixed JSON message and standard+legacy RateLimit headers; `validate.trustProxy:false` silences plugin warnings by design.
6. Mount-time auth wrappers — each admin namespace pairs with `requireAdmin` at `app.use()` level so ordering can't be bypassed inside sub-routers.
7. **Static + SPA fallback** (after API routes): express.static(web/dist) with `Cache-Control: no-cache` for html; fallback only for GET/HEAD, non-protected prefixes (/cloudflare,/ask,/_health excluded), Accept incl text/html.
8. **Error handler** then **404 catch-all** close the chain.

## Router-scoped middleware

| Where | Middleware |
|---|---|
| routes/ask.js every ask route | requireCompany → requireAskApiKey → aiLimiter (shared exported instance reused by POST /test) |
| routes/cron.js, cloudflare sub-routers | none extra beyond mount-level requireAdmin (helpers resolve company header where needed, e.g. config/prompt/indexes/buckets) |
| mysql/routes/index.js | `gate` (503 until MySQL configured), double-slash rejection, then per-file routers with own company resolvers/pagination |
| routes/logs.js | static allow-list of filenames via `isLogFile` before fs access |

## aiLimiter specifics

windowMs 60s, max 20, standardHeaders+legacyHeaders true, dedicated message string. Because it's an exported singleton, /test shares the same bucket as tenant asks — intentional cost protection.

## Adding new global rules safely

Follow existing seam conventions: pure function in utils/, unit test in colocated `__tests__`, wire in app.js with a banner comment; never mutate limiter defaults via env (deliberate constants — see [[ADR Index]]).