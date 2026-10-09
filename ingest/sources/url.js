// --------------------------
// URL / WEBSITE SOURCE ADAPTER
// Fetches web pages and returns items in the shape the ingestion pipeline
// expects: { title: { rendered }, content: { rendered }, slug, link, modified }.
//
// Three input modes:
//   websiteUrl — a WEBSITE. The sitemap is discovered automatically
//                (robots.txt → fallbacks → indexes → page URLs). This is the
//                mode the KB wizard uses; the user never types a sitemap URL.
//   sitemapUrl — an explicit sitemap (kept for API callers / existing KBs).
//   urls       — an explicit list of pages.
//
// The resolved target list is capped by `maxUrls`. `ingest.js` derives this
// from the KB's saved docLimit when the scope is "limit N" (intersected with
// source_config.maxUrls), so a docLimit-3 KB never fetches a 288-page sitemap
// just to throw the extras away downstream.
//
// Sitemap discovery lives in ./sitemap/ and knows nothing about chunking,
// embeddings, R2 or Vectorize. This adapter only turns the discovered URL list
// into pipeline items.
// --------------------------

import fetch from "node-fetch";
import { load as cheerioLoad } from "cheerio";
import { retry, sleep } from "../../utils/helpers.js";
import { logToFile } from "../../utils/logger.js";
import { discoverSitemaps, normalizeWebsiteUrl, buildScope, crawlSitemaps } from "./sitemap/index.js";

const FETCH_DELAY_MS = 300;
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_URLS = 1000;
/** Cap on a single page's HTML so one huge page can't exhaust the worker (§34). */
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const FETCH_CONCURRENCY = 3;

/**
 * Create a URL/website source adapter.
 *
 * @param {Object} opts
 * @param {string}   [opts.websiteUrl]  - a WEBSITE; its sitemap is discovered automatically
 * @param {string}   [opts.sitemapUrl]  - an explicit sitemap URL (legacy / API callers)
 * @param {string[]} [opts.urls]        - explicit page URLs (direct mode)
 * @param {number}   [opts.concurrency] - max parallel page fetches (default 3)
 * @param {number}   [opts.timeout]     - per-fetch timeout in ms
 * @param {number}   [opts.maxUrls]     - cap on discovered URLs (ingest.js derives it from the KB's saved docLimit when scope is "limit")
 * @param {number}   [opts.maxDepth]    - sitemap index recursion depth
 * @param {boolean}  [opts.allowSubdomains=false]
 * @param {boolean}  [opts.allowExternal=false]
 * @returns {{ fetchPage, fetchPost, fetchWpByIds, getFailures, getDiscovery }}
 */
export function createUrlSource({
  urls,
  websiteUrl,
  sitemapUrl,
  concurrency = FETCH_CONCURRENCY,
  timeout = DEFAULT_TIMEOUT_MS,
  maxUrls = DEFAULT_MAX_URLS,
  maxDepth,
  allowSubdomains = false,
  allowExternal = false,
} = {}) {
  // Discovery state, readable after the run for diagnostics (§29, §32).
  const failures = [];
  let discovery = null;

  const resolvedUrlsPromise = resolveUrls({
    urls,
    websiteUrl,
    sitemapUrl,
    timeout,
    maxUrls,
    maxDepth,
    allowSubdomains,
    allowExternal,
  }).then((result) => {
    discovery = result.discovery;
    return result.targets;
  });
  // Discovery starts at creation time, before any fetch. If it rejects and no
  // run ever awaits the promise (e.g. the job is aborted first), Node would
  // raise an unhandledRejection — mark it handled on a SEPARATE branch so a
  // real run still sees the original error when fetchPage awaits the promise.
  resolvedUrlsPromise.catch(() => {});

  /** Record a per-URL failure without aborting the run (§28). */
  function recordFailure(url, error) {
    failures.push({ url, error });
    logToFile("error.log", `❌ URL fetch failed: ${url} → ${error}`);
  }

  /**
   * Fetch the page list and return WP-format items. URLs are pre-defined
   * rather than paginated, so everything comes back on page 1 and page 2+ is
   * "exhausted".
   */
  async function fetchUrlPage(page) {
    if (page > 1) return null;

    const targets = await resolvedUrlsPromise;
    if (!targets.length) return null;

    const items = [];
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((target) => fetchAndParse(target, { timeout, onFailure: recordFailure }))
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) items.push(r.value);
        // A rejected promise here would be a bug — fetchAndParse swallows
        // page-level errors — so it is deliberately not surfaced per-URL.
      }
      if (i + concurrency < targets.length) await sleep(FETCH_DELAY_MS);
    }

    if (failures.length) {
      console.log(`⚠️ ${failures.length} page(s) could not be ingested (the run continued)`);
      logToFile("process.log", `⚠️ ${failures.length} URL page fetch failures recorded`);
    }
    return items.length > 0 ? items : null;
  }

  return {
    fetchPage: fetchUrlPage,
    fetchPost: async () => null, // URLs don't distinguish pages from posts
    fetchWpByIds: async () => [], // not applicable for URL source
    getFailures: () => [...failures],
    getDiscovery: () => discovery,
  };
}

/**
 * Resolve the target page list.
 *
 * @param {Object} opts
 * @returns {Promise<{ targets: Array<{url: string, lastModified: string|null}>, discovery: Object|null }>}
 */
