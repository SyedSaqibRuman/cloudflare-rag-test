// --------------------------
// ASK-STREAM CLIENT CONTRACT
// Pure frame dispatch for the /ask-stream SSE stream. api.js (the only
// consumer) parses each `data:` payload and hands it here; this module owns
// the frame → callback mapping so the wire contract stays testable without a
// browser. Mirrors the server-side frame shapes in query/stream-contract.js:
//   {"token":"..."}                      — a streamed token
//   {"token":"__START_RESPONSE__"}       — legacy sentinel (ignored)
//   {"__start":true,"sources":[...],...} — structured start: metadata + sources
//   {"sources":[...]}                    — legacy standalone sources frame
//   {"possibleQuestions":[...]}          — follow-up suggestions
//   {"error":"..."}                      — an error
// --------------------------

export const START_SENTINEL = "__START_RESPONSE__";

/**
 * Dispatch one parsed SSE frame payload to the matching handler.
 * Unknown frames and the legacy sentinel are ignored.
 * @param {object} parsed — JSON-parsed `data:` payload
 * @param {object} handlers
 * @param {(token: string) => void} [handlers.onToken]
 * @param {(meta: { sources?: Array, matches?: Array, graph?: object|null }) => void} [handlers.onStart]
 * @param {(questions: string[]) => void} [handlers.onPossibleQuestions]
 * @param {(message: string) => void} [handlers.onError]
 */
export function applyAskFrame(parsed, { onToken, onStart, onPossibleQuestions, onError } = {}) {
  if (parsed.token && parsed.token !== START_SENTINEL) onToken?.(parsed.token);
  else if (parsed.error) onError?.(parsed.error);
  else if (parsed.__start) onStart?.({ sources: parsed.sources, matches: parsed.matches, graph: parsed.graph });
  else if (parsed.sources) onStart?.({ sources: parsed.sources }); // legacy standalone sources frame
  else if (parsed.possibleQuestions) onPossibleQuestions?.(parsed.possibleQuestions);
}