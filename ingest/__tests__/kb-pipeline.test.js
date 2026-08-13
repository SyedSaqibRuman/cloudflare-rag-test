import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { transformItem } from "../pipeline.js";
import { createRegistry } from "../registry.js";

// --------------------------
// KB PIPELINE TESTS — pure transforms + registry fingerprinting, no I/O
// beyond the registry's JSON file (isolated in a temp dir per process).
// --------------------------

const ITEM = {
  title: { rendered: "Safety Manual" },
  slug: "safety-manual",
  link: "https://example.com/safety-manual",
  modified: "2026-01-01T00:00:00Z",
  content: {
    rendered:
      "<p>PopularCert safety manual with a good amount of filler text so the paragraph survives the 40-char minimum after cleaning.</p>",
  },
};

describe("kb pipeline", () => {
  it("transformItem honors r2Prefix + chunkSize (no chunk exceeds the KB size)", () => {
    const out = transformItem(ITEM, "pages", { r2Prefix: "kb/my-kb", chunkSize: 200 });

    for (const chunk of out.vectorChunks) {
      assert.ok(chunk.r2_key.startsWith("kb/my-kb/pages/"), `r2_key ${chunk.r2_key} under kb prefix`);
      assert.ok(chunk.text.length <= 200, `chunk text ${chunk.text.length} <= 200`);
    }
    assert.ok(out.vectorChunks.length > 0);
    assert.equal(out.registryKey, "pages-safety-manual");
  });

  it("default call (r2Prefix site, chunkSize 1000) matches pre-M2 behavior", () => {
    const out = transformItem(ITEM, "pages");
    const legacy = transformItem(ITEM, "pages", { r2Prefix: "site", chunkSize: 1000 });

    assert.deepEqual(out, legacy);
    assert.ok(out.vectorChunks[0].r2_key.startsWith("site/pages/"));
    for (const chunk of out.vectorChunks) {
      assert.ok(chunk.text.length <= 1000);
    }
  });

  it("two KBs sharing one source URL yield distinct vector ids (F14)", () => {
    const kbA = transformItem(ITEM, "pages", { r2Prefix: "kb/kb-a", chunkSize: 200 });
    const kbB = transformItem(ITEM, "pages", { r2Prefix: "kb/kb-b", chunkSize: 200 });

    assert.equal(kbA.vectorChunks.length, kbB.vectorChunks.length);
    for (let i = 0; i < kbA.vectorChunks.length; i++) {
      assert.notEqual(kbA.vectorChunks[i].id, kbB.vectorChunks[i].id, `vector id differs at index ${i}`);
    }
    // Same prefix → same ids (deterministic hash).
    const kbA2 = transformItem(ITEM, "pages", { r2Prefix: "kb/kb-a", chunkSize: 200 });
    assert.deepEqual(kbA2.vectorChunks, kbA.vectorChunks);
  });

  it("createRegistry fingerprint: same settings not stale, change re-stales, countDocuments excludes __meta", () => {
    const TEST_DIR = mkdtempSync(path.join(tmpdir(), "kb-registry-"));
    const prevCwd = process.cwd();
    process.chdir(TEST_DIR);
    try {
      const reg1 = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
      assert.equal(reg1.isStale("page-about", "2026-01-01"), true);
      reg1.record("page-about", "2026-01-01");
      assert.equal(reg1.countDocuments(), 1);

      // Same settings → entry is current, not stale.
      const reg2 = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
      assert.equal(reg2.isStale("page-about", "2026-01-01"), false);

      // Settings changed → every key stale (F13) even with the same modified date.
      const reg3 = createRegistry("popularcert", "docs-kb", { chunkSize: 256 });
      assert.equal(reg3.isStale("page-about", "2026-01-01"), true);

      // __meta keys are not documents.
      assert.equal(reg3.countDocuments(), 1);
    } finally {
      process.chdir(prevCwd);
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });
});
