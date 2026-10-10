// --------------------------
// PROBE VERDICT DECODER TESTS
// web/src/probe-verdict.js decodes the structured KB embedding probe verdict
// (err.probe from the gateway 400) into display fields for the KB modal's
// failure banner. Pure ESM — no JSX, no node_modules needed.
// Run with: node --test "web/src/__tests__/probe-verdict.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeProbeVerdict } from "../probe-verdict.js";

test("decodes an http-4xx verdict into model + HTTP phrasing", () => {
  const { model, reason, detail } = decodeProbeVerdict({
    ok: false,
    reason: "http-404",
    providerKey: "nvidia",
    modelKey: "nemotron-3-embed-1b",
    detail: "Embedding request failed (404): 404 page not found",
  });
  assert.equal(model, "nvidia / nemotron-3-embed-1b");
  assert.match(reason, /HTTP 404/);
  assert.match(detail, /404 page not found/);
});

test("maps no-credential to the add-connection hint", () => {
  const { reason } = decodeProbeVerdict({ ok: false, reason: "no-credential", providerKey: "openai", modelKey: "text-embedding-3-small" });
  assert.match(reason, /AI Providers page/);
});

test("maps each known reason to its dedicated phrasing", () => {
  for (const reason of ["unresolvable", "no-credential", "adapter", "bad-response"]) {
    const out = decodeProbeVerdict({ ok: false, reason });
    assert.notEqual(out.reason, "The provider rejected the test embedding.", `${reason} should have dedicated phrasing`);
  }
});

test("falls back gracefully on an empty or partial verdict", () => {
  const empty = decodeProbeVerdict(undefined);
  assert.equal(empty.model, "the selected model");
  assert.match(empty.reason, /rejected the test embedding/);
  assert.equal(empty.detail, "");

  const partial = decodeProbeVerdict({ reason: "mystery-reason", modelKey: "some-model" });
  assert.equal(partial.model, "some-model"); // providerKey missing → modelKey only
  assert.match(partial.reason, /rejected the test embedding/);
});
