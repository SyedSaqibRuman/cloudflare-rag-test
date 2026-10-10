// --------------------------
// SITEMAP DISCOVERY TESTS
// Pure/injected — no network. Every HTTP call goes through the `fetchImpl`
// seam, so these are deterministic and run with the rest of the pure-ESM suite.
// Mirrors the spec's cases: robots parsing, fallbacks, indexes, recursion,
// dedupe, scope, protocols, limits and failure isolation.
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  discoverSitemaps,
  parseRobotsTxt,
  parseSitemapXml,
  normalizeWebsiteUrl,
  buildScope,
  isInScope,
  dedupeKey,
  resolveUrl,
  isHttpUrl,
  crawlSitemaps,
  DEFAULT_DISCOVERY_LIMITS,
} from "../sources/sitemap/index.js";

// ------------------------------------------------------------------
// TEST FIXTURES
// ------------------------------------------------------------------

const urlset = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(([loc, lastmod]) => `  <url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`;

const sitemapindex = (locs) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((l) => `  <sitemap><loc>${l}</loc></sitemap>`).join("\n")}
</sitemapindex>`;

/**
 * Build a fetchImpl backed by a path→response map. Anything unmapped 404s, so
 * a test that forgets a fixture fails loudly instead of passing silently.
 */
function fakeFetch(routes) {
  return async (url) => {
    const parsed = new URL(url);
    const hit = routes[parsed.pathname] ?? routes[url];
    const record = typeof hit === "function" ? hit(parsed) : hit;
    if (!record) {
      return { ok: false, status: 404, url, body: null, headers: new Map(), text: async () => "" };
    }
    return {
      ok: record.status === undefined || (record.status >= 200 && record.status < 300),
      status: record.status ?? 200,
      url: record.finalUrl || url,
      body: null,
      headers: new Map(),
      text: async () => record.body ?? "",
    };
  };
}

// ------------------------------------------------------------------
// Test 1 — normal robots.txt
// ------------------------------------------------------------------

test("1 · robots.txt with one Sitemap directive yields that sitemap", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "User-agent: *\nSitemap: https://example.com/sitemap.xml\n" },
      "/sitemap.xml": { body: urlset([["https://example.com/about/"]]) },
    }),
  });
  assert.equal(out.robotsFound, true);
  assert.deepEqual(out.discoveredSitemaps, ["https://example.com/sitemap.xml"]);
  assert.deepEqual(out.urls, [{ url: "https://example.com/about/", lastModified: null }]);
});

// ------------------------------------------------------------------
// Test 2 — multiple sitemap directives
// ------------------------------------------------------------------

test("2 · multiple Sitemap directives are all discovered", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": {
        body: "Sitemap: https://example.com/pages.xml\nSitemap: https://example.com/posts.xml\n",
      },
      "/pages.xml": { body: urlset([["https://example.com/p1/"]]) },
      "/posts.xml": { body: urlset([["https://example.com/p2/"]]) },
    }),
  });
  assert.equal(out.stats.sitemapCount, 2);
  assert.deepEqual(out.urls.map((u) => u.url), [
    "https://example.com/p1/",
    "https://example.com/p2/",
  ]);
});

test("2b · parseRobotsTxt keeps every directive and skips malformed ones", () => {
  const entries = parseRobotsTxt(
    [
      "User-agent: *",
      "Disallow: /admin/",
      "Sitemap: https://example.com/a.xml",
      "  sitemap:   https://example.com/b.xml  ",
      "SITEMAP: https://example.com/c.xml",
      "Sitemap: javascript:alert(1)",
      "Sitemap:",
    ].join("\n"),
    "https://example.com/"
  );
  assert.deepEqual(entries, [
    "https://example.com/a.xml",
    "https://example.com/b.xml",
    "https://example.com/c.xml",
  ]);
});

// ------------------------------------------------------------------
// Test 4 — relative sitemap reference
// ------------------------------------------------------------------

test("4 · relative sitemap reference resolves against the origin", () => {
  assert.deepEqual(parseRobotsTxt("Sitemap: /sitemap.xml", "https://example.com"), [
    "https://example.com/sitemap.xml",
  ]);
  assert.deepEqual(parseRobotsTxt("Sitemap: sitemap.xml", "https://example.com/blog/"), [
    "https://example.com/blog/sitemap.xml",
  ]);
});


// ------------------------------------------------------------------
// Test 5 / 6 — fallbacks when robots.txt is unhelpful
// ------------------------------------------------------------------

test("5 · robots.txt without a Sitemap directive triggers fallback discovery", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "User-agent: *\nDisallow: /admin/\n" },
      "/sitemap.xml": { body: urlset([["https://example.com/fallback/"]]) },
    }),
  });
  assert.equal(out.stats.usedFallback, true);
  assert.deepEqual(out.urls.map((u) => u.url), ["https://example.com/fallback/"]);
});

test("6 · robots.txt 404 triggers fallback discovery", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { status: 404, body: "nope" },
      "/wp-sitemap.xml": { body: urlset([["https://example.com/wp/"]]) },
    }),
  });
  assert.equal(out.robotsFound, false);
  assert.equal(out.stats.usedFallback, true);
  assert.deepEqual(out.urls.map((u) => u.url), ["https://example.com/wp/"]);
});

test("6b · robots.txt 403 does not prove a sitemap is absent", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { status: 403, body: "forbidden" },
      "/sitemap.xml": { body: urlset([["https://example.com/ok/"]]) },
    }),
  });
  assert.equal(out.robotsFound, false);
  assert.deepEqual(out.urls.map((u) => u.url), ["https://example.com/ok/"]);
});

test("9 · a fallback returning HTTP 200 HTML is NOT accepted as a sitemap", async () => {
  await assert.rejects(
    () =>
      discoverSitemaps("https://example.com", {
        fetchImpl: fakeFetch({
          "/robots.txt": { status: 404, body: "" },
          "/sitemap.xml": { body: "<!DOCTYPE html><html><body>Hello</body></html>" },
        }),
      }),
    (err) => {
      assert.equal(err.code, "NO_SITEMAP_FOUND");
      return true;
    }
  );
});

test("10 · NO_SITEMAP_FOUND carries a user-facing message, not a parser error", async () => {
  await assert.rejects(
    () =>
      discoverSitemaps("https://example.com", {
        fetchImpl: fakeFetch({ "/robots.txt": { status: 404, body: "" } }),
      }),
    (err) => {
      assert.equal(err.status, 404);
      assert.match(err.message, /couldn't find a sitemap/i);
      assert.doesNotMatch(err.message, /XMLParser|ECONNRESET|TypeError/);
      return true;
    }
  );
});

// ------------------------------------------------------------------
// Test 7 — sitemap index
// ------------------------------------------------------------------

test("7 · sitemapindex children are expanded", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: https://example.com/sitemap_index.xml\n" },
      "/sitemap_index.xml": {
        body: sitemapindex(["https://example.com/pages.xml", "https://example.com/posts.xml"]),
      },
      "/pages.xml": { body: urlset([["https://example.com/page-a/"]]) },
      "/posts.xml": { body: urlset([["https://example.com/post-a/"]]) },
    }),
  });
  assert.equal(out.stats.sitemapCount, 3);
  assert.deepEqual(out.urls.map((u) => u.url).sort(), [
    "https://example.com/page-a/",
    "https://example.com/post-a/",
  ]);
});

test("12 · nested sitemap indexes recurse", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: https://example.com/root.xml\n" },
      "/root.xml": { body: sitemapindex(["https://example.com/mid.xml"]) },
      "/mid.xml": { body: sitemapindex(["https://example.com/leaf.xml"]) },
      "/leaf.xml": { body: urlset([["https://example.com/deep/"]]) },
    }),
  });
  assert.deepEqual(out.urls.map((u) => u.url), ["https://example.com/deep/"]);
});

// ------------------------------------------------------------------
// Test 8 — urlset extraction + lastmod
// ------------------------------------------------------------------

test("8 · urlset yields every <loc>, with optional <lastmod>", () => {
  const parsed = parseSitemapXml(
    urlset([
      ["https://example.com/a/", "2026-09-01"],
      ["https://example.com/b/"],
    ])
  );
  assert.equal(parsed.type, "urlset");
  assert.equal(parsed.isSitemap, true);
  assert.deepEqual(parsed.urls, [
    { url: "https://example.com/a/", lastModified: "2026-09-01" },
    { url: "https://example.com/b/", lastModified: null },
  ]);
});

test("8b · XML entities are decoded by the parser, not left as &amp;", () => {
  const parsed = parseSitemapXml(urlset([["https://example.com/p?x=1&amp;y=2"]]));
  assert.equal(parsed.urls[0].url, "https://example.com/p?x=1&y=2");
});

test("8c · prefixed XML namespaces parse like default ones", () => {
  const parsed = parseSitemapXml(
    `<?xml version="1.0"?><sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">` +
      `<sm:url><sm:loc>https://example.com/ns/</sm:loc></sm:url></sm:urlset>`
  );
  assert.equal(parsed.type, "urlset");
  assert.deepEqual(parsed.urls, [{ url: "https://example.com/ns/", lastModified: null }]);
});

