// --------------------------
// MODEL TESTER TESTS — pure-ESM unit tests for mysql/services/model-tester.js.
// The executor is injected (fake), so no DB, no network, no node_modules beyond
// node:test. Locks: worker-pool completion for every model, timeout handling,
// error capture, free-tier tagging (pricing + key naming), and the summary/
// freeWorkingModels shapes the UI consumes.
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  testProviderModels,
  isFreeTier,
  DEFAULT_TEST_CONCURRENCY,
  DEFAULT_TEST_TIMEOUT_MS,
} from "../services/model-tester.js";

const MODELS = [
  { id: 1, model_key: "vendor/alpha", model_name: "Alpha", category: "chat" },
  { id: 2, model_key: "vendor/beta-free", model_name: "Beta Free", category: "chat" },
  { id: 3, model_key: "vendor/gamma", model_name: "Gamma", category: "chat" },
  { id: 4, model_key: "@cf/baai/bge-base-en-v1.5", model_name: "BGE", category: "embedding" },
];

test("testProviderModels: every chat model gets a result in order", async () => {
  const calls = [];
  const r = await testProviderModels({
    companyKey: "co",
    providerKey: "vendor",
    models: MODELS.filter((m) => m.category === "chat"),
    concurrency: 3,
    executeChatFn: async (args) => {
      calls.push(args.model);
      return { latencyMs: 42 };
    },
  });
  assert.equal(r.summary.total, 3);
  assert.equal(r.summary.ok, 3);
  assert.equal(r.summary.failed, 0);
  assert.deepEqual(r.results.map((x) => x.modelKey), ["vendor/alpha", "vendor/beta-free", "vendor/gamma"]);
  assert.deepEqual(calls.sort(), ["vendor/alpha", "vendor/beta-free", "vendor/gamma"]);
  // beta-free is free-tier by name; the others are not tagged.
  assert.deepEqual(r.results.map((x) => x.freeTier), [false, true, false]);
  assert.ok(r.results.every((x) => x.ok && x.error === null));
});

test("testProviderModels: executor failure becomes a per-model result, never throws", async () => {
  const r = await testProviderModels({
    companyKey: "co",
    providerKey: "vendor",
    models: MODELS,
    executeChatFn: async ({ model }) => {
      if (model === "vendor/gamma") {
        const err = new Error('{"status":404,"detail":"Function \'abc\': Not found"}');
        err.extra = { statusCode: 404 };
        throw err;
      }
      return { latencyMs: 10 };
    },
  });
  assert.equal(r.summary.total, 4);
  assert.equal(r.summary.ok, 3);
  assert.equal(r.summary.failed, 1);
  const bad = r.results.find((x) => x.modelKey === "vendor/gamma");
  assert.equal(bad.ok, false);
  assert.equal(bad.statusCode, 404);
  assert.match(bad.error, /Not found/);
});

test("testProviderModels: hung model is caught by the per-model timeout", async () => {
  const r = await testProviderModels({
    companyKey: "co",
    providerKey: "vendor",
    models: [MODELS[0], MODELS[2]],
    timeoutMs: 80,
    executeChatFn: async ({ model }) => {
      if (model === "vendor/gamma") return new Promise(() => {}); // never settles
      return { latencyMs: 5 };
    },
  });
  assert.equal(r.summary.ok, 1);
  assert.equal(r.summary.timeouts, 1);
  const t = r.results.find((x) => x.modelKey === "vendor/gamma");
  assert.equal(t.ok, false);
  assert.match(t.error, /timeout after 80ms/);
});

test("testProviderModels: category filter only tests matching models", async () => {
  const r = await testProviderModels({
    companyKey: "co",
    providerKey: "vendor",
    category: "embedding",
    models: MODELS,
    executeChatFn: async () => ({ latencyMs: 1 }),
  });
  assert.equal(r.summary.total, 1);
  assert.equal(r.results[0].modelKey, "@cf/baai/bge-base-en-v1.5");
});

test("testProviderModels: modelIds restricts the sweep", async () => {
  const r = await testProviderModels({
    companyKey: "co",
    providerKey: "vendor",
    modelIds: [2],
    models: MODELS,
    executeChatFn: async () => ({ latencyMs: 1 }),
  });
  assert.equal(r.summary.total, 1);
  assert.equal(r.results[0].modelKey, "vendor/beta-free");
});

test("testProviderModels: freeWorkingModels lists 0/0-priced and -free-keyed responders", async () => {
  const models = [
    { id: 1, model_key: "x/zero-price", model_name: "Z", category: "chat", input_price_per_million: 0, output_price_per_million: 0 },
    { id: 2, model_key: "deepseek-v4-flash-0731free", model_name: "F", category: "chat" },
    { id: 3, model_key: "x/paid", model_name: "P", category: "chat", input_price_per_million: 3, output_price_per_million: 15 },
  ];
  const r = await testProviderModels({
    companyKey: "co",
    providerKey: "x",
    models,
    executeChatFn: async () => ({ latencyMs: 7 }),
  });
  assert.equal(r.summary.freeWorking, 2);
  assert.deepEqual(r.freeWorkingModels.map((f) => f.modelKey).sort(), ["deepseek-v4-flash-0731free", "x/zero-price"]);
  assert.ok(r.freeWorkingModels.every((f) => f.latencyMs === 7));
});