async function resolveUrls({ urls, websiteUrl, sitemapUrl, timeout, maxUrls, maxDepth, allowSubdomains, allowExternal }) {
  const limits = { maxUrls, maxDepth: maxDepth ?? 5, timeoutMs: timeout };

  // ---- mode 1: an explicit sitemap URL (legacy / API callers) ----
  // Crawl exactly that document (and its index children) — the caller named a
  // specific sitemap, so the site's other sitemaps are not considered.
  if (sitemapUrl && !websiteUrl) {
    const root = normalizeWebsiteUrl(sitemapUrl).toString();
    console.log(`🗺️ Discovering URLs from sitemap: ${root}`);
    const result = await crawlSitemaps([root], {
      scope: buildScope(root, { allowSubdomains, allowExternal }),
      limits,
    });
    logToFile("process.log", `🗺️ Sitemap ${root} yielded ${result.urls.length} URLs`);
    return { targets: result.urls.slice(0, maxUrls), discovery: result };
  }

  // ---- mode 2: a WEBSITE — the sitemap is found automatically ----
  if (websiteUrl) {
    const website = normalizeWebsiteUrl(websiteUrl).toString();
    console.log(`🌐 Discovering sitemap(s) for website: ${website}`);
    const result = await discoverSitemaps(website, {
      limits,
      allowSubdomains,
      allowExternal,
    });
    logToFile("process.log", `🌐 Discovered ${result.urls.length} URLs for ${website}`);
    return { targets: result.urls.slice(0, maxUrls), discovery: result };
  }

  // ---- mode 3: an explicit list of pages ----
  if (!urls?.length) {
    throw new Error("createUrlSource requires websiteUrl, sitemapUrl or urls");
  }
  return { targets: urls.map((url) => ({ url, lastModified: null })), discovery: null };
}

/**
 * Parse HTML into a WP-format item.
 * Extracts title, main content, and metadata.
 * @param {string} url
 * @param {string} html
 * @param {string|null} [lastModified] - <lastmod> from the sitemap (§27)
 * @returns {Object}
 */
/**
 * Fetch a single page and parse it into a pipeline item.
 *
 * Never throws: a failed page is recorded and skipped so one bad URL cannot
 * end the run (§28). HTML → title/content extraction is unchanged from the
 * original adapter; the fetch adds a byte cap.
 *
 * @param {{ url: string, lastModified: string|null }} target
 * @param {Object} opts
 * @param {number} opts.timeout
 * @param {(url: string, error: string) => void} opts.onFailure
 * @returns {Promise<Object|null>}
 */
async function fetchAndParse({ url, lastModified }, { timeout, onFailure }) {
  try {
    const html = await retry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; RAG-Ingestion-Bot/1.0)",
            Accept: "text/html,application/xhtml+xml",
          },
          redirect: "follow",
          follow: 5,
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for ${url}`);
        }
        return await readPageBody(res, url);
      } finally {
        clearTimeout(timer);
      }
    }, MAX_RETRIES, 1000);

    return parseHtmlToItem(url, html, lastModified);
  } catch (err) {
    // 4xx is final; anything else has already exhausted its retries.
    console.error(`❌ Failed to fetch ${url}: ${err.message}`);
    onFailure?.(url, err.message);
    return null;
  }
}

/**
 * Read a page body with a hard byte cap (§34) so one enormous page cannot
 * exhaust the worker.
 * @returns {Promise<string>}
 */
async function readPageBody(res, url) {
  if (!res.body) return res.text();
  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_PAGE_BYTES) {
      try {
        res.body.destroy?.();
      } catch {
        /* best effort */
      }
      throw new Error(
        `Response from ${url} exceeded the ${Math.round(MAX_PAGE_BYTES / 1024 / 1024)} MB page limit`
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Parse HTML into a WP-format item.
 * Extracts title, main content, and metadata.
 * @param {string} url
 * @param {string} html
 * @param {string|null} [lastModified] - <lastmod> from the sitemap (§27)
 * @returns {Object}
 */
function parseHtmlToItem(url, html, lastModified = null) {
  const $ = cheerioLoad(html);

  // Remove noise elements
  $("script, style, noscript, iframe, form, nav, footer, header").remove();

  // Extract title: og:title → <title> → first h1
  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("title").text().trim() ||
    $("h1").first().text().trim() ||
    new URL(url).pathname;

  // Extract main content: <article> → <main> → body
  let contentHtml =
    $("article").html() ||
    $("main").html() ||
    $("body").html() ||
    "";

  // Remove remaining nav/sidebar/footer fragments that cheerio missed
  contentHtml = contentHtml
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");

  // Build a slug from the URL path
  const pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
  const slug = pathname
    .split("/")
    .filter(Boolean)
    .join("-") || "index";

  // Modified date precedence: the page's own signal → sitemap <lastmod> → now.
  // A real timestamp keeps the registry's staleness check meaningful on re-runs
  // instead of re-indexing every page every time (§27).
  const modified =
    $('meta[property="og:updated_time"]').attr("content") ||
    lastModified ||
    new Date().toISOString();

  return {
    title: { rendered: title },
    content: { rendered: contentHtml },
    slug,
    link: url,
    modified,
    // Source provenance (§25). `link` above is already the citation URL; these
    // make the origin explicit and are carried into chunk metadata downstream.
    _source: "url",
    _sourceType: "website",
    _sourceUrl: url,
    _websiteUrl: safeOrigin(url),
    _lastModified: lastModified,
  };
}

/** Origin of a URL, or null — stamps the website a page belongs to. */
function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