// ------------------------------------------------------------------
// Test 9 — duplicates
// ------------------------------------------------------------------

test("9 · the same page across sitemaps is deduplicated", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: https://example.com/a.xml\nSitemap: https://example.com/b.xml\n" },
      "/a.xml": { body: urlset([["https://example.com/dup/"], ["https://example.com/only-a/"]]) },
      "/b.xml": { body: urlset([["https://example.com/dup/"], ["https://example.com/only-b/"]]) },
    }),
  });
  assert.equal(out.urls.length, 3);
  assert.equal(out.urls.filter((u) => u.url === "https://example.com/dup/").length, 1);
});

test("9b · dedupeKey unifies fragment and trailing-slash variants, keeps query strings", () => {
  assert.equal(dedupeKey("https://Example.com/about/#x"), dedupeKey("https://example.com/about"));
  assert.notEqual(dedupeKey("https://example.com/p?a=1"), dedupeKey("https://example.com/p?a=2"));
});

test("9c · fragments are stripped from discovered urls", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: https://example.com/s.xml\n" },
      "/s.xml": { body: urlset([["https://example.com/page#section"]]) },
    }),
  });
  assert.equal(out.urls[0].url, "https://example.com/page");
});

// ------------------------------------------------------------------
// Test 10 — cyclic index
// ------------------------------------------------------------------

