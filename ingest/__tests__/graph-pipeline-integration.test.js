// --------------------------
// GRAPH PIPELINE INTEGRATION — verifies graph adapter is wired into
// the ingest pipeline's processItemBatch → extractFromChunks flow.
// Uses in-memory fakes (same pattern as pipeline.test.js).
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processContent } from "../pipeline.js";

// ---------------------------------------------------------------------------
// In-memory adapter fakes
// ---------------------------------------------------------------------------
function makeFakes({ skipKeys = [] } = {}) {
  const store = {
    saved: [],
    uploads: [],
    ensureBucket: async function () {},
    saveContent: function (name, markdown) { this.saved.push({ name, markdown }); },
    uploadChunk: async function (r2Key, payload) { this.uploads.push({ r2Key, payload }); },
  };
  const index = {
    upserts: [],
    ensureIndex: async function () {},
    upsert: async function (chunks) { this.upserts.push(chunks); return chunks.length; },
  };
  const registry = {
    recorded: [],
    isStale: (key) => !skipKeys.includes(key),
    record: function (key) { this.recorded.push(key); },
  };
  return { store, index, registry };
}

function item(slug, html = "<p>PopularCert ISO 9001 certification content here.</p>") {
  return {
    title: { rendered: "Title " + slug },
    slug,
    link: `https://example.com/${slug}`,
    modified: "2026-01-01T00:00:00Z",
    content: { rendered: html },
  };
}

function pager(...pages) {
  const fn = async (page) => {
    fn.calls.push(page);
    return pages[page - 1] || [];
  };
  fn.calls = [];
  return fn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("graph adapter integration in pipeline", () => {
  it("calls graphAdapter.extractFromChunks when provided", async () => {
    const { store, index, registry } = makeFakes();
    const fetchFn = pager([item("alpha")]);

    let extractCalls = [];
    const graphAdapter = {
      extractFromChunks: async (chunks, signal) => {
        extractCalls.push({ chunks: chunks.length, signal });
        return { nodesCreated: 2, relationshipsCreated: 1 };
      },
    };

    await processContent({
      fetchFn,
      type: "post",
      store,
      index,
      registry,
      signal: null,
      companyName: "co",
      graphAdapter,
    });

    // Graph extraction should have been called once with the chunks from item "alpha"
    assert.equal(extractCalls.length, 1);
    assert.ok(extractCalls[0].chunks > 0);
  });

  it("pipeline works without graphAdapter (null)", async () => {
    const { store, index, registry } = makeFakes();
    const fetchFn = pager([item("beta")]);

    await processContent({
      fetchFn,
      type: "post",
      store,
      index,
      registry,
      signal: null,
      companyName: "co",
      graphAdapter: null,
    });

    // Pipeline completes normally without graph adapter
    assert.equal(store.uploads.length, 1);
    assert.equal(index.upserts.length, 1);
    assert.deepEqual(registry.recorded, ["post-beta"]);
  });

  it("pipeline works without graphAdapter (undefined)", async () => {
    const { store, index, registry } = makeFakes();
    const fetchFn = pager([item("gamma")]);

    await processContent({
      fetchFn,
      type: "post",
      store,
      index,
      registry,
      signal: null,
      companyName: "co",
      // no graphAdapter property at all
    });

    assert.equal(store.uploads.length, 1);
    assert.deepEqual(registry.recorded, ["post-gamma"]);
  });

  it("graph extraction failure does not block pipeline", async () => {
    const { store, index, registry } = makeFakes();
    const fetchFn = pager([item("delta")]);

    const graphAdapter = {
      extractFromChunks: async () => {
        throw new Error("Neo4j connection refused");
      },
    };

    // Pipeline catches graph errors best-effort (try/catch in processItemBatch)
    await processContent({
      fetchFn,
      type: "post",
      store,
      index,
      registry,
      signal: null,
      companyName: "co",
      graphAdapter,
    });

    // Pipeline still completes: content stored, vectors upserted, registry recorded
    assert.equal(store.uploads.length, 1, "content still uploaded");
    assert.equal(index.upserts.length, 1, "vectors still upserted");
    assert.deepEqual(registry.recorded, ["post-delta"], "registry still recorded");
  });

  it("graph adapter receives chunk metadata (id, text, title, url)", async () => {
    const { store, index, registry } = makeFakes();
    const fetchFn = pager([item("epsilon")]);

    let capturedChunks = [];
    const graphAdapter = {
      extractFromChunks: async (chunks) => {
        capturedChunks = chunks;
        return { nodesCreated: 0, relationshipsCreated: 0 };
      },
    };

    await processContent({
      fetchFn,
      type: "post",
      store,
      index,
      registry,
      signal: null,
      companyName: "co",
      graphAdapter,
    });

    assert.ok(capturedChunks.length > 0);
    const chunk = capturedChunks[0];
    assert.ok(chunk.id, "chunk should have id");
    assert.ok(chunk.text, "chunk should have text");
    assert.ok(chunk.title, "chunk should have title");
    assert.ok(chunk.url, "chunk should have url");
  });
});
