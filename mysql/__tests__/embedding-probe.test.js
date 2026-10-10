// --------------------------
// EMBEDDING PROBE TESTS — pure unit tests, no MySQL, no network.
// probeEmbeddingModel is exercised with injected seams (resolveModel,
// findCredential, createAdapter) so the verdict logic — healthy / dead (4xx) /
// no-credential / unsupported-provider / transient-outage fail-open — is locked
// without a live provider. This is the bind-time guard added after the NVIDIA
// nemotron-3-embed-1b papercut (KB accepted a model whose endpoint 404'd).
// --------------------------
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { probeEmbeddingModel } from "../services/embedding-probe.js";

const MODEL_ID = 42;

const healthyModel = {
  providerKey: "nvidia",
  modelKey: "nvidia/test-embed",
  model: { id: MODEL_ID },
  provider: { id: 7, provider_key: "nvidia" },
};

function goodDeps(overrides = {}) {
  return {
    resolveModel: async () => healthyModel,
    findCredential: async () => ({ id: 1, provider_id: 7 }),
    createAdapter: () => ({ embed: async () => new Array(768).fill(0.1) }),
    ...overrides,
  };
}

describe("probeEmbeddingModel", () => {
  test("healthy model → ok with dims + latency", async () => {
    const out = await probeEmbeddingModel(
      { companyId: 1, embeddingModelId: MODEL_ID },
      goodDeps()
    );
    assert.equal(out.ok, true);
    assert.equal(out.skipped, undefined);
    assert.equal(out.dims, 768);
    assert.equal(out.providerKey, "nvidia");
    assert.ok(typeof out.ms === "number");
  });

  test("no model bound → skipped ok (nothing to probe)", async () => {
    const out = await probeEmbeddingModel({ companyId: 1, embeddingModelId: null }, goodDeps());
    assert.equal(out.ok, true);
    assert.equal(out.skipped, true);
    assert.equal(out.reason, "no-model");
  });

  test("unresolvable model row → rejected", async () => {
    const out = await probeEmbeddingModel(
      { companyId: 1, embeddingModelId: MODEL_ID },
      goodDeps({ resolveModel: async () => { throw new Error("Model not found"); } })
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "unresolvable");
  });

  test("adapter factory throws (unsupported provider) → rejected with 'adapter'", async () => {
    const out = await probeEmbeddingModel(
      { companyId: 1, embeddingModelId: MODEL_ID },
      goodDeps({
        createAdapter: () => { throw new Error("Unsupported embedding provider: nvidia"); },
      })
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "adapter");
    assert.match(out.detail, /Unsupported embedding provider/);
  });

  test("no active credential for the provider → rejected with a fix hint", async () => {
    const out = await probeEmbeddingModel(
      { companyId: 1, embeddingModelId: MODEL_ID },
      goodDeps({ findCredential: async () => null })
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no-credential");
    assert.match(out.detail, /add the connection on the AI Providers page/);
  });

  test("endpoint 404 (dead model like NVIDIA papercut) → REJECTED as http-404", async () => {
    const err = new Error("Embedding request failed (404): 404 page not found");
    err.status = 404;
    const out = await probeEmbeddingModel(
      { companyId: 1, embeddingModelId: MODEL_ID },
      goodDeps({ createAdapter: () => ({ embed: async () => { throw err; } }) })
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "http-404");
    assert.match(out.detail, /404 page not found/);
  });

  test("endpoint 401 (bad key) → REJECTED", async () => {
    const err = new Error("Embedding request failed (401): Unauthorized");
    err.status = 401;
    const out = await probeEmbeddingModel(
      { companyId: 1, embeddingModelId: MODEL_ID },
      goodDeps({ createAdapter: () => ({ embed: async () => { throw err; } }) })
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "http-401");
  });

  test("endpoint 5xx → FAIL-OPEN (transient outage must not brick configuration)", async () => {
    const err = new Error("Embedding request failed (503): Service Unavailable");
    err.status = 503;
    const out = await probeEmbeddingModel(
      { companyId: 1, embeddingModelId: MODEL_ID },
      goodDeps({ createAdapter: () => ({ embed: async () => { throw err; } }) })
    );
    assert.equal(out.ok, true);
    assert.equal(out.skipped, true);
    assert.equal(out.reason, "provider-outage");
  });

  test("network error → FAIL-OPEN (transient)", async () => {
    const out = await probeEmbeddingModel(
      { companyId: 1, embeddingModelId: MODEL_ID },
      goodDeps({
        createAdapter: () => ({
          embed: async () => { throw new Error("Network error: ECONNREFUSED"); },
        }),
      })
    );
    assert.equal(out.ok, true);
    assert.equal(out.skipped, true);
    assert.equal(out.reason, "transient");
  });

  test("empty vector response → rejected as bad-response", async () => {
    const out = await probeEmbeddingModel(
      { companyId: 1, embeddingModelId: MODEL_ID },
      goodDeps({ createAdapter: () => ({ embed: async () => [] }) })
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "bad-response");
  });
});
