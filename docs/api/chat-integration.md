# Chat Integration API

Everything a third-party chat widget, SPA, or backend service needs to embed the
RAG assistant. Verified against the running server (Node 22, `CONFIG_STORE=mysql`).

- Wire protocol source of truth: `query/stream-contract.js`
- Client reference implementation: `web/src/ask-stream-contract.js`
- Machine-readable spec: `docs/openapi.js` (served at `/api-docs`)

---

## 1. Choosing an endpoint

| Endpoint | Use when | Auth |
|---|---|---|
| `POST /ask` | Server-to-server, or a simple chat that renders a whole answer at once | company header + optional API key |
| `POST /ask-stream` | Any chat UI — token-by-token typing effect | company header + optional API key |
| `POST /gateway/public/assistants/:key/ask` | Public widget, **no admin token**, fixed assistant | company header only |
| `POST /gateway/public/assistants/:key/stream` | Public widget with streaming | company header only |

**Prefer `/ask-stream` for anything user-facing.** `/ask` blocks for the full LLM
latency with no intermediate feedback.

> **Recommendation:** for an embedded widget, use the `/gateway/public/...` routes.
> They need no admin token, and the assistant is fixed by URL rather than by a
> request field. On `/ask` and `/ask-stream`, `assistantKey` is request-scoped
> (it no longer writes to the tenant's stored config), but the public routes are
> still the simpler integration.

---

## 2. Authentication

### Company header (required on every ask route)

```http
x-company-name: maxicert
```

Must match `/^[a-z0-9-]+$/` and exist in the config store, else **400**.

### Ask API key (conditional)

If the company has a key set, `x-api-key` (or `Authorization: Bearer <key>`) is
**required** on `/ask` and `/ask-stream`; missing or wrong → **401**.
Companies without a key stay open for backwards compatibility.

Check whether a company is key-gated without exposing the key:

```http
GET /cloudflare/config?company=maxicert     →  config.AUTH.API_KEY_ENABLED: true|false
```

Set or revoke a key (admin): `POST|DELETE /cloudflare/companies/:name/apikey`.

### Browser origin check

When a company has an API key, browser requests must additionally originate from
that company's domain (`<company>.com` or a subdomain) — enforced only when an
`Origin` or `Referer` header is present. Requests with neither (server-to-server,
curl) skip the check.

CORS allowlist: the popularcert.com family, every `<company>.com` in the runtime
company list, and localhost for dev. `/gateway/public/*` needs no admin token.

---

## 3. `POST /ask` — JSON

```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -H "x-company-name: maxicert" \
  -d '{"question":"What is ISO 9001 certification?"}'
```

### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `question` | string | yes | Non-empty after trim |
| `history` | array | no | `[{role, content}]`; `role` ∈ `user`\|`assistant`\|`system` |
| `assistantKey` | string | no | Selects an assistant **for this request only**. Nothing is written to the tenant's stored config. |

Only the **last 6 messages** of `history` are used. History must be an array —
a non-array is a **400**.

### Response (200) — real capture

```json
{
  "success": true,
  "answer": "ISO 9001 certification is an independent assessment that confirms an organization's management system meets the requirements…",
  "sources": [
    { "title": "ISO 9001 & 14001 Certification Iraq | Cost & Process Guide", "score": 0.8886987 },
    { "title": "Oman ISO 9001 Certification | Meaning Process Benefits", "score": 0.8307504 }
  ],
  "matches": [
    {
      "id": "chunk-…",
      "score": 0.74,
      "metadata": { "title": "…", "url": "https://…", "type": "page", "slug": "…", "chunkIndex": 0 }
    }
  ],
  "graph": null,
  "cached": false,
  "possibleQuestions": []
}
```

| Field | Type | Notes |
|---|---|---|
| `answer` | string | Markdown. Render with a sanitizer — see §6. |
| `sources` | array | `{title, score}`. Display as citations. |
| `matches` | array | Full post-rerank retrieval set with `metadata`. |
| `graph` | object\|null | `{cypher, context}` when GraphRAG contributes. |
| `cached` | boolean | `true` when served from the 60-min in-memory cache. |
| `possibleQuestions` | string[] | 3–5 follow-ups. `[]` on fast-path/error/abort. |
| `error` | string | Present when the pipeline failed; `answer` is then a fallback message. |

`POST /ask/reset` purges one company's answer cache → `{success, cleared}`.

---

## 4. `POST /ask-stream` — SSE

```bash
curl -N -X POST http://localhost:3000/ask-stream \
  -H "Content-Type: application/json" \
  -H "x-company-name: maxicert" \
  -d '{"question":"What is ISO 9001 certification?"}'
```

Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
`X-Accel-Buffering: no` (disables Nginx buffering).

### Frame types

| Frame | Meaning |
|---|---|
| `data: {"token":"…"}` | Append to the answer bubble |
| `data: {"token":"__START_RESPONSE__"}` | **Legacy sentinel — filter it out, never render it** |
| `data: {"__start":true,"sources":[…],"matches":[…],"graph":…}` | Structured metadata |
| `data: {"possibleQuestions":[…]}` | Follow-up suggestions |
| `data: {"error":"…"}` | Error — surface it, then stop |
| `data: [DONE]` | Stream complete |

### ⚠️ Frame order — read this before writing a parser

**The `__start` metadata frame arrives AFTER the answer tokens, not before.**
The pipeline streams tokens as the LLM produces them and only sends metadata once
the run finishes (`query/answer.js:569`). A real capture:

```
data: {"token":"I'm not able to find relevant information…"}
data: {"__start":true,"sources":[],"matches":[],"graph":null}
data: {"possibleQuestions":["Can you provide more context…"]}
data: [DONE]
```

Consequences for your client:
- **Do not** use `__start` to clear a "Thinking…" placeholder — tokens arrive first.
- Sources therefore appear *after* the text completes. If you need citations
  visible while streaming, call `/ask` instead, or render them on `__start` at the end.
- The **fast-path** (greetings, identity, contact) is different — it emits the
  legacy sentinel *first*, then a single token, then `[DONE]`, with no `__start`
  frame and no suggestions. This is why the sentinel must be filtered.

### Robust client

Handles partial chunks, buffer splits across reads, the sentinel, and both frame
orders. Drop this into any framework.

`baseUrl` is **required outside a browser** (Node, SSR, server-side proxying) —
`fetch` rejects relative URLs there. In a browser it can be omitted to use a
same-origin relative path.

```javascript
export async function streamAnswer({
  question, history = [], company, apiKey, baseUrl = "", signal, onToken,
  onSources, onPossibleQuestions, onError, onDone,
}) {
  const headers = { "Content-Type": "application/json", "x-company-name": company };
  if (apiKey) headers["x-api-key"] = apiKey;

  const res = await fetch(`${baseUrl}/ask-stream`, {
    method: "POST", headers, signal,
    body: JSON.stringify({ question, history }),
  });

  if (!res.ok) {
    // 400 bad question/history · 401 bad API key · 429 rate limited
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Ask failed (HTTP ${res.status})`);
  }
  if (!res.body) throw new Error("Streaming not supported by this browser");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line; keep the trailing partial in buffer.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") { onDone?.(); return; }

        let parsed;
        try { parsed = JSON.parse(payload); } catch { continue; }

        if (parsed.token) {
          if (parsed.token !== "__START_RESPONSE__") onToken?.(parsed.token);
        } else if (parsed.error) {
          onError?.(new Error(parsed.error));
        } else if (parsed.__start) {
          onSources?.({ sources: parsed.sources, matches: parsed.matches, graph: parsed.graph });
        } else if (parsed.sources) {
          onSources?.({ sources: parsed.sources });          // legacy standalone frame
        } else if (parsed.possibleQuestions) {
          onPossibleQuestions?.(parsed.possibleQuestions);
        }
      }
    }
  }
  onDone?.();
}
```

Minimal version if you only need the text (`baseUrl` as above):

```javascript
const res = await fetch(`${baseUrl}/ask-stream`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-company-name": "maxicert" },
  body: JSON.stringify({ question: "What is ISO 9001?" }),
});
const reader = res.body.getReader();
const decoder = new TextDecoder();
let answer = "", buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split("\n\n");
  buffer = frames.pop() ?? "";
  for (const frame of frames) {
    const line = frame.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    const payload = line.slice(6);
    if (payload === "[DONE]") break;
    try {
      const { token } = JSON.parse(payload);
      if (token && token !== "__START_RESPONSE__") answer += token;
    } catch {}
  }
}
```

### Aborting

Pass an `AbortSignal` (or close the connection). The server detects the client
disconnect, aborts the in-flight billable LLM call, and stops. A hard **30s**
timeout applies to the stream (`DEFAULT_STREAM_TIMEOUT_MS`).

---

## 5. Public assistant routes (no admin token)

For embedded widgets. Only assistants with `is_public` **and** `is_active` respond;
anything else is **404**.

```http
GET  /gateway/public/assistants                 → list public assistants
GET  /gateway/public/assistants/:key            → one assistant's public info
POST /gateway/public/assistants/:key/ask        → { question, history } → JSON
POST /gateway/public/assistants/:key/stream     → same body → SSE
```

Real response from `POST /gateway/public/assistants/sarah/ask`:

```json
{
  "success": true,
  "answer": "ISO 9001 certification is an independent assessment…",
  "sources": [
    { "title": "ISO 9001 & 14001 Certification Iraq | Cost & Process Guide", "score": 0.8886987 }
  ],
  "cached": false
}
```

Note the reduced field set — no `matches`, `graph`, or `possibleQuestions`.
`GET /gateway/public/assistants` exposes `{key, name, description, model, primaryKb}`
for every public assistant; credentials are never included.

---

## 6. Rendering the answer safely

`answer` is **Markdown containing untrusted text** scraped from customer websites,
plus LLM output. Render with a sanitizer — never `dangerouslySetInnerHTML` on raw
output.

The repo's allowlist (`web/src/markdown-sanitize.js`) accepts only `http:`, `https:`,
and `mailto:` links, rejects `javascript:`/`data:`/`vbscript:`, and treats
colon-free values as safe relative URLs. Link text and titles are escaped.
`sources[].title` is attacker-influenced and must be escaped too.

`graph.context` and `matches[].metadata` are likewise untrusted.

---

## 7. Security notes

- **Rate limits** — global 100/min; **AI tier 20/min** on `/ask`, `/ask-stream`,
  `/ask/suggestions`, `/test`. Both key on the client IP as resolved by Express's
  `trust proxy` setting. That is **`false` by default**, so `X-Forwarded-For` is
  ignored unless the operator opts in via `TRUST_PROXY` — rate limiting cannot be
  bypassed by rotating the header. Behind a proxy all clients then share the
  proxy IP as their key, so budget for shared 429s (or set `TRUST_PROXY` to your
  hop count).
- **`assistantKey` is request-scoped.** It is threaded into the pipeline as a
  per-call argument; the tenant's stored config is never written. (This was a
  persist-first write on an unauthenticated path until 2026-10-05 — see the
  Change Log.) It is still unvalidated beyond format, so prefer pinning the
  assistant in company config or using `/gateway/public` when you don't need
  per-request selection.
- **Never ship the admin token to a browser.** Admin routes (`/cloudflare`,
  `/gateway`, `/logs`) need `x-auth-token` / `Authorization: Bearer`. The public
  assistant routes exist precisely so widgets don't need one.
- **Admin session tokens live in `localStorage`** (`pc_admin_token`) — XSS on the
  portal origin means token theft. Keep the portal's sanitization intact.

---

## 8. Errors

| Status | Cause | Client action |
|---|---|---|
| 400 | Missing/unknown `x-company-name`, empty `question`, non-array `history` | Fix the request; don't retry |
| 401 | Missing/wrong `x-api-key`, or disallowed origin | Fix credentials; don't retry |
| 404 | Assistant not public or inactive | Check `GET /gateway/public/assistants` |
| 429 | Rate limit (100/min global, 20/min AI tier) | Back off, show a message |
| 500 | Pipeline failure | Retry once, then surface |

In-stream failures arrive as `data: {"error":"…"}` and are **not** accompanied by
an HTTP status — the response already started as 200. Always register an error
handler; a stream that only handles tokens will hang on failure.

`/ask` can also return **HTTP 200 with `success: true` and an `error` field** when
the pipeline degraded — check `error` before trusting `answer`.
