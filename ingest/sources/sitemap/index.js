// --------------------------
// SITEMAP DISCOVERY MODULE (barrel)
//
// Website URL → robots.txt → sitemap(s) → page URLs.
//
// CMS-independent by design: it discovers URLs for any site that publishes a
// valid sitemap — WordPress, Next.js, Laravel, Shopify or a static generator.
// It never calls the WordPress REST API (§23).
//
// The public surface is intentionally small:
//   discoverSitemaps(websiteUrl, opts)  → structured discovery result
// Everything else is exported for unit testing.
// --------------------------

export { discoverSitemaps, FALLBACK_SITEMAP_PATHS } from "./discover.js";
export { crawlSitemaps } from "./crawler.js";
export { parseSitemapXml } from "./parser.js";
export { fetchRobotsSitemaps, parseRobotsTxt } from "./robots.js";
export {
  normalizeWebsiteUrl,
  resolveUrl,
  isHttpUrl,
  isInScope,
  buildScope,
  dedupeKey,
  hostnameOf,
  SitemapError,
} from "./normalize.js";
export {
  fetchText,
  resolveLimits,
  DEFAULT_DISCOVERY_LIMITS,
  DISCOVERY_USER_AGENT,
} from "./http.js";