test("10 · cyclic sitemap index terminates", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: https://example.com/a.xml\n" },
      "/a.xml": { body: sitemapindex(["https://example.com/b.xml"]) },
      "/b.xml": { body: sitemapindex(["https://example.com/a.xml"]) },
    }),
  });
  assert.ok(out.discoveredSitemaps.length <= DEFAULT_DISCOVERY_LIMITS.maxSitemaps);
  assert.equal(out.errors.length, 0);
});

// ------------------------------------------------------------------
// Test 11 — invalid sitemap content
// ------------------------------------------------------------------

test("11 · HTML served at a sitemap path is rejected", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: https://example.com/s.xml\n" },
      "/s.xml": { body: "<!DOCTYPE html><html><body>not a sitemap</body></html>" },
    }),
  });
  assert.equal(out.urls.length, 0);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0].error, /not XML sitemap/);
});

// ------------------------------------------------------------------
// Test 12 — unsupported protocols
// ------------------------------------------------------------------

test("12 · javascript:, data: and file: references are rejected", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,<b>x", "file:///etc/passwd", "ftp://x.com/s.xml"]) {
    assert.equal(isHttpUrl(bad), false, `${bad} must be rejected`);
    assert.equal(resolveUrl("https://example.com/", bad), null);
  }
  assert.equal(isHttpUrl("https://example.com/s.xml"), true);
});

