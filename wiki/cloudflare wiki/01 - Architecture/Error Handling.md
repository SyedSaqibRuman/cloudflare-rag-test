---
type: architecture
status: active
area: architecture
tags: [errors, exceptions]
related:
  - "[[Error Handling]]"
  - "[[Backend Overview]]"
---

# Error Handling

## Typed taxonomy — `shared/errors.js`

All operational errors extend **`AppError(message, status, code)`** with `isOperational=true`:

| Class | Status | Typical `code` |
|---|---|---|
| `ValidationError` / `ValidationErrorMap(errors)` | 400 (400s) | `VALIDATION_ERROR`, map carries per-field errors |
| `AuthenticationError` | 401 | `AUTHENTICATION_ERROR` |
| `AuthorizationError` | 403 | `AUTHORIZATION_ERROR` |
| `NotFoundError(msg, code)` | 404 | e.g. `COMPANY_NOT_FOUND`, `KB_NOT_FOUND` |
| `ConflictError` | 409 | dup KB/assistant keys, capacity gates |
| `RateLimitError` | 429 | `RATE_LIMIT` |
| `ExternalServiceError(msg, service)` | 502 | `EXTERNAL_SERVICE_ERROR` |
| `ServiceUnavailableError` | 503 | MySQL unconfigured (`getPool`), auth-off login |

**Legacy shim:** gateway services (`kb-service.js`, `assistant-service.js`) still throw a local `HttpError extends AppError(status,message)` — intentionally kept so existing instanceof checks/tests pass. New code should prefer the shared classes.

## Global handler (`app.js` end)

- `AppError` → `{ success:false, error, code?, errors? }` with its status.
- Anything else → console error log + generic `{success:false,error:"Internal Server Error"}` 500 (never leaks internals; stack stays server-side).
- Followed by a plain 404 catch-all for unmatched routes.

## Route-level seams

- Gateway routers wrap handlers in `wrap()` (`mysql/routes/helpers.js`) which maps thrown errors carrying `.status`.
- SSE paths cannot use the JSON handler after headers flush; they emit `data:{"error":...}` frames via the transport instead ([[Answer Streaming]] contract lives in `query/stream-contract.js`), and defensively destroy/try-catch around recovery.
- Ask pipeline catches everything and returns a *canned* graceful answer text (`buildResponses().error`) rather than HTTP 500 — except client-abort which returns `{error:"aborted"}` with empty fields.

## Provider-call diagnosis

Two complementary helpers turn upstream failures into actionable tags:

1. `shared/error-tag.js diagnoseError(message, providerKey)` → tags like AUTH / 429 / 5XX / NET / RUNTIME / ERR using literal codes then per-provider vocabularies (OpenAI-style, Anthropic-style, Gemini, Cloudflare numeric codes 9109/10000…). Used by credential Test Results UI (portal imports it too — shared module).
2. `mysql/routes/probes.js classifyStatus` + `parseProviderErrorMessage` during live connection tests.

## Failure philosophy observed (evidence-backed)

- External steps degrade best-effort: GraphRAG never fails an ask; webhook failures are logged not rethrown; ingestion audit writes are try/catch'd.
- Retries exist where bounded cost is OK: embeddings batch retry w/ backoff honoring Retry-After; generic `retry()` helper (AbortError never retried); pool retries once on dropped connections.
- Fail-fast inside a single provider op (Vectorize batch upsert throws immediately).

Related pages: [[Background Jobs]] (abort semantics), [[Logging & Audit]] (where errors land), [[Technical Debt]] (inconsistencies noticed).