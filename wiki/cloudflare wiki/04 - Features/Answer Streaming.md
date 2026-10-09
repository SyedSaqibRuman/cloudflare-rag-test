---
type: feature
status: active
area: backend
tags: [feature, sse, streaming]
related:
  - "[[Ask Pipeline]]"
  - "[[API Integration]]"
---

# Answer Streaming

## Purpose

Progressive token delivery for `/ask-stream` with structured metadata frames, abort-on-disconnect, and shared limiter tier — implemented once, consumed identically by portal AskConsole.

## Wire protocol (owned module: `query/stream-contract.js`)

```
data: {"token":"..."}                 progress tokens (also carries a whole
                                      non-streamed answer — see below)
data: {"token":"__START_RESPONSE__"}  legacy sentinel (sendStart({__start:false}) path)
data: {"__start":true,"sources":[],"matches":[],"graph":{}}   structured start w/ citations metadata
data: {"sources":[...]}               legacy standalone sources frame (kept)
data: {"possibleQuestions":["..."]}   follow-up suggestion chips
data: {"error":"..."}                 errors instead of HTTP codes post-headers
data: [DONE]                          terminator (also closes transport timeout timer)
```

## Every answer reaches the client as a token

Tokens come from the `llmCall` adapter only — but runPipeline also returns answer
text **without calling the LLM**: fast-path canned replies, cache hits, custom
Q&A matches, `noContext`, and the model-access denial. `askQuestionStream` tracks
whether any token was emitted and, when none was, sends the answer text as a
single token frame before the metadata frames. Without that fallback the client
renders an empty bubble (it sets "streaming" on the first token) even though the
start/sources/possibleQuestions frames arrived — historically the visible symptom
of a denied ask and of every cache hit.

## Transport responsibilities

- Combines external signal (client close) with hard 30 s timeout into one AbortSignal.any owned here (`DEFAULT_STREAM_TIMEOUT_MS`); pipeline fetches must pass `transport.signal`.
- Unref'd internal timeout controller prevents process hang.
- finish() idempotent; route ends response unconditionally afterwards (comment documents hang-fix).
- sendError framing used inside catch after headers flushed; recovery wrapped defensively destroying socket on inner error.

## Server flow specifics (routes/ask.js askStreamHandler)

1. validate body same as JSON path.
2. SSE headers incl `X-Accel-Buffering:no` for nginx compatibility; flushHeaders if available.
3. transport created over res.write sink; res.on("close") closes transport & aborts controller.
4. `pipeline.askQuestionStream(question, history, transport, companyName)` executes identical runPipeline but llmCall streams CF REST SSE via createSseParser buffer-safe across chunk boundaries (partial JSON held back into parser state).

Parser specifics worth preserving when editing: ignores non-data lines, dedupes [DONE], flush() attempts trailing frame. The parser callback also flips the `streamed` flag that decides whether the answer still needs a token fallback (see above) — keep it on every `parsed.response` branch.

## Portal consumption mapping

Web/src AskConsole maintains message array state; start frame sets sources panel tokens; possibleQuestions rendered clickable to refill input. api.js exposes nothing special — raw EventSource-like fetch parsing in page (single implementation point).

## Error handling summary

Connection aborted mid-generation → server logs info line, no error frame; provider failure mid-frame → error frame then finish(); pre-header exceptions bubble to generic 500 route catch ([[Error Handling]]).

## Known limitations

No multi-part tool-calls or function streams exist in contract; retries not automatic (client may re-request).