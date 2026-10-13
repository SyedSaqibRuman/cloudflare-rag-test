// --------------------------
// WEBSITE URL NORMALIZATION + SCOPE
// Pure, no I/O — every other sitemap module funnels its URLs through here so
// protocol rejection, fragment stripping and host-scope checks can never be
// forgotten at a call site.
//
// This is the CMS-independent entry point: a "website" is just an origin. It
// knows nothing about WordPress, Next.js, Laravel or Shopify.
// --------------------------

/** Protocols we are willing to fetch. Everything else is rejected (§33). */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Error carrying a machine-readable code so the route layer can map a
 * bad-input failure to 400 while internal failures stay 502/500.
 */
export class SitemapError extends Error {
  constructor(message, code = "SITEMAP_ERROR", status = 502) {
    super(message);
    this.name = "SitemapError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Parse without throwing — every caller in this module treats a malformed
 * URL as "not a URL" rather than as an error.
 */
function safeParse(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * True when the string parses as an absolute http(s) URL with a hostname.
 * Rejects `javascript:`, `data:`, `file:`, protocol-relative and relative input.
 * @param {string} value
 * @returns {boolean}
 */
export function isHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol) && Boolean(parsed.hostname);
}
/**
 * Normalize a user-supplied WEBSITE url.
 *
 * The user's input represents a site, NOT a sitemap. Normalization:
 *   - requires a valid absolute http(s) URL (rejects file:, javascript:, …)
 *   - drops the fragment (`/page#section` → `/page`) — §3, same HTTP resource
 *   - preserves hostname and any meaningful path (so `/blog` stays a section root)
 *   - normalizes the trailing slash to exactly one
 *   - preserves the query string (never silently dropped — §17)
 *
 * @param {string} input
 * @returns {URL}
 * @throws {SitemapError} 400 when the input is not a usable website URL
 */
export function normalizeWebsiteUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new SitemapError("A website URL is required.", "INVALID_WEBSITE_URL", 400);
  }

  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new SitemapError(
      `"${input}" is not a valid absolute URL. Use a full address such as https://example.com`,
      "INVALID_WEBSITE_URL",
      400
    );
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new SitemapError(
      `Unsupported protocol "${parsed.protocol}". Only http and https are supported.`,
      "INVALID_WEBSITE_URL",
      400
    );
  }
  if (!parsed.hostname) {
    throw new SitemapError(`"${input}" has no hostname.`, "INVALID_WEBSITE_URL", 400);
  }

  // A fragment is never sent to the server and never identifies a new document.
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed;
}

/**
 * Resolve a possibly-relative reference against a base URL using the standard
 * `URL` API — never string concatenation (§7).
 * @param {string|URL} base
 * @param {string} reference
 * @returns {URL|null} null when the result is not a valid http(s) URL
 */
export function resolveUrl(base, reference) {
  if (typeof reference !== "string") return null;
  const ref = reference.trim();
  if (!ref) return null;
  try {
    const resolved = new URL(ref, base);
    return ALLOWED_PROTOCOLS.has(resolved.protocol) && resolved.hostname ? resolved : null;
  } catch {
    return null;
  }
}

/** Lower-cased hostname of a URL, or null. */
export function hostnameOf(url) {
  const parsed = typeof url === "string" ? safeParse(url) : url;
  return parsed ? parsed.hostname.toLowerCase() : null;
}

/**
 * Build the host allow-list for a website.
 *
 * Default scope is the entered host plus its `www.` sibling, because
 * `example.com` and `www.example.com` are the same site and a sitemap
 * routinely mixes them. Everything else — CDNs, other domains — is out of
 * scope by default (§16).
 *
 * @param {string|URL} websiteUrl
 * @param {Object} [opts]
 * @param {boolean} [opts.allowSubdomains=false] - also allow any subdomain
 * @param {boolean} [opts.allowExternal=false]     - disable scope checks entirely
 * @returns {{ hosts: Set<string>, baseHost: string, allowSubdomains: boolean, allowExternal: boolean }}
 */
export function buildScope(websiteUrl, { allowSubdomains = false, allowExternal = false } = {}) {
  const baseHost = hostnameOf(websiteUrl) || "";
  const hosts = new Set([baseHost]);
  if (baseHost.startsWith("www.")) hosts.add(baseHost.slice(4));
  else hosts.add(`www.${baseHost}`);
  return { hosts, baseHost, allowSubdomains, allowExternal };
}

/**
 * Is this URL inside the website's scope? — §16, §33
 * @param {string|URL} url
 * @param {ReturnType<typeof buildScope>} scope
 * @returns {boolean}
 */
export function isInScope(url, scope) {
  if (scope?.allowExternal) return isHttpUrl(url);
  const parsed = typeof url === "string" ? safeParse(url) : url;
  if (!parsed || !ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;

  const host = parsed.hostname.toLowerCase();
  if (scope?.hosts?.has(host)) return true;
  if (scope?.allowSubdomains && scope.baseHost) return host.endsWith(`.${scope.baseHost}`);
  return false;
}

/**
 * Canonical key for dedupe (§15). Deliberately conservative: fragments removed,
 * protocol/host casing normalized, trailing slash unified, but the path and
 * query string are PRESERVED — servers may distinguish `/about` from `/about/`,
 * and query parameters can be meaningful (§17).
 * @param {string} url
 * @returns {string}
 */
export function dedupeKey(url) {
  const parsed = typeof url === "string" ? safeParse(url) : url;
  if (!parsed) return String(url);
  parsed.hash = "";
  const path = parsed.pathname === "/" ? "/" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
}

