import { test } from "node:test";
import assert from "node:assert/strict";
import {
  START_SENTINEL,
  DONE_FRAME,
  frameToken,
  frameError,
  createStreamTransport,
  createSseParser,
} from "../stream-contract.js";

function makeTransport(opts = {}) {
  const frames = [];
  const transport = createStreamTransport({ write: (f) => frames.push(f), ...opts });
  return { frames, transport };
}

test("frameToken/frameError produce the documented SSE frames", () => {
  assert.equal(frameToken("x"), 'data: {"token":"x"}\n\n');
  assert.equal(frameError("boom"), 'data: {"error":"boom"}\n\n');
});

test("sendStart emits the sentinel token frame", () => {
  const { frames, transport } = makeTransport();
  transport.sendStart();
  assert.equal(frames.length, 1);
  assert.deepEqual(JSON.parse(frames[0].slice(6)), { token: START_SENTINEL });
});

test("finish writes [DONE] and freezes the transport", () => {
  const { frames, transport } = makeTransport();
  transport.sendToken("hello");
  transport.finish();
  transport.sendToken("ignored");
  transport.sendError("ignored");
  assert.equal(frames.length, 2);
  assert.equal(frames[1], DONE_FRAME);
  assert.equal(transport.isClosed(), true);
});

test("close stops all writes without a [DONE] frame", () => {
  const { frames, transport } = makeTransport();
  transport.close();
  transport.sendStart();
  transport.sendToken("x");
  transport.sendError("boom");
  transport.finish();
  assert.equal(frames.length, 0);
  assert.equal(transport.isClosed(), true);
});

test("external signal abort propagates to transport.signal", () => {
  const controller = new AbortController();
  const { transport } = makeTransport({ externalSignal: controller.signal });
  assert.equal(transport.signal.aborted, false);
  controller.abort();
  assert.equal(transport.signal.aborted, true);
});

test("timeout aborts transport.signal when nothing else does", async () => {
  const { transport } = makeTransport({ timeoutMs: 20 });
  assert.equal(transport.signal.aborted, false);
  await new Promise((resolve) => transport.signal.addEventListener("abort", resolve, { once: true }));
  assert.equal(transport.signal.aborted, true);
});

test("close cancels the timeout", async () => {
  const { transport } = makeTransport({ timeoutMs: 5 });
  transport.close();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(transport.signal.aborted, false);
});

// --------------------------
// createSseParser — upstream (Cloudflare) SSE decoding
// --------------------------

test("parser emits every data frame in order", () => {
  const seen = [];
  const parser = createSseParser((d) => seen.push(d));
  parser.push('data: {"response":"a"}\n\ndata: {"response":"b"}\n\n');
  parser.flush();
  assert.deepEqual(seen, [{ response: "a" }, { response: "b" }]);
});

test("parser reassembles a JSON frame split across chunks", () => {
  const seen = [];
  const parser = createSseParser((d) => seen.push(d));
  parser.push('data: {"res');
  parser.push('ponse":"split"}\n\n');
  parser.flush();
  assert.deepEqual(seen, [{ response: "split" }]);
});

test("parser ignores [DONE], blank lines, and non-data lines", () => {
  const seen = [];
  const parser = createSseParser((d) => seen.push(d));
  parser.push('data: [DONE]\n\nevent: ping\n\ndata: {"response":"x"}\n\n');
  parser.flush();
  assert.deepEqual(seen, [{ response: "x" }]);
});

test("parser flush delivers a trailing frame with no newline", () => {
  const seen = [];
  const parser = createSseParser((d) => seen.push(d));
  parser.push('data: {"response":"tail"}');
  assert.deepEqual(seen, []);
  parser.flush();
  assert.deepEqual(seen, [{ response: "tail" }]);
});

test("parser ignores a malformed trailing chunk", () => {
  const seen = [];
  const parser = createSseParser((d) => seen.push(d));
  parser.push('data: {"broken"');
  parser.flush();
  assert.deepEqual(seen, []);
});
