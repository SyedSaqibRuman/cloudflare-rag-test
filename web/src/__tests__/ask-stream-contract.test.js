// --------------------------
// ASK-STREAM CONTRACT TESTS
// Pure ESM — no browser, no node_modules needed. Verifies that parsed SSE
// frames from /ask-stream map to the right callbacks, including the
// possibleQuestions and structured __start frames the Test AI page renders.
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAskFrame, START_SENTINEL } from "../ask-stream-contract.js";

function handlers() {
  const h = { tokens: [], starts: [], questions: [], errors: [] };
  return {
    tokens: h.tokens,
    starts: h.starts,
    questions: h.questions,
    errors: h.errors,
    onToken: (t) => h.tokens.push(t),
    onStart: (meta) => h.starts.push(meta),
    onPossibleQuestions: (q) => h.questions.push(q),
    onError: (e) => h.errors.push(e),
  };
}

test("token frames are forwarded in order", () => {
  const h = handlers();
  applyAskFrame({ token: "ISO" }, h);
  applyAskFrame({ token: " 9001" }, h);
  applyAskFrame({ token: " is a standard" }, h);
  assert.deepEqual(h.tokens, ["ISO", " 9001", " is a standard"]);
  assert.equal(h.starts.length, 0);
  assert.equal(h.questions.length, 0);
});

test("legacy __START_RESPONSE__ sentinel is filtered, not forwarded", () => {
  const h = handlers();
  applyAskFrame({ token: START_SENTINEL }, h);
  applyAskFrame({ token: "Hello" }, h);
  assert.deepEqual(h.tokens, ["Hello"]);
});

test("structured __start frame forwards sources, matches, and graph", () => {
  const h = handlers();
  const sources = [{ title: "ISO 9001 in Angola", score: 0.86 }];
  const matches = [{ id: "chunk-1", score: 0.86, metadata: { title: "ISO 9001 in Angola" } }];
  const graph = { cypher: "MATCH (c) RETURN c", context: "3 related standards" };
  applyAskFrame({ __start: true, sources, matches, graph }, h);
  assert.equal(h.starts.length, 1);
  assert.deepEqual(h.starts[0], { sources, matches, graph });
  assert.equal(h.tokens.length, 0);
});

test("legacy standalone sources frame still reaches onStart", () => {
  const h = handlers();
  applyAskFrame({ sources: [{ title: "Old frame", score: 0.5 }] }, h);
  assert.equal(h.starts.length, 1);
  assert.deepEqual(h.starts[0].sources, [{ title: "Old frame", score: 0.5 }]);
});

test("possibleQuestions frame is forwarded as-is (including empty list)", () => {
  const h = handlers();
  const questions = ["What is ISO 9001?", "How long does certification take?"];
  applyAskFrame({ possibleQuestions: questions }, h);
  applyAskFrame({ possibleQuestions: [] }, h);
  assert.deepEqual(h.questions, [questions, []]);
  assert.equal(h.tokens.length, 0);
});

test("error frames reach onError", () => {
  const h = handlers();
  applyAskFrame({ error: "Model timeout" }, h);
  assert.deepEqual(h.errors, ["Model timeout"]);
});

test("unknown frames are ignored without throwing", () => {
  const h = handlers();
  applyAskFrame({ random: true }, h);
  applyAskFrame({ __start: false }, h);
  applyAskFrame({ token: "" }, h);
  assert.deepEqual(h.tokens, []);
  assert.deepEqual(h.starts, []);
  assert.deepEqual(h.questions, []);
  assert.deepEqual(h.errors, []);
});