test("12b · a javascript: sitemap in robots.txt is skipped, not fetched", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: javascript:alert(1)\nSitemap: https://example.com/s.xml\n" },
      "/s.xml": { body: urlset([["https://example.com/safe/"]]) },
    }),
  });
  assert.deepEqual(out.discoveredSitemaps, ["https://example.com/s.xml"]);
});

test("7b · maxDepth stops runaway nesting and reports it", async () => {
  const routes = { "/robots.txt": { body: "Sitemap: https://example.com/d0.xml\n" } };
  for (let i = 0; i < 8; i++) {
    routes[`/d${i}.xml`] = { body: sitemapindex([`https://example.com/d${i + 1}.xml`]) };
  }
  routes["/d8.xml"] = { body: urlset([["https://example.com/never/"]]) };

  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch(routes),
    limits: { maxDepth: 2 },
  });
  assert.equal(out.truncated?.depth, true);
  assert.equal(out.urls.length, 0);
});

// ------------------------------------------------------------------
// Test 13 — external urls
// ------------------------------------------------------------------

test("13 · urls outside the website scope are not ingested", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: https://example.com/s.xml\n" },
      "/s.xml": {
        body: urlset([
          ["https://example.com/mine/"],
          ["https://other-domain.com/theirs/"],
        ]),
      },
    }),
  });
  assert.deepEqual(out.urls.map((u) => u.url), ["https://example.com/mine/"]);
});

test("13b · scope accepts the www sibling, and allowSubdomains opts in to more", () => {
  const scope = buildScope("https://example.com");
  assert.equal(isInScope("https://www.example.com/x", scope), true);
  assert.equal(isInScope("https://cdn.example.com/x", scope), false);

  const wide = buildScope("https://example.com", { allowSubdomains: true });
  assert.equal(isInScope("https://cdn.example.com/x", wide), true);
  assert.equal(isInScope("https://evil.com/x", wide), false);
});

test("13c · an off-site sitemap is not crawled unless allowExternal is set", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: https://cdn.other.com/s.xml\n" },
      "/sitemap.xml": { body: urlset([["https://example.com/local/"]]) },
    }),
  });
  assert.equal(out.stats.usedFallback, true); // off-site directive ignored → fell back
  assert.deepEqual(out.urls.map((u) => u.url), ["https://example.com/local/"]);
});

// ------------------------------------------------------------------
// Test 14 / 15 — limits
// ------------------------------------------------------------------

test("14 · maxUrls is enforced AND reported (never a silent truncation)", async () => {
  const many = Array.from({ length: 50 }, (_, i) => [`https://example.com/p${i}/`]);
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: https://example.com/s.xml\n" },
      "/s.xml": { body: urlset(many) },
    }),
    limits: { maxUrls: 10 },
  });
  assert.equal(out.urls.length, 10);
  assert.equal(out.truncated?.urls, true);
});

test("15 · maxSitemaps is enforced", async () => {
  const children = Array.from({ length: 30 }, (_, i) => `https://example.com/s${i}.xml`);
  const routes = { "/robots.txt": { body: "Sitemap: https://example.com/index.xml\n" } };
  routes["/index.xml"] = { body: sitemapindex(children) };
  for (let i = 0; i < 30; i++) routes[`/s${i}.xml`] = { body: urlset([[`https://example.com/u${i}/`]]) };

  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch(routes),
    limits: { maxSitemaps: 5 },
  });
  assert.equal(out.truncated?.sitemaps, true);
  assert.ok(out.discoveredSitemaps.length <= 5);
});

// ------------------------------------------------------------------
// Failure isolation (§28) and input validation (§3)
// ------------------------------------------------------------------

