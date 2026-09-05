---
type: architecture
status: active
area: architecture
tags: [security]
related:
  - "[[Authentication Flow]]"
  - "[[Authorization Flow]]"
---

# Security Model

Everything below is **currently implemented** and verified at source; the second section lists gaps.

## Currently implemented

### Secrets at rest
- Company credentials & ask API keys encrypted **AES-256-GCM** per value (`gcm:<iv>:<tag>:<data>`), master key from `APP_ENCRYPTION_KEY` (64-hex recommended; other strings sha256-derived). Both SQLite config store and MySQL `company_config` use the same codec (`config/codec.js`); identical blobs.
- Gateway `credentials.encrypted_credentials` stores per-field gcm blobs too (`mysql/services/credential-service.js`, ENCRYPTION_VERSION=1); plaintext exists only transiently in memory. Missing key = plaintext passthrough **with boot warning**, plus loud decrypt failure on wrong key/tamper (auth-tag enforcement).
- API responses redact secrets (`GET /companies/:name` returns `hasApiKey`; KB list redacts).

### Session tokens
HMAC-SHA256 signed, timing-safe compares everywhere (`checkCredentials`, token sig compare, ask-key compare uses length check + `timingSafeEqual`). Ephemeral-secret mode means restart invalidates sessions rather than shipping a hardcoded secret. See [[Authentication Flow]].

### Input validation
- Whitelisted config keys only (`config/validation.js`, COMPANY_KEYS); company/resource names constrained; shared regexes (`shared/patterns.js`) keep portal forms aligned with server.
- Cross-script consistency shared modules prevent drift between portal checks and API enforcement.
- Prompt-injection scrubbing of retrieved context (`query/context.js sanitizeText`).

### SQL & graph safety
- All MySQL access via parameterized queries (repositories). No string-concatenated SQL found in read paths.
- GraphRAG executes LLM-generated Cypher under multiple mitigations: driver READ access-mode, destructive-clause blacklist (CREATE/MERGE/DELETE/DETACH/SET/REMOVE/DROP/FOREACH/CALL/LOAD CSV), multi-statement rejection, allow-listed start clause, row/char caps, 15 s timeout. See [[GraphRAG]].

### Network edges
- CORS dynamic but strict: static popularcert hosts + localhost ports + `<company>.com`(+subdomains) derived from live tenants; non-browser (no Origin) always allowed.
- Rate limiting: global 100/min baseline, AI tier 20/min `/ask*`(and `/test`), login brute-force 10/min; admin-authenticated traffic deliberately exempt ([[Application Flow]]).
- `trust proxy` default true outside production → rate-limit keys can be forged by clients setting XFF when app is directly reachable; production warning printed. *(see gap note)*

### Webhooks
Outgoing ingestion webhooks carry optional HMAC-SHA256 signature header `X-Webhook-Signature: sha256=...`, 10 s timeout, fire-and-forget (`ingest/webhooks.js`).

### Audit trail
Gateway mutations write to `audit_logs` (actions like `kb.ingest.completed`, `provider.execute.chat`) with actor-type/company/entity/reason fields; `GET /gateway/companies/:key/audit`. Portal toasts also mirrored into `logs/UI.logs` (POST /logs/ui).

## Recommended but NOT implemented

| Gap | Notes | Category |
|---|---|---|
| Per-endpoint admin roles / multi-admin users | single pair only | Authorization |
| HTTPS termination assumptions | server speaks plain HTTP; TLS assumed external reverse proxy | Deployment |
| Request body schema validation library (zod/joi equivalents) | hand-rolled validators throughout | Validation |
| Vector metadata content filtering beyond top-score heuristics | retrieval trust model unchanged | RAG |
| Session revocation list / logout all devices | logout clears local storage only | AuthN |
| Rate-limit persistence | express-rate-limit memory store; resets on restart; key spoof caveat above | Hardening |

Trust boundary summary diagram and ownership of these decisions: see [[ADR Index]]. For concrete risky spots with file/line evidence → [[Technical Debt]] §Security-related findings.