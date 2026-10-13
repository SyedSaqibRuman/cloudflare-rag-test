# ADR - Transport-owned SSE streaming contract

## Status
Accepted

## Context
Streaming answers involve three tangles: framing consistency between route/pipeline/client, abort ownership (client disconnect vs upstream stall), and legacy clients already parsing older frames.

## Decision
One module `query/stream-contract.js` owns everything wire-level: frame builders (token/start/sources/possibleQuestions/error/DONE), the incremental upstream SSE parser (partial-frame buffering), and a transport object combining client signal + unref'd 30s timeout into a single AbortSignal while serializing writes after close. Legacy sentinel `__START_RESPONSE__` retained alongside structured `__start` metadata frames for back-compat.

## Rationale
File header states intent: "the client contract is documented instead of implicit". Route handlers contain no framing logic and pipeline carries no res knowledge — verified separation enabling route-test fake transports. History comment records a hang bug fixed by unconditional res.end() post-finish, motivating transport lifecycle rigor.

## Consequences
### Positive
Single place to evolve protocol; testable timeout/abort matrix via contract unit tests; nginx-safe headers set at handler level; retry/pause semantics decoupled from provider SDK quirks.
### Negative
Two legacy frame shapes maintained indefinitely (mitigated by docs); parser intentionally lenient — malformed trailing frames dropped silently by design choice worth revisiting if client debugging needs surface.

## Alternatives
res-only streaming in route (original shape, caused drift), third-party SSE lib rejected implicitly (zero deps philosophy in that path).

## Related Code
`query/stream-contract.js`, consumers `routes/ask.js`, `query/answer.js askQuestionStream`, portal parser in AskConsole.jsx, tests `stream-contract.test.js`.

## Related Documentation
[[Answer Streaming]], [[API Integration]].