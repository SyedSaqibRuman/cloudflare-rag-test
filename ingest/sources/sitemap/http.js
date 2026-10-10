// --------------------------
// SINGLE HTTP PRIMITIVE FOR DISCOVERY
// Every robots.txt / sitemap request in this module goes through here so the
// timeout, retry, redirect, size-cap and User-Agent rules are applied exactly
// once. Reuses the project retry helper rather than adding a second retry
// implementation (§19, §35).
//
// `fetchImpl` is an injection seam: tests pass a stub, production uses
// node-fetch (the same client services/wp.js and ingest/sources/url.js use).
// --------------------------

import fetch from "node-fetch";
import { retry, sleep } from "../../../utils/helpers.js";
import { SitemapError } from "./normalize.js";

/** Identifies the service honestly — we never impersonate Googlebot (§19). */
export const DISCOVERY_USER_AGENT =
  "Mozilla/5.0 (compatible; PopularCert-KnowledgeBaseBot/1.0; +https://github.com/SyedSaqibRuman/cloudflare-rag-test)";

/** Defaults live here once, not scattered through the crawl (§18). */
export const DEFAULT_DISCOVERY_LIMITS = Object.freeze({
  timeoutMs: 15_000,
  retries: 2,          // retries AFTER the first attempt
  retryDelayMs: 750,
  maxRedirects: 5,
  maxRobotsBytes: 512 * 1024,
  maxSitemapBytes: 8 * 1024 * 1024,
  maxSitemaps: 1_000,
  maxUrls: 100_000,
  maxDepth: 5,
});

/** Merge caller limits over the defaults. */
export function resolveLimits(limits = {}) {
  return { ...DEFAULT_DISCOVERY_LIMITS, ...limits };
}

/**
 * Read a response body while enforcing a hard byte cap, so a hostile or
 * misconfigured server can never exhaust worker memory (§34).
 * @returns {Promise<string>}
 */
async function readCapped(res, maxBytes, url) {
  if (!res.body) return res.text?.() ?? "";

  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      // Stop pulling — the response is abandoned, not buffered.
      try {
        res.body.destroy?.();
      } catch {
        /* best effort */
      }
      throw new SitemapError(
        `Response from ${url} exceeded the ${Math.round(maxBytes / 1024)} KB limit.`,
        "RESPONSE_TOO_LARGE"
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Retry only on transient conditions; 4xx answers are final (§10). */
function isRetryable(err, status) {
  if (err instanceof SitemapError) return false;
  if (status && status >= 400 && status < 500) return false;
  return true;
}

/**
 * Fetch a text resource with timeout + retry + size cap.
 * NEVER throws for an HTTP error — the status is returned so the caller can
 * decide (fallback vs. fail). Only network/transport problems throw.
 *
 * @param {string} url
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]
 * @param {number} [opts.maxBytes]
 * @param {number} [opts.maxRedirects]
 * @param {string} [opts.accept]
 * @param {Function} [opts.fetchImpl] - test seam
 * @returns {Promise<{ ok: boolean, status: number|null, text: string, finalUrl: string, error: string|null }>}
 */
export async function fetchText(url, opts = {}) {
  const limits = resolveLimits(opts);
  const doFetch = opts.fetchImpl || fetch;
  const maxBytes = opts.maxBytes ?? limits.maxSitemapBytes;

  try {
    return await retry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
      try {
        const res = await doFetch(url, {
          signal: controller.signal,
          redirect: "follow",
          follow: limits.maxRedirects,   // node-fetch caps the redirect chain
          headers: {
            "User-Agent": DISCOVERY_USER_AGENT,
            Accept: opts.accept || "application/xml,text/xml;q=0.9,text/plain;q=0.5,*/*;q=0.1",
            "Accept-Encoding": "gzip, deflate",
          },
        });

        if (!res.ok) {
          // Drain nothing; just report. 4xx is not retried.
          const retryable = isRetryable(null, res.status);
          if (retryable && limits.retries > 0) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
          return { ok: false, status: res.status, text: "", finalUrl: res.url || url, error: `HTTP ${res.status}` };
        }

        const text = await readCapped(res, maxBytes, url);
        return { ok: true, status: res.status, text, finalUrl: res.url || url, error: null };
      } finally {
        clearTimeout(timer);
      }
    }, limits.retries, limits.retryDelayMs);
  } catch (err) {
    return {
      ok: false,
      status: err?.status ?? null,
      text: "",
      finalUrl: url,
      error: err?.name === "AbortError" ? "timed out" : err?.message || "network error",
    };
  }
}

export { sleep };
