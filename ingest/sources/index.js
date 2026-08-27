// --------------------------
// SOURCE ADAPTER FACTORY
// Resolves the correct source adapter based on KB source_type.
// Each adapter returns items in the WP REST format the ingestion
// pipeline expects: { title: { rendered }, content: { rendered },
// slug, link, modified }.
// --------------------------

import { createUrlSource } from "./url.js";
import { createFileSource } from "./file.js";

/**
 * Create a source adapter from KB configuration.
 *
 * @param {Object}  opts
 * @param {string}  opts.sourceType     KB source_type ('wordpress', 'file', 'url', 'custom')
 * @param {Object}  opts.kb             KB row (may carry source_config JSON)
 * @param {string}  opts.companyName    Company key
 * @param {Object}  opts.wpAdapters     Legacy WordPress adapters { fetchPost, fetchPage, fetchWpByIds }
 * @returns {{ fetchPage, fetchPost, fetchWpByIds }}
 */
export function createSourceAdapter({ sourceType, kb, companyName, wpAdapters }) {
  // WordPress: use the existing WP REST adapters (default, backward-compatible)
  if (!sourceType || sourceType === "wordpress") {
    return wpAdapters;
  }

  // Parse source_config from the KB row (JSON column)
  const config = parseSourceConfig(kb);

  switch (sourceType) {
    case "url": {
      const urls = config.urls || [];
      const sitemapUrl = config.sitemapUrl || null;
      if (!urls.length && !sitemapUrl) {
        throw new Error(`KB '${kb.kb_key}' has source_type 'url' but no URLs or sitemap configured in source_config.`);
      }
      return createUrlSource({
        urls,
        sitemapUrl,
        concurrency: config.concurrency ?? 3,
        timeout: config.timeout ?? 15000,
        maxUrls: config.maxUrls ?? 1000,
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

    case "custom":
      // Custom sources are expected to inject their own adapters via the API
      throw new Error(
        `KB '${kb.kb_key}' uses source_type 'custom' — ` +
        `use POST /gateway/kbs/${kb.kb_key}/ingest with a custom adapter.`
      );

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
