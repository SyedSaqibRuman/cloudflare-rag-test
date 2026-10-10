// --------------------------
// ROBOTS.TXT — FETCH + PARSE
// The PRIMARY sitemap discovery mechanism (§4). The file is always requested
// from the site's ORIGIN, never from the user's path:
//   https://example.com/blog  →  https://example.com/robots.txt
// --------------------------

import { fetchText } from "./http.js";
import { resolveUrl } from "./normalize.js";
import { logDiscovery, logDiscoveryWarn } from "./log.js";

/**
 * Parse `Sitemap:` directives out of a robots.txt body.
 *
 * Pure and total: a malformed or unsupported-protocol directive is logged and
 * SKIPPED, never returned and never thrown on, so one bad line cannot abort
 * discovery (§6, §8). The directive name is matched case-insensitively, which
 * the robots.txt spec does not require but real sites rely on.
 *
 * @param {string} text - raw robots.txt
 * @param {string|URL} baseUrl - the origin, used to resolve relative references
 * @returns {string[]} absolute, validated, de-duplicated sitemap URLs
 */
export function parseRobotsTxt(text, baseUrl) {
  if (typeof text !== "string" || !text.trim()) return [];

  const out = [];
  const seen = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = /^sitemap\s*:\s*(.+)$/i.exec(line);
    if (!match) continue;

    const reference = match[1].trim();
    if (!reference) continue;

    // Malformed or non-http(s) → log and skip; never fetched.
    const resolved = resolveUrl(baseUrl, reference);
    if (!resolved) {
      logDiscoveryWarn(`Ignoring malformed sitemap directive: ${reference.slice(0, 120)}`);
      continue;
    }

    const key = resolved.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Fetch and parse the origin's robots.txt.
 *
 * Never throws — a 404/403/5xx/timeout all degrade to an empty list so the
 * caller can proceed to fallback discovery (§10).
 *
 * @param {string|URL} origin
 * @param {Object} [opts]
 * @returns {Promise<{ robotsUrl: string, entries: Array, status: number|null, error: string|null }>}
 */
export async function fetchRobotsSitemaps(origin, opts = {}) {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  logDiscovery(`Fetching robots.txt: ${robotsUrl}`);

  const result = await fetchText(robotsUrl, {
    ...opts,
    accept: "text/plain,*/*;q=0.8",
    // robots.txt is a small text file; cap it hard (§34).
    maxBytes: opts.maxRobotsBytes,
  });

  if (!result.ok) {
    logDiscovery(`robots.txt not usable (HTTP ${result.status ?? "network"}${result.error ? ` — ${result.error}` : ""})`);
    return { robotsUrl, entries: [], status: result.status, error: result.error };
  }

  const entries = parseRobotsTxt(result.text, origin);
  logDiscovery(`Found ${entries.length} sitemap directive(s)`);
  return { robotsUrl, entries, status: result.status, error: null };
}
