// --------------------------
// SITEMAP XML PARSER
// Pure — takes a string, returns a structured sitemap description. No I/O.
//
// Uses cheerio's XML mode (htmlparser2): a real parser, so namespaces, CDATA,
// whitespace and XML entities (`&amp;` → `&`) are handled by the parser rather
// than by a regex. The former implementation in ingest/sources/url.js matched
// `<loc>` with /<loc>([^<]+)<\/loc>/gi, which silently corrupted any entity
// or namespaced document.
//
// Namespace handling: sitemaps in the wild use BOTH a default namespace
// (`xmlns="…sitemap/0.9"`) and a prefixed one (`<sm:urlset xmlns:sm="…">`).
// CSS selectors cannot match the prefixed form, so we walk the tree and compare
// LOCAL names (the part after the colon).
// --------------------------

import { load as cheerioLoad } from "cheerio";

/** Local (namespace-stripped) tag name of an element. */
function localName(el) {
  return (el?.tagName || el?.name || "").split(":").pop();
}

/**
 * Parse a sitemap document.
 *
 * @param {string} xml - raw response body
 * @returns {{ type: "urlset"|"sitemapindex"|"unknown", sitemaps: string[], urls: Array<{url: string, lastModified: string|null}>, isSitemap: boolean }}
 *   `isSitemap` is the trusted validity signal — a 200 response is NOT enough
 *   (§11). An HTML page served at a sitemap path yields `type: "unknown"`.
 */
export function parseSitemapXml(xml) {
  const empty = { type: "unknown", sitemaps: [], urls: [], isSitemap: false };
  if (typeof xml !== "string" || !xml.trim()) return empty;

  let $;
  try {
    $ = cheerioLoad(xml, { xmlMode: true });
  } catch {
    // Malformed XML — not a sitemap, but must not crash discovery (§6).
    return empty;
  }

  const all = $("*").toArray();

  // Direct children of `el` whose local name matches `name`.
  const childText = (el, name) =>
    all.filter((x) => x.parent === el && localName(x) === name).map((x) => $(x).text());

  const indexRoot = all.find((el) => localName(el) === "sitemapindex");
  if (indexRoot) {
    const sitemaps = all
      .filter((el) => el.parent === indexRoot && localName(el) === "sitemap")
      .map((el) => childText(el, "loc")[0]?.trim())
      .filter(Boolean);
    return { type: "sitemapindex", sitemaps, urls: [], isSitemap: true };
  }

  const urlsetRoot = all.find((el) => localName(el) === "urlset");
  if (urlsetRoot) {
    const urls = all
      .filter((el) => el.parent === urlsetRoot && localName(el) === "url")
      .map((el) => ({
        url: childText(el, "loc")[0]?.trim() || "",
        // <lastmod> is optional (§14) — never required, never fatal when absent.
        lastModified: childText(el, "lastmod")[0]?.trim() || null,
      }))
      .filter((entry) => entry.url);
    return { type: "urlset", sitemaps: [], urls, isSitemap: true };
  }

  return empty;
}
