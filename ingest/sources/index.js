// --------------------------
// SOURCE ADAPTER FACTORY
// Resolves the correct source adapter based on KB source_type.
// Each adapter returns items in the WP REST format the ingestion
// pipeline expects: { title: { rendered }, content: { rendered },
// slug, link, modified }.
// --------------------------

import { createUrlSource } from "./url.js";
import { createFileSource } from "./file.js";
import { createRestSource, validateRestSourceConfig } from "./rest.js";

export { validateRestSourceConfig };

/**
 * Create a source adapter from KB configuration.
 *
 * @param {Object}  opts
 * @param {string}  opts.sourceType     KB source_type ('wordpress', 'file', 'url', 'custom')
 * @param {Object}  opts.kb             KB row (may carry source_config JSON)
 * @param {string}  opts.companyName    Company key
 * @param {Object}  opts.wpAdapters     Legacy WordPress adapters { fetchPost, fetchPage, fetchWpByIds }
 * @param {number}  [opts.maxUrls]      Cap on discovered URLs (config.maxUrls ∩ saved docLimit, from ingest.js)
 * @returns {{ fetchPage, fetchPost, fetchWpByIds }}
 */
export function createSourceAdapter({ sourceType, kb, companyName, wpAdapters, maxUrls }) {
  // WordPress: use the existing WP REST adapters (default, backward-compatible).
  // NOTE: "wordpress" and "custom" are WITHDRAWN as KB *choices*
  // (shared/catalog-enums.js → KB_DISABLED_SOURCE_TYPES) but the adapters below
  // still resolve them on purpose — existing rows keep their source_type and must
  // keep ingesting. Disabling a source hides it; it never breaks stored data.
  if (!sourceType || sourceType === "wordpress") {
    return wpAdapters;
  }

  // Parse source_config from the KB row (JSON column)
  const config = parseSourceConfig(kb);

  switch (sourceType) {
    case "url": {
      const urls = config.urls || [];
      const sitemapUrl = config.sitemapUrl || null;
      // Automatic-discovery mode: the KB stores only a WEBSITE url and the
      // sitemap is found at ingest time (robots.txt → fallbacks → indexes).
      const websiteUrl = config.websiteUrl || null;
      if (!urls.length && !sitemapUrl && !websiteUrl) {
        throw new Error(
          `KB '${kb.kb_key}' has source_type 'url' but no websiteUrl, URLs or sitemapUrl configured in source_config.`
        );
      }
      return createUrlSource({
        urls,
        sitemapUrl,
        websiteUrl,
        concurrency: config.concurrency ?? 3,
        timeout: config.timeout ?? 15000,
        // Caller-supplied cap wins (ingest.js already intersects the saved
        // docLimit); fall back to the KB's own maxUrls; else the adapter default.
        maxUrls: maxUrls ?? config.maxUrls ?? 1000,
        maxDepth: config.maxDepth ?? 5,
        allowSubdomains: config.allowSubdomains ?? false,
        allowExternal: config.allowExternal ?? false,
      });
    }

    case "file": {
      const files = config.files || [];
      if (!files.length) {
        throw new Error(`KB '${kb.kb_key}' has source_type 'file' but no files configured in source_config.`);
      }
      return createFileSource({
        files,
        companyName,
      });
    }

    case "custom": {
      // Custom = generic REST source, configured via source_config.rest.
      // (Server-side adapters can still be injected by wrapping the returned
      // adapter in ingest.js if ever needed.)
      const restConfig = config.rest;
      if (!restConfig) {
        throw new Error(
          `KB '${kb.kb_key}' has source_type 'custom' but no "rest" block in source_config. ` +
          'Add one via PUT /gateway/kbs/' + kb.kb_key + '/sources — e.g. ' +
          '{ "sourceType": "custom", "rest": { "endpoint": "https://api.example.com/items?page={page}" } }.'
        );
      }
      return createRestSource({ rest: restConfig });
    }

    default:
      throw new Error(`Unknown source_type '${sourceType}' for KB '${kb.kb_key}'.`);
  }
}

/**
 * Parse source_config from a KB row.
 * Handles both JSON object and string cases.
 * @param {Object} kb
 * @returns {Object}
 */
function parseSourceConfig(kb) {
  const raw = kb.source_config;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
