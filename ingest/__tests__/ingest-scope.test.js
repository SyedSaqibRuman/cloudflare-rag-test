// --------------------------
// INGEST SCOPE REGRESSION TESTS
// 2026-09-29: KB 'maxicert-web-auto' saved scope "limit" docLimit 3 ingested
// 288 docs. Root cause (two layers):
//   1. Portal: the Ingest button defaulted to { scope: "all" }, which
//      overrides the KB's saved scope server-side (scope || kbScope).
//   2. Server: URL/sitemap discovery defaulted to maxUrls 1000 regardless of
//      the KB's saved docLimit, so a docLimit-3 KB fetched the whole sitemap
//      (scope "all" maps to docLimit null → no trim downstream).
// Locked here: saved docLimit caps discovery (capMaxUrls + the composition
// root's createSourceAdapter seam) and scope precedence is explicit.
// --------------------------

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ==========================
// 1. capMaxUrls — saved docLimit caps URL discovery
// ==========================

describe("capMaxUrls", () => {
  it("docLimit 3 with no explicit maxUrls caps discovery at 3", async () => {
    const { capMaxUrls } = await import("../scope.js");
    assert.equal(capMaxUrls(undefined, { scope: "limit", limit: 3 }), 3);
  });

  it("intersects an explicit maxUrls with the saved docLimit", async () => {
    const { capMaxUrls } = await import("../scope.js");
    assert.equal(capMaxUrls(1000, { scope: "limit", limit: 3 }), 3);
    assert.equal(capMaxUrls(5, { scope: "limit", limit: 30 }), 5);
  });

  it("non-limit scopes never cap (adapter default applies)", async () => {
    const { capMaxUrls } = await import("../scope.js");
    assert.equal(capMaxUrls(undefined, { scope: "all" }), undefined);
    assert.equal(capMaxUrls(undefined, { scope: "selected", items: [1, 2] }), undefined);
    assert.equal(capMaxUrls(undefined, null), undefined);
  });

  it("explicit maxUrls alone still caps; garbage values are ignored", async () => {
    const { capMaxUrls } = await import("../scope.js");
    assert.equal(capMaxUrls(42, null), 42);
    assert.equal(capMaxUrls(0, { scope: "limit", limit: 3 }), 3); // 0 is not a cap
    assert.equal(capMaxUrls(-5, { scope: "limit", limit: "3" }), 3); // string docLimit coerced
  });
});

// ==========================
// 2. resolveEffectiveScope — request scope wins, saved scope applies
// ==========================

describe("resolveEffectiveScope", () => {
  it("explicit request scope wins over the KB's saved scope", async () => {
    const { resolveEffectiveScope } = await import("../scope.js");
    assert.deepEqual(resolveEffectiveScope({ scope: "all" }, { scope: "limit", limit: 3 }), { scope: "all" });
  });

  it("falls back to saved scope, then legacy maxPages, then all", async () => {
    const { resolveEffectiveScope } = await import("../scope.js");
    assert.deepEqual(resolveEffectiveScope(null, { scope: "limit", limit: 3 }), { scope: "limit", limit: 3 });
    assert.deepEqual(resolveEffectiveScope(null, null, 5), { scope: "limit", limit: 5 });
    assert.deepEqual(resolveEffectiveScope(null, null, undefined), { scope: "all" });
  });
});

// ==========================
// 3. Composition root — the saved docLimit reaches the source adapter
// ==========================

import http from "node:http";

/** Sitemap XML with `count` page URLs against `base`. */
function sitemapXml(base, count) {
  const urls = Array.from({ length: count }, (_, i) => `  <url><loc>${base}/page-${i}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

/** One ingested page — content long enough to survive chunk filtering. */
function pageHtml(n) {
  const para = `<p>Page ${n} content paragraph with plenty of text for chunking and retrieval testing.</p>`;
  return `<html><head><title>Page ${n}</title></head><body><main>${para.repeat(8)}</main></body></html>`;
}

/** Start a loopback server for the sitemap + pages; resolves to the base URL. */
async function withSitemapServer(count, fn) {
  const server = http.createServer((req, res) => {
    if (req.url === "/sitemap.xml") {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(sitemapXml("http://127.0.0.1", count)); // host fixed up below
      return;
    }
    const m = req.url.match(/^\/page-(\d+)$/);
    if (m) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(pageHtml(m[1]));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  // The sitemap body was generated before the port was known — regenerate with it.
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    if (req.url === "/sitemap.xml") {
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(sitemapXml(base, count));
      return;
    }
    const m = req.url.match(/^\/page-(\d+)$/);
    if (m) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(pageHtml(m[1]));
      return;
    }
    res.writeHead(404).end();
  });
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("createSourceAdapter maxUrls seam (ingest.js composition)", () => {
  it("a sitemap KB with saved docLimit 3 ingests only 3 targets, not all 20", async () => {
    const { createSourceAdapter } = await import("../sources/index.js");
    await withSitemapServer(20, async (base) => {
      // Exactly what ingest.js now passes: the saved docLimit (3) intersected
      // into the discovery cap. Before the fix this returned 20 items.
      const adapter = createSourceAdapter({
        sourceType: "url",
        kb: {
          kb_key: "cap-kb",
          source_type: "url",
          source_config: { sitemapUrl: `${base}/sitemap.xml`, scope: "limit", docLimit: 3 },
        },
        companyName: "acme",
        wpAdapters: {},
        maxUrls: 3,
      });
      const items = await adapter.fetchPage(1, "acme");
      assert.ok(Array.isArray(items));
      assert.equal(items.length, 3);
    });
  });

  it("a sitemap URL that yields nothing returns null (page errors tolerated, §28)", async () => {
    const { createSourceAdapter } = await import("../sources/index.js");
    await withSitemapServer(20, async (base) => {
      const adapter = createSourceAdapter({
        sourceType: "url",
        kb: { kb_key: "missing-kb", source_type: "url", source_config: { sitemapUrl: `${base}/nope.xml` } },
        companyName: "acme",
        wpAdapters: {},
      });
      // The crawler tolerates a bad sitemap inside the walk (§28); with zero
      // resolved targets fetchPage reports exhaustion as null instead of throwing.
      assert.equal(await adapter.fetchPage(1, "acme"), null);
    });
  });

  it("source_config without scope/maxUrls still creates the adapter (defaults apply)", async () => {
    const { createSourceAdapter } = await import("../sources/index.js");
    await withSitemapServer(4, async (base) => {
      const adapter = createSourceAdapter({
        sourceType: "url",
        kb: { kb_key: "plain-kb", source_type: "url", source_config: { sitemapUrl: `${base}/sitemap.xml` } },
        companyName: "acme",
        wpAdapters: {},
      });
      const items = await adapter.fetchPage(1, "acme");
      assert.equal(items.length, 4); // default cap 1000 → all 4 fetched
    });
  });
});
