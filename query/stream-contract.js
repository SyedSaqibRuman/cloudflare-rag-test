// --------------------------
// ASK-STREAM CONTRACT
// The SSE wire protocol for /ask-stream lives here and only here: token
// frames, the __START_RESPONSE__ sentinel, the [DONE] terminator, error
// frames, and the abort policy (client close + timeout combined into one
// signal). The route and query pipeline both cross this seam, so the client
// contract is documented instead of implicit.
//
// Wire format (matches web/src/api.js):
//   data: {"token":"..."}\n\n        — a streamed token
//   data: {"token":"__START_RESPONSE__"}\n\n — sentinel; clear "Thinking..."
//   data: {"error":"..."}\n\n        — an error
//   data: [DONE]\n\n                 — stream terminator
// --------------------------

export const START_SENTINEL = "__START_RESPONSE__";
export const DONE_FRAME = "data: [DONE]\n\n";
export const DEFAULT_STREAM_TIMEOUT_MS = 30_000;

/** Frame a token as an SSE data event. */
export function frameToken(token) {
  return `data: ${JSON.stringify({ token })}\n\n`;
}

/** Frame an error as an SSE data event. */
export function frameError(message) {
  return `data: ${JSON.stringify({ error: String(message) })}\n\n`;
}

/**
 * Incremental SSE parser for upstream event streams (Cloudflare's SSE).
 * Feed it decoded chunks; it buffers partial lines, reassembles JSON frames
 * split across chunk boundaries, and calls onData(json) for every complete
 * `data: {...}` frame. [DONE] frames and non-data lines are ignored. Call
 * flush() at end-of-stream to deliver a trailing frame.
 *
 * @param {(data: any) => void} onData — called with each parsed frame payload.
 */
export function createSseParser(onData) {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const cleaned = line.trim();
        if (!cleaned || cleaned === "data: [DONE]") continue;
        if (!cleaned.startsWith("data: ")) continue;
        try {
          onData(JSON.parse(cleaned.slice(6)));
        } catch {
          // Partial JSON frame — hold it for the next chunk to complete.
          buffer = line + "\n" + buffer;
        }
      }
    },
    flush() {
      if (!buffer.startsWith("data: ")) return;
      try {
        onData(JSON.parse(buffer.slice(6)));
      } catch { /* ignore malformed trailing chunk */ }
    },
  };
}

/**
 * One transport for the ask-stream contract.
 * Owns abort: the caller's external signal (client close) and a timeout are
 * combined into a single AbortSignal (`transport.signal`) that the pipeline
 * must use for all its fetch calls — one abort owner, one timeout policy.
 * Owns framing: all writes go through sendToken/sendStart/sendError/finish
 * and stop the moment the stream is closed.
 *
 * @param {object} opts
 * @param {(frame: string) => void} opts.write — raw SSE frame sink (res.write).
 * @param {AbortSignal|null} [opts.externalSignal] — client-close / route signal.
 * @param {number} [opts.timeoutMs] — hard stream timeout.
 */
export function createStreamTransport({ write, externalSignal = null, timeoutMs = DEFAULT_STREAM_TIMEOUT_MS }) {
  let closed = false;

  // Timeout is an unref'd timer on our own controller: closing the transport
  // cancels it (AbortSignal.timeout cannot be cancelled and would keep the
  // process alive long after the stream ended).
  const timeoutController = new AbortController();
  const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs);
  timeoutTimer.unref?.();

  const signal = externalSignal
    ? AbortSignal.any([externalSignal, timeoutController.signal])
    : timeoutController.signal;

  const send = (frame) => {
    if (closed) return;
    try {
      write(frame);
    } catch (err) {
      console.error("❌ SSE write error:", err.message);
    }
  };

  const stopTimeout = () => clearTimeout(timeoutTimer);

  return {
    signal,
    isClosed: () => closed,
    close: () => {
      closed = true;
      stopTimeout();
    },
    sendToken: (token) => send(frameToken(token)),
    sendStart: () => send(frameToken(START_SENTINEL)),
    sendError: (message) => send(frameError(message)),
    finish: () => {
      if (closed) return;
      send(DONE_FRAME);
      closed = true;
      stopTimeout();
    },
  };
}
