// --------------------------
// EMBED FALLBACK TESTS — pure ESM, no external network.
// Locks the ingest-side embedding contract (mysql/adapters/embed-fallback.js):
// a KB's embedding adapter that is missing, throws, or returns a mismatched
// count must fall back to the company CF embeddings — mirroring the query-side
// contract in query/kb-retrieval.js embedQuestion. Root cause fixed 2026-09-23:
// a dead NVIDIA embedding adapter 404'd at ask time and retrieval returned
// empty for a fully ingested Qdrant KB.
//
// Network: only localhost is blocked — the CF embeddings call is stubbed by
// intercepting globalThis.fetch. A throwaway company is registered so
// resolveCreds('…') finds a config (company config store, SQLite backend in a
// temp dir) without touching MySQL.
// --------------------------
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate config store in a temp dir BEFORE importing config (same trick as
// routes/__tests__ — each test file runs in its own process).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "embed-fallback-"));
process.chdir(tmpDir);

import { initConfig, createCompany } from "../../config/index.js";
import { embedBatchWithFallback, createEmbedFallbackStats } from "../../mysql/adapters/embed-fallback.js";

const TEST_COMPANY = "embed-fallback-test";
const originalFetch = globalThis.fetch;
const cfCalls = [];

function stubCFEmbeddings(dims = 768) {
  cfCalls.length = 0;
  globalThis.fetch = async (url, opts) => {
    cfCalls.push(String(url));
    const body = JSON.parse(opts?.body || "{}");
    const texts = Array.isArray(body?.text) ? body.text : [String(body?.text ?? "")];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        success: true,
        result: {
          data: texts.map(() => new Array(dims).fill(0.1)),
          shape: [texts.length, dims],
        },
      }),
    };
  };
}

describe("embedBatchWithFallback", () => {
  before(async () => {
    await initConfig();
    await createCompany(TEST_COMPANY);
  });

  after(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // utils/logger.js keeps a batching timer alive — exit once tests are done.
    process.exit(0);
  });

  test("uses the KB adapter when it works", async () => {
    stubCFEmbeddings();
    try {
      const adapter = { embed: async (_t) => new Array(4).fill(0.5) };
      const out = await embedBatchWithFallback(adapter, ["a", "b"], TEST_COMPANY);
      assert.equal(out.length, 2);
      assert.deepEqual(out[0], new Array(4).fill(0.5));
      assert.equal(cfCalls.length, 0, "CF embeddings must not be called when the adapter works");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to CF embeddings when the adapter throws (dead NVIDIA 404 case)", async () => {
    stubCFEmbeddings();
    try {
      const adapter = {
        embed: async () => {
          throw new Error("Embedding request failed (404): 404 page not found");
        },
      };
      const out = await embedBatchWithFallback(adapter, ["a", "b", "c"], TEST_COMPANY);
      assert.equal(out.length, 3);
      assert.equal(out[0].length, 768, "fallback vectors come from CF (768 dims)");
      assert.ok(cfCalls.length >= 1, "CF embeddings endpoint was called");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back when the adapter is missing or has no embed()", async () => {
    stubCFEmbeddings();
    try {
      const out = await embedBatchWithFallback(null, ["a"], TEST_COMPANY);
      assert.equal(out.length, 1);
      assert.equal(out[0].length, 768);
      const out2 = await embedBatchWithFallback({}, ["a"], TEST_COMPANY);
      assert.equal(out2.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("passes through adapter vectors as-is (store-level dimension guard catches bad shapes)", async () => {
    stubCFEmbeddings();
    try {
      // A 4-dim vector is NOT a count mismatch (Promise.all preserves count) —
      // it passes through; the vector store's dimension guard rejects it at
      // upsert time if it doesn't match the index.
      const adapter = { embed: async () => new Array(4).fill(0.5) };
      const out = await embedBatchWithFallback(adapter, ["a", "b"], TEST_COMPANY);
      assert.equal(out.length, 2);
      assert.deepEqual(out[0], new Array(4).fill(0.5));
      assert.equal(cfCalls.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // ---- Fallback visibility (KB detail warning card) ----

  test("stats: adapter success counts adapterBatches, no fallbacks", async () => {
    stubCFEmbeddings();
    try {
      const stats = createEmbedFallbackStats();
      const adapter = { embed: async (_t) => new Array(4).fill(0.5) };
      await embedBatchWithFallback(adapter, ["a", "b"], TEST_COMPANY, { stats });
      assert.equal(stats.adapterBatches, 1);
      assert.equal(stats.fallbackBatches, 0);
      assert.equal(stats.lastError, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stats: adapter throw counts fallbackBatches + records lastError (dead NVIDIA case)", async () => {
    stubCFEmbeddings();
    try {
      const stats = createEmbedFallbackStats();
      const adapter = {
        embed: async () => {
          throw new Error("Embedding request failed (404): 404 page not found");
        },
      };
      await embedBatchWithFallback(adapter, ["a"], TEST_COMPANY, { stats });
      await embedBatchWithFallback(adapter, ["b", "c"], TEST_COMPANY, { stats });
      assert.equal(stats.fallbackBatches, 2);
      assert.equal(stats.adapterBatches, 0);
      assert.match(stats.lastError, /404 page not found/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("stats: unbound adapter is NOT a fallback (CF is the primary path)", async () => {
    stubCFEmbeddings();
    try {
      const stats = createEmbedFallbackStats();
      await embedBatchWithFallback(null, ["a"], TEST_COMPANY, { stats });
      assert.equal(stats.fallbackBatches, 0, "no adapter bound → nothing to fall back FROM");
      assert.equal(stats.lastError, null);
      assert.ok(cfCalls.length >= 1, "CF embeddings still used");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("onFallback callback fires with reason + error detail", async () => {
    stubCFEmbeddings();
    try {
      const events = [];
      const adapter = {
        embed: async () => {
          throw new Error("boom");
        },
      };
      await embedBatchWithFallback(adapter, ["a", "b"], TEST_COMPANY, {
        onFallback: (info) => events.push(info),
      });
      assert.equal(events.length, 1);
      assert.equal(events[0].reason, "error");
      assert.equal(events[0].texts, 2);
      assert.match(events[0].error, /boom/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
