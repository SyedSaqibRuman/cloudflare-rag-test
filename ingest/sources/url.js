// --------------------------
// URL SOURCE ADAPTER
// Fetches arbitrary web pages and returns items in the same shape the
// ingestion pipeline expects: { title: { rendered }, content: { rendered },
// slug, link, modified }.
//
// Usage:
//   const source = createUrlSource({ urls: ["https://example.com/page"] });
//   const items = await source.fetchPage(1, companyName);
// --------------------------

import fetch from "node-fetch";
import { load as cheerioLoad } from "cheerio";
import { retry, sleep } from "../../utils/helpers.js";
import { logToFile } from "../../utils/logger.js";

const FETCH_DELAY_MS = 300;
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 15000;
const SITEMAP_MAX_URLS = 1000;

/**
 * Create a URL source adapter.
 * Supports two modes:
 *   1. Direct URLs — fetch the provided list of URLs
 *   2. Sitemap — discover URLs from a sitemap.xml, then fetch them
 *
 * @param {Object} opts
 * @param {string[]} [opts.urls]          URLs to fetch (direct mode)
 * @param {string}   [opts.sitemapUrl]    Sitemap URL to crawl (sitemap mode)
 * @param {number}   [opts.concurrency]   Max parallel fetches (default 3)
 * @param {number}   [opts.timeout]       Per-fetch timeout in ms (default 15000)
 * @param {number}   [opts.maxUrls]       Max URLs to fetch from sitemap (default 1000)
 * @returns {{ fetchPage, fetchPost, fetchWpByIds }}
 */
export function createUrlSource({ urls, sitemapUrl, concurrency = 3, timeout = DEFAULT_TIMEOUT_MS, maxUrls = SITEMAP_MAX_URLS } = {}) {
  // Resolve the URL list: sitemap mode or direct mode
  const resolvedUrlsPromise = resolveUrls({ urls, sitemapUrl, timeout, maxUrls });

  /**
   * Fetch a batch of URLs and return WP-format items.
   * Since URLs are pre-defined (not paginated), page 1 returns all items
   * and subsequent pages return nothing.
   */
  async function fetchUrlPage(page) {
    if (page > 1) return null; // all URLs returned on page 1

    const resolvedUrls = await resolvedUrlsPromise;
    if (!resolvedUrls.length) return null;

    const items = [];
    // Process in batches for concurrency control
    for (let i = 0; i < resolvedUrls.length; i += concurrency) {
      const batch = resolvedUrls.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((url) => fetchAndParse(url, timeout))
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          items.push(r.value);
        }
      }
      if (i + concurrency < resolvedUrls.length) await sleep(FETCH_DELAY_MS);
    }

    return items.length > 0 ? items : null;
  }

  return {
    // "pages" and "posts" both map to the same URL list
    fetchPage: fetchUrlPage,
    fetchPost: async () => null, // URLs don't distinguish pages vs posts
    fetchWpByIds: async () => [], // not applicable for URL source
  };
}

/**
 * Resolve URLs from direct list or sitemap.
 * @param {Object} opts
 * @returns {Promise<string[]>}
 */
async function resolveUrls({ urls, sitemapUrl, timeout, maxUrls }) {
  if (sitemapUrl) {
    console.log(`🗺️ Discovering URLs from sitemap: ${sitemapUrl}`);
    logToFile("process.log", `🗺️ Fetching sitemap: ${sitemapUrl}`);
    try {
      const discovered = await fetchSitemap(sitemapUrl, timeout, maxUrls);
      console.log(`📋 Discovered ${discovered.length} URLs from sitemap`);
      logToFile("process.log", `📋 Sitemap discovered ${discovered.length} URLs`);
      return discovered;
    } catch (err) {
      console.error(`❌ Sitemap fetch failed: ${err.message}`);
      logToFile("error.log", `❌ Sitemap failed: ${sitemapUrl} → ${err.message}`);
      return [];
    }
  }

  if (!urls?.length) {
    throw new Error("createUrlSource requires urls or sitemapUrl");
  }
  return urls;
}

/**
 * Fetch and parse a sitemap.xml to extract page URLs.
 * Supports both standard sitemaps and sitemap index files.
 * @param {string} sitemapUrl
 * @param {number} timeout
 * @param {number} maxUrls
 * @returns {Promise<string[]>}
 */
async function fetchSitemap(sitemapUrl, timeout, maxUrls) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(sitemapUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RAG-Ingestion-Bot/1.0)",
        Accept: "application/xml,text/xml,*/*",
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml = await res.text();
    return parseSitemap(xml, sitemapUrl, timeout, maxUrls);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse sitemap XML and extract URLs.
 * Handles both regular sitemaps (<urlset>) and sitemap indexes (<sitemapindex>).
 * @param {string} xml
 * @param {string} baseUrl  Used to resolve relative URLs
 * @param {number} timeout
 * @param {number} maxUrls
 * @returns {Promise<string[]>}
 */
async function parseSitemap(xml, baseUrl, timeout, maxUrls) {
  const urls = [];

  // Check if this is a sitemap index
  if (xml.includes("<sitemapindex")) {
    // Extract child sitemap URLs
    const sitemapUrls = [];
    const locRegex = /<loc>([^<]+)<\/loc>/gi;
    let match;
    while ((match = locRegex.exec(xml)) !== null && sitemapUrls.length < 10) {
      sitemapUrls.push(match[1].trim());
    }

    // Recursively fetch each child sitemap
    for (const childUrl of sitemapUrls) {
      if (urls.length >= maxUrls) break;
      try {
        const childUrls = await fetchSitemap(childUrl, timeout, maxUrls - urls.length);
        urls.push(...childUrls);
      } catch {
        console.warn(`⚠️ Failed to fetch child sitemap: ${childUrl}`);
      }
    }
  } else {
    // Regular sitemap — extract <loc> URLs
    const locRegex = /<loc>([^<]+)<\/loc>/gi;
    let match;
    while ((match = locRegex.exec(xml)) !== null && urls.length < maxUrls) {
      const url = match[1].trim();
      // Skip non-HTML resources (images, videos, etc.)
      if (!/\.(jpg|jpeg|png|gif|svg|webp|mp4|mp3|pdf|zip)$/i.test(url)) {
        urls.push(url);
      }
    }
  }

  return urls;
}

/**
 * Fetch a single URL, parse its HTML, and return a WP-format item.
 * @param {string} url
 * @param {number} timeout
 * @returns {Promise<Object|null>}
 */
async function fetchAndParse(url, timeout) {
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
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for ${url}`);
        }

        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    }, MAX_RETRIES, 1000);

    return parseHtmlToItem(url, html);
  } catch (err) {
    console.error(`❌ Failed to fetch ${url}: ${err.message}`);
    logToFile("error.log", `❌ URL fetch failed: ${url} → ${err.message}`);
    return null;
  }
}

/**
 * Parse HTML into a WP-format item.
 * Extracts title, main content, and metadata.
 * @param {string} url
 * @param {string} html
 * @returns {Object}
 */
function parseHtmlToItem(url, html) {
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

  // Use og:updated_time or last-modified header fallback
  const modified =
    $('meta[property="og:updated_time"]').attr("content") ||
    new Date().toISOString();

  return {
    title: { rendered: title },
    content: { rendered: contentHtml },
    slug,
    link: url,
    modified,
    _source: "url",
  };
}
