import fetch from "node-fetch";
import { retry, sleep } from "../utils/helpers.js";
import { getConfig } from "../config/index.js";

const PER_PAGE = 100;
const DELAY_MS = 300;

// --------------------------
// 🔹 WordPress REST API Source Fetcher
// Supports three ingestion scopes:
//   all      → paginate through all pages/posts
//   selected → fetch only specific WP items by type + id
//   limit    → paginate up to a maximum number of API pages
// --------------------------

/**
 * Fetch a single page of WP items (posts or pages) by pagination.
 * @param {string} type - "posts" or "pages"
 * @param {number} page - 1-indexed API page number
 * @param {string} companyName
 * @returns {Promise<Array|null>}
 */
async function fetchWP(type, page, companyName) {
  try {
    const baseUrl = getConfig(companyName).BASE_URL;
    return await retry(async () => {
      const url = `${baseUrl}/wp-json/wp/v2/${type}?per_page=${PER_PAGE}&page=${page}`;

      console.log(`Fetching ${type} page ${page}...`);

      const res = await fetch(url, {
        headers: { "User-Agent": "RAG-Ingestion-Bot" },
      });

      const totalPages = parseInt(res.headers.get("X-WP-TotalPages") || "1", 10);

      if (!res.ok) {
        if (res.status === 400) return null;
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      await sleep(DELAY_MS);

      if (page >= totalPages) return data.length > 0 ? data : null;
      return data;
    });
  } catch (err) {
    console.error("❌ Final failure:", err.message);
    return null;
  }
}

/**
 * Fetch specific WP items by type + IDs (for "selected" scope).
 * Uses the include[] parameter to batch-fetch up to 100 IDs per request.
 * @param {string} type - "posts" or "pages"
 * @param {number[]} ids - WP item IDs to fetch
 * @param {string} companyName
 * @returns {Promise<Array>}
 */
async function fetchWPByIds(type, ids, companyName) {
  if (!ids || ids.length === 0) return [];
  try {
    const baseUrl = getConfig(companyName).BASE_URL;
    const results = [];

    // WP REST API allows up to 100 IDs per include[] query
    const batches = [];
    for (let i = 0; i < ids.length; i += 100) {
      batches.push(ids.slice(i, i + 100));
    }

    for (const batch of batches) {
      const idParams = batch.map((id) => `include[]=${id}`).join("&");
      const url = `${baseUrl}/wp-json/wp/v2/${type}?per_page=${PER_PAGE}&${idParams}`;

      const res = await fetch(url, {
        headers: { "User-Agent": "RAG-Ingestion-Bot" },
      });

      if (!res.ok) {
        console.error(`❌ Failed to fetch ${type} by IDs: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      results.push(...data);
      await sleep(DELAY_MS);
    }

    return results;
  } catch (err) {
    console.error("❌ Failed to fetch by IDs:", err.message);
    return [];
  }
}

// --------------------------
// 🔹 Public API
// --------------------------

/**
 * Fetch a page of WP pages.
 * @param {number} page
 * @param {string} companyName
 */
export async function fetchPage(page, companyName) {
  return fetchWP("pages", page, companyName);
}

/**
 * Fetch a page of WP posts.
 * @param {number} page
 * @param {string} companyName
 */
export async function fetchPost(page, companyName) {
  return fetchWP("posts", page, companyName);
}

/**
 * Fetch specific WP items by type and IDs.
 * @param {string} type - "pages" or "posts"
 * @param {number[]} ids - WP item IDs
 * @param {string} companyName
 */
export async function fetchWpByIds(type, ids, companyName) {
  return fetchWPByIds(type, ids, companyName);
}

/**
 * List all available WP pages and posts (lightweight: id, title, url, type, modified).
 * Paginates through the WP REST API and returns a flat list.
 * @param {string} companyName
 * @param {Object} [opts]
 * @param {string[]} [opts.contentTypes] - ["page","post"] default both
 * @param {number} [opts.maxPages] - max API pages per type (safety limit)
 * @returns {Promise<Array<{id:number, title:string, url:string, type:string, modified:string}>>}
 */
export async function listAllSourcePages(companyName, opts = {}) {
  const contentTypes = opts.contentTypes || ["pages", "posts"];
  const maxPages = opts.maxPages || 50;
  const results = [];

  for (const ct of contentTypes) {
    const wpType = ct === "page" || ct === "pages" ? "pages" : "posts";
    const label = wpType === "pages" ? "page" : "post";

    for (let pg = 1; pg <= maxPages; pg++) {
      const items = await fetchWP(wpType, pg, companyName);
      if (!items || items.length === 0) break;

      for (const item of items) {
        results.push({
          id: item.id,
          title: item.title?.rendered || item.slug || `#${item.id}`,
          url: item.link || item.guid?.rendered || "",
          type: label,
          modified: item.modified || item.date || "",
        });
      }

      // fetchWP returns null when we've hit the last page
      if (items.length < PER_PAGE) break;
    }
  }

  return results;
}
