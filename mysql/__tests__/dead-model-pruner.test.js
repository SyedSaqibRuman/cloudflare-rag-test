// --------------------------
// DEAD-MODEL PRUNER TESTS — pure-ESM tests for mysql/services/dead-model-pruner.js.
// Lock the classification contract: ONLY definitive "model does not exist"
// responses are prunable (function-not-found 404s); timeouts and soft failures
// (5xx / inference / quota) must always be kept. No I/O, no node_modules.
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifySweepResult, partitionSweep } from "../services/dead-model-pruner.js";

test("classifySweepResult: function-not-found 404s are prunable", () => {
  assert.equal(
    classifySweepResult({
      ok: false,
      error: '{"status":404,"title":"Not Found","detail":"Function \'e598bfc1-b058-41af-869d-556d3c7e1b48\': Not found for account \'84Nt\'"}',
    }),
    "prune"
  );
  assert.equal(classifySweepResult({ ok: false, error: "404 page not found" }), "prune");
  assert.equal(classifySweepResult({ ok: false, error: "Function '23bd454d-b225-49a3-8118-582a62fc51b8': Not found" }), "prune");
});

test("classifySweepResult: timeouts are NEVER prunable", () => {
  assert.equal(classifySweepResult({ ok: false, error: "timeout after 20000ms (no response)" }), "keep");
});

test("classifySweepResult: soft failures are kept", () => {
  assert.equal(classifySweepResult({ ok: false, error: '{"title":"Internal Server Error","status":500}' }), "keep");
  assert.equal(classifySweepResult({ ok: false, error: "Error during inference of request chat-0ee9" }), "keep");
  assert.equal(classifySweepResult({ ok: false, error: "ResourceExhausted: Worker local total request limit reached (106/16)" }), "keep");
  assert.equal(classifySweepResult({ ok: false, error: 'No route for that URI' }), "keep");
  assert.equal(classifySweepResult({ ok: false, error: "" }), "keep"); // unknown → keep
});

test("classifySweepResult: ok results are 'ok'", () => {
  assert.equal(classifySweepResult({ ok: true, latencyMs: 600 }), "ok");
  assert.equal(classifySweepResult(null), "keep"); // defensive
});

test("partitionSweep: buckets every result exactly once", () => {
  const results = [
    { modelKey: "a", ok: true },
    { modelKey: "b", ok: false, error: "Function 'x': Not found" },
    { modelKey: "c", ok: false, error: "timeout after 20000ms (no response)" },
    { modelKey: "d", ok: false, error: '{"status":500}' },
    { modelKey: "e", ok: false, error: "404 page not found" },
  ];
  const { prune, keep, ok } = partitionSweep(results);
  assert.deepEqual(prune.map((r) => r.modelKey), ["b", "e"]);
  assert.deepEqual(keep.map((r) => r.modelKey), ["c", "d"]);
  assert.deepEqual(ok.map((r) => r.modelKey), ["a"]);
});

test("partitionSweep: empty sweep → empty buckets", () => {
  const { prune, keep, ok } = partitionSweep([]);
  assert.equal(prune.length, 0);
  assert.equal(keep.length, 0);
  assert.equal(ok.length, 0);
});
