import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processContent, runIngestion } from "../pipeline.js";
import { AbortError } from "../../utils/helpers.js";

// --------------------------
// In-memory adapter fakes — the whole pipeline runs with zero I/O.
// --------------------------
function makeFakes({ skipKeys = [] } = {}) {
  const store = {
    ensureBucketCalls: 0,
    saved: [],
    uploads: [],
    ensureBucket: async function () { this.ensureBucketCalls++; },
    saveContent: function (name, markdown) { this.saved.push({ name, markdown }); },
    uploadChunk: async function (r2Key, payload) { this.uploads.push({ r2Key, payload }); },
  };
  const index = {
    ensureIndexCalls: 0,
    upserts: [],
    ensureIndex: async function () { this.ensureIndexCalls++; },
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

// --------------------------
// processContent
// --------------------------
describe("ingest pipeline", () => {
  it("paginates, stores, indexes, and records each item once", async () => {
    const { store, index, registry } = makeFakes();
    const fetchFn = pager([item("alpha")]);

    await processContent({ fetchFn, type: "post", store, index, registry, signal: null, companyName: "co" });

    // Page 1 fetched, then the empty page 2 terminates the loop.
    assert.deepEqual(fetchFn.calls, [1, 2]);

    // Content saved locally, chunks uploaded to R2.
    assert.equal(store.saved.length, 1);
    assert.equal(store.saved[0].name, "post-alpha");
    assert.equal(store.uploads.length, 1);
    assert.ok(store.uploads[0].r2Key.endsWith("/chunk-0.json"));

    // One upsert per item — no outer batch loop duplicating vectorize batching.
    assert.equal(index.upserts.length, 1);
    assert.equal(index.upserts[0].length, 1);

    // Registry records the content key with its modified date.
    assert.deepEqual(registry.recorded, ["post-alpha"]);
  });

  it("skips content that is not stale", async () => {
    const { store, index, registry } = makeFakes({ skipKeys: ["post-alpha"] });
    const fetchFn = pager([item("alpha")]);

    await processContent({ fetchFn, type: "post", store, index, registry, signal: null, companyName: "co" });

    assert.equal(store.uploads.length, 0);
    assert.equal(index.upserts.length, 0);
    assert.deepEqual(registry.recorded, []);
  });

  it("propagates AbortError instead of swallowing it", async () => {
    const { store, index, registry } = makeFakes();
    const fetchFn = pager([item("alpha")]);
    const aborted = new AbortController();
    aborted.abort();

    await assert.rejects(
      processContent({ fetchFn, type: "post", store, index, registry, signal: aborted.signal, companyName: "co" }),
      (err) => err instanceof AbortError
    );
  });

  it("runIngestion ensures bucket + index, then processes posts and pages", async () => {
    const { store, index, registry } = makeFakes();
    const fetchPost = pager([item("alpha")]);
    const fetchPage = pager([item("about")]);

    await runIngestion({ fetchPost, fetchPage, store, index, registry, signal: null, companyName: "co" });

    assert.equal(store.ensureBucketCalls, 1);
    assert.equal(index.ensureIndexCalls, 1);
    assert.deepEqual(registry.recorded.sort(), ["page-about", "post-alpha"]);
  });

  it("respects an abort signal raised mid-run", async () => {
    const { store, index, registry } = makeFakes();
    const controller = new AbortController();
    store.uploadChunk = async (r2Key, payload) => {
      store.uploads.push({ r2Key, payload });
      controller.abort(); // signal fires while the item is mid-upload
    };
    const fetchFn = pager([item("alpha")]);

    await assert.rejects(
      processContent({ fetchFn, type: "post", store, index, registry, signal: controller.signal, companyName: "co" }),
      (err) => err instanceof AbortError
    );
    // The chunk was uploaded, then the abort stopped the rest of the item.
    assert.equal(store.uploads.length, 1);
    assert.deepEqual(registry.recorded, []);
  });
});
