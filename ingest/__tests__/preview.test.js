// --------------------------
// INGESTED DOCUMENT PREVIEW TESTS — pure-ESM tests for ingest/preview.js.
// No storage I/O: slug derivation and chunk assembly only.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { slugify, documentChunkPrefix, assembleDocumentPreview } from "../preview.js";

describe("slugify", () => {
  it("mirrors pipeline.js slugify (non-word chars → _, lowercase)", () => {
    // Pipeline: .replace(/https?:\/\//, "").replace(/[^\w]/g, "_").toLowerCase()
    assert.equal(slugify("post-How-Much Does It Cost?"), "post_how_much_does_it_cost_");
    assert.equal(slugify("page-contact-us"), "page_contact_us");
    assert.equal(slugify("https://example.com/some path"), "example_com_some_path");
  });
});

describe("documentChunkPrefix", () => {
  it("reproduces the pipeline layout <r2Prefix>/<type>/<slugified key>", () => {
    // pipeline.js: r2_key = `${r2Prefix}/${type}/${pageSlug}/chunk-${i}.json`
    assert.equal(documentChunkPrefix("kb/my-kb", "post-my-post"), "kb/my-kb/post/post_my_post");
    assert.equal(documentChunkPrefix("site", "page-contact"), "site/page/page_contact");
  });

  it("matches transformItem's pageSlug derivation end-to-end", () => {
    const registryKey = "post-iso-9001-certification";
    assert.equal(documentChunkPrefix("kb/docs", registryKey), `kb/docs/post/${slugify(registryKey)}`);
  });
});

describe("assembleDocumentPreview", () => {
  it("sorts chunks by metadata.chunkIndex regardless of input order", () => {
    const result = assembleDocumentPreview([
      { content: "third", title: "T", metadata: { chunkIndex: 2 } },
      { content: "first", title: "T", metadata: { chunkIndex: 0 } },
      { content: "second", title: "T", metadata: { chunkIndex: 1 } },
    ]);
    assert.equal(result.content, "first\n\nsecond\n\nthird");
    assert.equal(result.chunkCount, 3);
    assert.equal(result.truncated, false);
  });

  it("takes title/url from the first chunk that has them", () => {
    const result = assembleDocumentPreview([
      { content: "a", metadata: { chunkIndex: 0 } },
      { content: "b", title: "Real Title", url: "https://x.test/p", metadata: { chunkIndex: 1 } },
    ]);
    assert.equal(result.title, "Real Title");
    assert.equal(result.url, "https://x.test/p");
  });

  it("returns an empty-ish preview for no/blank chunks", () => {
    const empty = assembleDocumentPreview([]);
    assert.equal(empty.content, "");
    assert.equal(empty.title, "Untitled");
    assert.equal(empty.chunkCount, 0);

    const blanks = assembleDocumentPreview([{ content: "  ", metadata: { chunkIndex: 0 } }]);
    assert.equal(blanks.content, "");
  });

  it("truncates very large documents at the preview cap", () => {
    const big = "x".repeat(70000);
    const result = assembleDocumentPreview([{ content: big, title: "Big", metadata: { chunkIndex: 0 } }]);
    assert.ok(result.content.length <= 60000);
    assert.equal(result.truncated, true);
  });

  it("skips chunks without content but still counts them", () => {
    const result = assembleDocumentPreview([
      { content: "real", title: "T", metadata: { chunkIndex: 0 } },
      { metadata: { chunkIndex: 1 } },
      { content: "more", title: "T", metadata: { chunkIndex: 2 } },
    ]);
    assert.equal(result.content, "real\n\nmore");
    assert.equal(result.chunkCount, 3);
  });
});