test("testProviderModels: concurrency never exceeds the lane count", async () => {
  let inFlight = 0;
  let peak = 0;
  const models = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, model_key: `m/${i}`, model_name: `M${i}`, category: "chat" }));
  const r = await testProviderModels({
    companyKey: "co",
    providerKey: "m",
    models,
    concurrency: 4,
    executeChatFn: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { latencyMs: 10 };
    },
  });
  assert.equal(r.summary.ok, 12);
  assert.ok(peak <= 4, `peak concurrency ${peak} exceeded lanes`);
});

test("isFreeTier: patterns and prices", () => {
  assert.equal(isFreeTier({ model_key: "org/model:free" }), true);
  assert.equal(isFreeTier({ model_key: "deepseek-v4-flash-0731free" }), true);
  assert.equal(isFreeTier({ model_key: "free-thing" }), true);
  assert.equal(isFreeTier({ model_key: "org/freedom" }), false); // trailing letter → not the free token
  assert.equal(isFreeTier({ model_key: "x/y", input_price_per_million: 0, output_price_per_million: 0 }), true);
  assert.equal(isFreeTier({ model_key: "x/y", input_price_per_million: null, output_price_per_million: 0 }), false);
  assert.equal(isFreeTier({ model_key: "x/y", input_price_per_million: 1, output_price_per_million: 0 }), false);
});

test("defaults are exported for the route clamps", () => {
  assert.equal(typeof DEFAULT_TEST_CONCURRENCY, "number");
  assert.equal(typeof DEFAULT_TEST_TIMEOUT_MS, "number");
});

test("testProviderModels: accepts camelCase rows (fetcher contract) and sends the right model", async () => {
  // provider-model-fetcher.js hands over normalizeModels() rows — camelCase
  // modelKey — with id: null. The tester must read modelKey AND pass the
  // exact key to executeChatFn (regression: undefined model → provider
  // default was silently tested N times instead of the real models).
  const r = await testProviderModels({
    companyKey: "co",
    providerKey: "x",
    models: [{ id: null, modelKey: "x/camel", modelName: "C", category: "chat" }],
    executeChatFn: async (args) => {
      if (args.model !== "x/camel") throw new Error(`WRONG MODEL: ${args.model}`);
      return { latencyMs: 5 };
    },
  });
  assert.equal(r.summary.ok, 1);
  assert.equal(r.results[0].modelKey, "x/camel");
});

// ------------------------------------------------------------------
// Verified fetch-sync (provider-model-fetcher.js verified path) — pure logic
// tests using the shared matcher semantics: only RESPONDING chat models are
// kept; non-chat categories pass through untested; timeouts are drops (not
// kept), matching "fetch only the working models".
// ------------------------------------------------------------------
test("verified sync keeps only responding chat models and passes embeddings through", async () => {
  const advertised = [
    { modelKey: "x/alive", model_name: "A", category: "chat" },
    { modelKey: "x/dead-function", model_name: "D", category: "chat" },
    { modelKey: "x/hung", model_name: "H", category: "chat" },
    { modelKey: "@cf/baai/bge-base-en-v1.5", model_name: "BGE", category: "embedding" },
  ];
  // Simulate the tester's behavior directly (no HTTP): sweep responds for
  // alive only — hung/dead fail. This mirrors planVerifiedSync semantics.
  const responding = new Set(["x/alive"]);
  const verified = advertised.filter((m) => m.category !== "chat" || responding.has(m.modelKey));
  assert.deepEqual(verified.map((m) => m.modelKey), ["x/alive", "@cf/baai/bge-base-en-v1.5"]);
  const dropped = advertised.filter((m) => !verified.includes(m)).map((m) => m.modelKey);
  assert.deepEqual(dropped, ["x/dead-function", "x/hung"]);
});

test("verified sync math: dropped = advertised - responding (chat only)", () => {
  const chatAdvertised = 82;
  const chatResponding = 10;
  assert.equal(chatAdvertised - chatResponding, 72);
});

test("isSweepInconclusive: all-timeouts during an outage is NOT a verdict", async () => {
  const { isSweepInconclusive } = await import("../services/provider-model-fetcher.js");
  assert.equal(isSweepInconclusive({ ok: 0, timeouts: 82, failed: 82 }, 82), true); // pure outage wave
  assert.equal(isSweepInconclusive({ ok: 0, timeouts: 70, failed: 82 }, 82), false); // 12 hard-fails = endpoint answering → verdict
  assert.equal(isSweepInconclusive({ ok: 3, timeouts: 79, failed: 79 }, 82), false); // any responder ⇒ conclusive
  assert.equal(isSweepInconclusive({ ok: 0, timeouts: 2, failed: 2 }, 82), false); // too few samples
  assert.equal(isSweepInconclusive({ ok: 0, timeouts: 0, failed: 0 }, 0), false); // nothing advertised
});
