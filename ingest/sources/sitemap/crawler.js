// --------------------------
// SITEMAP CRAWLER
// Walks sitemap documents breadth-first, expanding `<sitemapindex>` roots into
// their children until a urlset yields page URLs.
//
// Guarded against the three ways a sitemap graph can run away (§12, §13, §18):
//   • a visited Set  → A → B → C → A terminates
//   • a depth cap    → nested indexes stop at maxDepth
//   • count caps     → maxSitemaps / maxUrls stop the walk and are REPORTED
//                      (never a silent truncation — §18)
// --------------------------

import { fetchText, resolveLimits } from "./http.js";
import { parseSitemapXml } from "./parser.js";
import { dedupeKey, isInScope, resolveUrl } from "./normalize.js";
import { logDiscovery, logDiscoveryWarn } from "./log.js";

/** Non-HTML assets that live in sitemaps but are not ingestible documents. */
const NON_PAGE_EXT = /\.(?:jpg|jpeg|png|gif|svg|webp|avif|bmp|ico|mp4|m4v|mov|avi|mp3|wav|ogg|pdf|zip|gz|tar|rar|dmg|exe|css|js|json|xml|rss|woff2?|ttf|eot)$/i;

/**
 * Crawl a set of sitemap roots and collect page URLs.
 *
 * @param {string[]} roots - absolute sitemap URLs (already validated)
 * @param {Object} opts
 * @param {ReturnType<import('./normalize.js').buildScope>} opts.scope
 * @param {Object} [opts.limits]
 * @param {Function} [opts.fetchImpl] - test seam
 * @returns {Promise<{ urls: Array<{url: string, lastModified: string|null}>, sitemaps: string[], errors: Array<{sitemap: string, error: string}>, limits: object, truncated: object|null }>}
 */
export async function crawlSitemaps(roots, { scope, limits: rawLimits, fetchImpl } = {}) {
  const limits = resolveLimits(rawLimits);

  const visited = new Set(); // §13 cycle protection
  const queue = roots.map((u) => ({ url: u, depth: 0 }));
  const processedSitemaps = [];
  const errors = [];
  const byKey = new Map(); // dedupeKey → entry (§15)
  const truncated = { sitemaps: false, urls: false, depth: false };

  while (queue.length) {
    if (processedSitemaps.length >= limits.maxSitemaps) {
      if (!truncated.sitemaps) {
        truncated.sitemaps = true;
        logDiscoveryWarn(`Reached the maxSitemaps limit (${limits.maxSitemaps}) — stopped following new sitemaps.`);
      }
      break;
    }

    const { url, depth } = queue.shift();
    if (visited.has(url)) continue; // already expanded — breaks A→B→A
    visited.add(url);
    processedSitemaps.push(url);

    if (depth > limits.maxDepth) {
      if (!truncated.depth) {
        truncated.depth = true;
        logDiscoveryWarn(`Reached the maxDepth limit (${limits.maxDepth}) — a nested sitemap index was not expanded.`);
      }
      continue;
    }

    const res = await fetchText(url, { ...limits, fetchImpl, maxBytes: limits.maxSitemapBytes });
    if (!res.ok) {
      errors.push({ sitemap: url, error: res.error || `HTTP ${res.status}` });
      logDiscoveryWarn(`Failed sitemap: ${url} — ${res.error || `HTTP ${res.status}`}`);
      continue; // one bad sitemap never kills the walk (§28)
    }

    const parsed = parseSitemapXml(res.text);
    if (!parsed.isSitemap) {
      // 200 + HTML is NOT a sitemap (§11, §20).
      errors.push({ sitemap: url, error: "not XML sitemap content" });
      logDiscoveryWarn(`Failed sitemap: ${url} — response was not a valid sitemap document`);
      continue;
    }

    // Validate the FINAL url too: a redirect must not smuggle us off-site (§36).
    if (!isInScope(res.finalUrl, scope)) {
      errors.push({ sitemap: url, error: "redirected outside the website scope" });
      logDiscoveryWarn(`Skipped sitemap: ${url} — redirected outside the website scope`);
      continue;
    }

    if (parsed.type === "sitemapindex") {
      logDiscovery(`Sitemap index: ${url} → ${parsed.sitemaps.length} child sitemap(s)`);
      for (const child of parsed.sitemaps) {
        const absolute = resolveUrl(res.finalUrl, child);
        if (!absolute) {
          errors.push({ sitemap: url, error: `invalid child sitemap reference: ${child}` });
          continue;
        }
        if (!isInScope(absolute, scope)) {
          // A sitemap index may legitimately list a CDN-hosted sitemap; honour it
          // only when the caller explicitly allowed external hosts.
          if (!scope?.allowExternal) {
            errors.push({ sitemap: absolute.toString(), error: "outside the website scope" });
            continue;
          }
        }
        if (!visited.has(absolute.toString())) queue.push({ url: absolute.toString(), depth: depth + 1 });
      }
      continue;
    }

    // urlset → page URLs
    for (const entry of parsed.urls) {
      const absolute = resolveUrl(res.finalUrl, entry.url);
      if (!absolute) continue;
      absolute.hash = "";
      if (!isInScope(absolute, scope)) continue; // §16
      const finalUrl = absolute.toString();
      if (NON_PAGE_EXT.test(new URL(finalUrl).pathname)) continue;

      const key = dedupeKey(finalUrl);
      if (byKey.has(key)) continue; // same page via two sitemaps
      if (byKey.size >= limits.maxUrls) {
        if (!truncated.urls) {
          truncated.urls = true;
          logDiscoveryWarn(`Reached the maxUrls limit (${limits.maxUrls}) — discovery stopped early, the site was NOT fully crawled.`);
        }
        break;
      }
      byKey.set(key, { url: finalUrl, lastModified: entry.lastModified || null });
    }
  }

  const urls = [...byKey.values()];
  logDiscovery(`Discovered ${urls.length} page URL(s) from ${processedSitemaps.length} sitemap(s)`);
  return { urls, sitemaps: processedSitemaps, errors, limits, truncated };
}