test("28 · one broken sitemap does not abort discovery of the others", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": {
        body:
          "Sitemap: https://example.com/good.xml\n" +
          "Sitemap: https://example.com/bad.xml\n" +
          "Sitemap: https://example.com/alsogood.xml\n",
      },
      "/good.xml": { body: urlset([["https://example.com/g1/"]]) },
      "/bad.xml": { status: 500, body: "boom" },
      "/alsogood.xml": { body: urlset([["https://example.com/g2/"]]) },
    }),
  });
  assert.equal(out.urls.length, 2);
  assert.equal(out.errors.length, 1);
  assert.match(out.errors[0].error, /500/);
});

test("3 · website url normalization", () => {
  assert.equal(normalizeWebsiteUrl("https://example.com").toString(), "https://example.com/");
  assert.equal(normalizeWebsiteUrl("https://example.com/").toString(), "https://example.com/");
  assert.equal(normalizeWebsiteUrl("https://www.example.com").toString(), "https://www.example.com/");
  assert.equal(normalizeWebsiteUrl("http://example.com").toString(), "http://example.com/");
  assert.equal(normalizeWebsiteUrl("https://example.com#section").toString(), "https://example.com/");
  assert.equal(normalizeWebsiteUrl("https://example.com/blog/").toString(), "https://example.com/blog");
  assert.equal(normalizeWebsiteUrl("HTTPS://EXAMPLE.COM").toString(), "https://example.com/");
});

test("3b · bad website urls are rejected with a 400-style error", () => {
  for (const bad of ["", "   ", "not a url", "javascript:alert(1)", "file:///etc/passwd", "ftp://x.com"]) {
    assert.throws(
      () => normalizeWebsiteUrl(bad),
      (err) => {
        assert.equal(err.code, "INVALID_WEBSITE_URL");
        assert.equal(err.status, 400);
        return true;
      },
      `${JSON.stringify(bad)} must be rejected`
    );
  }
});

test("4 · robots.txt is always requested from the origin, never the path", async () => {
  const seen = [];
  const out = await discoverSitemaps("https://example.com/blog", {
    fetchImpl: async (url) => {
      const { pathname } = new URL(url);
      seen.push(pathname);
      if (pathname === "/robots.txt") {
        return { ok: true, status: 200, url, text: async () => "Sitemap: /sitemap.xml", headers: new Map() };
      }
      if (pathname === "/sitemap.xml") {
        return { ok: true, status: 200, url, text: async () => urlset([["https://example.com/blog/a/"]]), headers: new Map() };
      }
      return { ok: false, status: 404, url, text: async () => "", headers: new Map() };
    },
  });
  assert.ok(seen.includes("/robots.txt"));
  assert.ok(!seen.includes("/blog/robots.txt"), "must not request /blog/robots.txt");
  assert.equal(out.websiteUrl, "https://example.com/blog");
});

test("crawlSitemaps can be used standalone", async () => {
  const result = await crawlSitemaps(["https://example.com/s.xml"], {
    scope: buildScope("https://example.com"),
    fetchImpl: fakeFetch({ "/s.xml": { body: urlset([["https://example.com/x/"]]) } }),
  });
  assert.equal(result.urls.length, 1);
  assert.equal(result.truncated.sitemaps, false);
});

test("20 · a sitemap served as text/plain is still accepted (structure wins over content-type)", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: https://example.com/s.xml" },
      "/s.xml": { body: urlset([["https://example.com/plain/"]]) },
    }),
  });
  assert.equal(out.urls.length, 1);
});

test("non-page assets in a sitemap are skipped", async () => {
  const out = await discoverSitemaps("https://example.com", {
    fetchImpl: fakeFetch({
      "/robots.txt": { body: "Sitemap: https://example.com/s.xml" },
      "/s.xml": {
        body: urlset([
          ["https://example.com/page/"],
          ["https://example.com/logo.png"],
          ["https://example.com/brochure.pdf"],
        ]),
      },
    }),
  });
  assert.deepEqual(out.urls.map((u) => u.url), ["https://example.com/page/"]);
});
