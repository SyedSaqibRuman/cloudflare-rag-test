// --------------------------
// SITEMAP DISCOVERY — ORCHESTRATOR
// website URL → robots.txt → sitemaps → page URLs
//
// robots.txt is primary; the standard locations are FALLBACKS only and are
// accepted only when the body is genuinely a sitemap document — never on
// HTTP 200 alone (§9, §11).
//
// This module knows how to find URLs. It does NOT know how to chunk text,
// embed, upload to R2 or call an LLM — that stays in ingest/pipeline.js (§38).
// --------------------------

import { fetchRobotsSitemaps } from "./robots.js";
import { crawlSitemaps } from "./crawler.js";
import { fetchText, resolveLimits } from "./http.js";
import { parseSitemapXml } from "./parser.js";
import { buildScope, isInScope, normalizeWebsiteUrl, resolveUrl, SitemapError } from "./normalize.js";
import { logDiscovery, logDiscoveryWarn } from "./log.js";

/** Standard fallback locations, tried in order (§9). */
export const FALLBACK_SITEMAP_PATHS = Object.freeze([
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/wp-sitemap.xml",
]);

/**
 * Probe the fallback locations. Each candidate must return a real sitemap
 * document to be accepted.
 *
 * @param {URL} website
 * @param {Object} opts
 * @returns {Promise<string[]>} absolute, in-scope sitemap URLs
 */
async function discoverFallbackSitemaps(website, { scope, limits, fetchImpl }) {
  const found = [];
  for (const path of FALLBACK_SITEMAP_PATHS) {
    const candidate = resolveUrl(website, path);
    if (!candidate) continue;

    const res = await fetchText(candidate.toString(), {
      ...limits,
      fetchImpl,
      maxBytes: limits.maxSitemapBytes,
    });
    if (!res.ok) {
      logDiscovery(`Fallback ${path} → HTTP ${res.status ?? res.error}`);
      continue;
    }

    const parsed = parseSitemapXml(res.text);
    if (!parsed.isSitemap) {
      // A 200 that is not XML is a landing page, not a sitemap (§11).
      logDiscoveryWarn(`Fallback ${path} returned HTTP 200 but not a sitemap document — ignored`);
      continue;
    }
    if (!isInScope(res.finalUrl, scope)) continue;

    logDiscovery(`Fallback ${path} is a valid ${parsed.type}`);
    found.push(res.finalUrl);
    // One hit is enough — the index it points at carries the rest.
    if (parsed.type === "sitemapindex") break;
  }
  return found;
}

/**
 * Discover every ingestible page URL for a website.
 *
 * @param {string} websiteUrl - a WEBSITE url, not a sitemap url
 * @param {Object} [opts]
 * @param {Object} [opts.limits]    - overrides for DEFAULT_DISCOVERY_LIMITS
 * @param {boolean} [opts.allowSubdomains=false]
 * @param {boolean} [opts.allowExternal=false] - ingest off-site URLs too
 * @param {Function} [opts.fetchImpl] - test seam
 * @returns {Promise<{ websiteUrl: string, robotsUrl: string, robotsFound: boolean, discoveredSitemaps: string[], urls: Array<{url: string, lastModified: string|null}>, stats: object, truncated: object|null, errors: Array }>}
 * @throws {SitemapError} 400 on an unusable website URL
 */
export async function discoverSitemaps(websiteUrl, opts = {}) {
  const limits = resolveLimits(opts.limits);
  const website = normalizeWebsiteUrl(websiteUrl);
  const scope = buildScope(website, {
    allowSubdomains: opts.allowSubdomains,
    allowExternal: opts.allowExternal,
  });

  logDiscovery(`Website: ${website.toString()}`);

  // ---- 1. robots.txt (primary) ----
  const robots = await fetchRobotsSitemaps(website, {
    ...limits,
    maxRobotsBytes: limits.maxRobotsBytes,
    fetchImpl: opts.fetchImpl,
  });

  let roots = robots.entries.filter((u) => isInScope(u, scope));
  const outOfScope = robots.entries.length - roots.length;
  if (outOfScope > 0) {
    logDiscoveryWarn(`${outOfScope} robots.txt sitemap directive(s) pointed outside ${scope.baseHost} — ignored`);
  }

  // ---- 2. fallbacks (only when robots gave us nothing) ----
  let usedFallback = false;
  if (roots.length === 0) {
    logDiscovery("No usable sitemap directive in robots.txt — trying standard locations");
    roots = await discoverFallbackSitemaps(website, { scope, limits, fetchImpl: opts.fetchImpl });
    usedFallback = roots.length > 0;
  }

  if (roots.length === 0) {
    // A user-facing message, not an internal parser/transport error (§31).
    throw new SitemapError(
      `We couldn't find a sitemap for ${website.hostname}. ` +
        "Make sure the website exposes a sitemap through robots.txt or one of the standard locations " +
        `(${FALLBACK_SITEMAP_PATHS.join(", ")}).`,
      "NO_SITEMAP_FOUND",
      404
    );
  }

  // ---- 3. crawl ----
  const crawl = await crawlSitemaps(roots, { scope, limits, fetchImpl: opts.fetchImpl });

  return {
    websiteUrl: website.toString(),
    robotsUrl: robots.robotsUrl,
    robotsFound: Boolean(robots.status && robots.status >= 200 && robots.status < 300),
    discoveredSitemaps: crawl.sitemaps,
    urls: crawl.urls,
    stats: {
      sitemapCount: crawl.sitemaps.length,
      urlCount: crawl.urls.length,
      sitemapsFromRobots: usedFallback ? 0 : robots.entries.length,
      usedFallback,
    },
    truncated: Object.values(crawl.truncated).some(Boolean) ? crawl.truncated : null,
    errors: crawl.errors,
  };
}
