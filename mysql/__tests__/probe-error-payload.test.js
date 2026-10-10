// --------------------------
// GATEWAY ERROR PAYLOAD TESTS
// The wrap() helper forwards structured verdicts (e.g. the KB bind-time
// embedding probe) on the JSON error body so the portal can decode them into
// actionable UI instead of parsing prose.
// Run with: node --test "mysql/__tests__/probe-error-payload.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { wrap } from "../routes/helpers.js";
import { AppError } from "../../shared/errors.js";

/** Minimal express res stub capturing status() + json(). */
function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}test("wrap exposes a structured probe verdict on the error body", async () => {
  const err = new AppError(
    "Embedding model probe failed (nvidia/nemotron-3-embed-1b: http-404) — not found. Fix or remove the embedding model binding before saving.",
    400
  );
  err.probe = { ok: false, reason: "http-404", providerKey: "nvidia", modelKey: "nemotron-3-embed-1b", detail: "404 page not found" };
  const res = mockRes();
  await wrap(async () => {
    throw err;
  })({}, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.error, /probe failed/);
  assert.deepEqual(res.body.probe, {
    ok: false,
    reason: "http-404",
    providerKey: "nvidia",
    modelKey: "nemotron-3-embed-1b",
    detail: "404 page not found",
  });
});

test("wrap omits probe when the error carries no verdict", async () => {
  const res = mockRes();
  await wrap(async () => {
    throw new AppError("No such company.", 404);
  })({}, res);
  assert.equal(res.statusCode, 404);
  assert.equal("probe" in res.body, false);
});
