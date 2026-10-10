// --------------------------
// INGEST SCOPE DEFAULT TESTS — pure-ESM tests for web/src/ingest-scope.js.
// Regression lock for the 2026-09-29 over-ingest: KB 'maxicert-web-auto' was
// saved (wizard) with scope "limit" docLimit 3, but the Ingestion page's
// Ingest button defaulted its scope to { type: "all" } and sent it on every
// run — the server treats an explicit request scope as an override, so the
// saved docLimit was bypassed and 288 documents were ingested. The button's
// default must now be DERIVED from the KB's saved source_config.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultIngestScope } from "../ingest-scope.js";

describe("defaultIngestScope — derives the Ingest default from saved source_config", () => {
  it("a KB saved with scope limit 3 defaults to limit 3 (the regression)", () => {
    const kb = { source_config: { websiteUrl: "https://maxicert.com", scope: "limit", docLimit: 3 } };
    assert.deepEqual(defaultIngestScope(kb), { type: "limit", limit: 3 });
  });

  it("a KB saved with scope all defaults to all", () => {
    const kb = { source_config: { sitemapUrl: "https://x/sitemap.xml", scope: "all" } };
    assert.deepEqual(defaultIngestScope(kb), { type: "all", limit: null });
  });

  it("a KB saved with scope selected defaults to selected", () => {
    const kb = { source_config: { scope: "selected", selectedPages: ["a", "b"] } };
    assert.deepEqual(defaultIngestScope(kb), { type: "selected", limit: null });
  });

  it("string source_config (JSON column) is parsed", () => {
    const kb = { source_config: JSON.stringify({ scope: "limit", docLimit: 12 }) };
    assert.deepEqual(defaultIngestScope(kb), { type: "limit", limit: 12 });
  });

  it("legacy KBs without source_config default to all (historical behavior)", () => {
    assert.deepEqual(defaultIngestScope({}), { type: "all", limit: null });
    assert.deepEqual(defaultIngestScope({ source_config: null }), { type: "all", limit: null });
    assert.deepEqual(defaultIngestScope(null), { type: "all", limit: null });
  });

  it("a corrupt docLimit falls back to 100 instead of sweeping the site", () => {
    const kb = { source_config: { scope: "limit", docLimit: "not-a-number" } };
    assert.deepEqual(defaultIngestScope(kb), { type: "limit", limit: 100 });
  });
});
