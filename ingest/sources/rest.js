// --------------------------
// REST SOURCE ADAPTER (generic, source_config-driven)
// Fetches documents from any JSON REST API and returns items in the WP format
// the ingestion pipeline expects: { title: { rendered }, content: { rendered },
// slug, link, modified }.
//
// This backs KB source_type "custom" — the endpoint, auth, pagination, and
// field mapping are configured entirely via the KB's source_config JSON
// (under the `rest` key), so no server-side code is needed per source:
//
//   source_config: {
//     scope: "all",                       // standard scope keys still apply
//     rest: {
//       endpoint: "https://api.example.com/articles?page={page}&per_page=50",
//                                            // {page} and {cursor} placeholders
//       headers: { "Accept": "application/json" },
//       auth:                               // optional
//         { type: "bearer",  token: "…" }   //  → Authorization: Bearer …
//       | { type: "header", headerName: "x-api-key", token: "…" }
//       | { type: "basic",  username: "…", password: "…" }
//       | { type: "query",  paramName: "api_key", token: "…" },
//       itemsPath: "data",                  // dot path to the items array ("" = root)
//       pagination: "page",                 // "page" | "totalPages" | "cursor" | "link" | "none"
//       totalPagesPath: "meta.total_pages", // pagination=totalPages only
//       cursorPath: "meta.next_cursor",     // pagination=cursor only
//       perPage: 50,                        // stop-on-short-page detection (page mode)
//       maxItems: 1000,                     // hard safety cap (default 1000)
//       timeout: 15000,
//       contentFormat: "html",              // "html" (default) | "text" (wrapped in <p>)
//       mapping: {                          // optional dot paths into each item
//         title: "title",                   //   default: title.rendered → title → name
//         content: "body",                  //   default: content.rendered → content → body → html → text
//         slug: "slug",                     //   default: slug → derived from title
//         link: "url",                      //   default: link → url → ""
//         modified: "updated_at",           //   default: modified → modified_gmt → updated_at → date → now
//       },
//     },
//   }
//
// Tests inject a fake `fetch` via opts.fetch — no network needed.
// --------------------------

import fetch from "node-fetch";
import { logToFile } from "../../utils/logger.js";

const DEFAULT_MAX_ITEMS = 1000;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_PER_PAGE = 50;

// ------------------------------------------------------------------
// PUBLIC: validateRestSourceConfig — pure, shared with the wizard help
// text, the /sources route, and kb-service validation.
// ------------------------------------------------------------------

/**
 * Validate a `rest` source_config block.
 * @param {Object} rest  The rest config (source_config.rest)
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateRestSourceConfig(rest) {
  const errors = [];
  if (!rest || typeof rest !== "object" || Array.isArray(rest)) {
    return { ok: false, errors: ["rest config must be a JSON object."] };
  }

  const hasItems = Array.isArray(rest.items);
  if (!hasItems && typeof rest.endpoint !== "string") {
    errors.push("rest.endpoint (string URL) or rest.items (inline array) is required.");
  }
  if (rest.endpoint && !/^https?:\/\//i.test(rest.endpoint)) {
    errors.push("rest.endpoint must be an http(s) URL.");
  }
  if (rest.endpoint && !hasItems && !rest.endpoint.includes("{page}") && !rest.endpoint.includes("{cursor}")) {
    // Allowed — single-shot endpoint (pagination "none" or cursor-less) — but
    // pagination must not be "page"/"totalPages" or it would loop the same URL.
    const p = rest.pagination || "page";
    if (p === "page" || p === "totalPages") {
      errors.push(`rest.endpoint has no {page} placeholder — set "pagination": "none" or use a {page}/{cursor} placeholder.`);
    }
  }

  const PAGINATIONS = ["page", "totalPages", "cursor", "link", "none"];
  if (rest.pagination != null && !PAGINATIONS.includes(rest.pagination)) {
    errors.push(`rest.pagination must be one of: ${PAGINATIONS.join(", ")}.`);
  }
  if (rest.pagination === "totalPages" && typeof rest.totalPagesPath !== "string") {
    errors.push('rest.totalPagesPath is required when pagination is "totalPages".');
  }
  if (rest.pagination === "cursor" && typeof rest.cursorPath !== "string") {
    errors.push('rest.cursorPath is required when pagination is "cursor".');
  }

  if (rest.auth != null) {
    const a = rest.auth;
    const types = ["bearer", "header", "basic", "query"];
    if (!types.includes(a.type)) {
      errors.push(`rest.auth.type must be one of: ${types.join(", ")}.`);
    } else if (a.type === "bearer" && !a.token) {
      errors.push("rest.auth.token is required for bearer auth.");
    } else if (a.type === "header" && (!a.token || !a.headerName)) {
      errors.push("rest.auth.headerName and token are required for header auth.");
    } else if (a.type === "basic" && (!a.username || a.password === undefined)) {
      errors.push("rest.auth.username and password are required for basic auth.");
    } else if (a.type === "query" && (!a.token || !a.paramName)) {
      errors.push("rest.auth.paramName and token are required for query auth.");
    }
  }

  for (const numKey of ["perPage", "maxItems", "timeout"]) {
    if (rest[numKey] != null && (!Number.isFinite(Number(rest[numKey])) || Number(rest[numKey]) < 1)) {
      errors.push(`rest.${numKey} must be a positive number.`);
    }
  }
  if (rest.itemsPath != null && typeof rest.itemsPath !== "string") {
    errors.push("rest.itemsPath must be a string (dot path).");
  }
  if (rest.mapping != null && typeof rest.mapping !== "object") {
    errors.push("rest.mapping must be an object of dot paths.");
  }
  if (rest.contentFormat != null && !["html", "text"].includes(rest.contentFormat)) {
    errors.push('rest.contentFormat must be "html" or "text".');
  }

  return { ok: errors.length === 0, errors };
}

// ------------------------------------------------------------------
// PUBLIC: createRestSource
// ------------------------------------------------------------------

/**
 * Create a REST source adapter from source_config.rest.
 *
 * @param {Object} opts
 * @param {Object}  opts.rest        The rest config block (required)
 * @param {Function} [opts.fetch]    Injectable fetch (tests)
 * @returns {{ fetchPage, fetchPost, fetchWpByIds }}
 * @throws When the rest config is missing or invalid.
 */
export function createRestSource({ rest, fetch: fetchImpl } = {}) {
  if (!rest || typeof rest !== "object") {
    throw new Error(
      "Custom source requires a 'rest' block in source_config (endpoint or items). " +
      'Example: { "rest": { "endpoint": "https://api.example.com/items?page={page}" } }'
    );
  }
  const check = validateRestSourceConfig(rest);
  if (!check.ok) {
    throw new Error(`Invalid rest source_config: ${check.errors.join(" ")}`);
  }

  const doFetch = fetchImpl || fetch;
  const endpoint = rest.endpoint || "";
  const itemsPath = rest.itemsPath ?? "";
  const pagination = rest.items ? "none" : (rest.pagination || "page");
  const perPage = Number(rest.perPage) || DEFAULT_PER_PAGE;
  const maxItems = Number(rest.maxItems) || DEFAULT_MAX_ITEMS;
  const timeout = Number(rest.timeout) || DEFAULT_TIMEOUT_MS;
  const mapping = rest.mapping || {};
  const contentFormat = rest.contentFormat || "html";

  /** Build request headers (+ auth) for a fetch. */
  function buildHeaders() {
    const headers = {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; RAG-Ingestion-Bot/1.0)",
      ...(rest.headers || {}),
    };
    const a = rest.auth;
    if (a?.type === "bearer") headers.Authorization = `Bearer ${a.token}`;
    if (a?.type === "header") headers[a.headerName] = a.token;
    if (a?.type === "basic") headers.Authorization = `Basic ${Buffer.from(`${a.username}:${a.password}`).toString("base64")}`;
    return headers;
  }

  /** Append query auth param (and any user query extras live in the URL). */
  function buildUrl(placeholders) {
    let url = endpoint
      .replaceAll("{page}", String(placeholders.page ?? 1))
      .replaceAll("{cursor}", encodeURIComponent(placeholders.cursor ?? ""));
    const a = rest.auth;
    if (a?.type === "query") {
      const sep = url.includes("?") ? "&" : "?";
      url += `${sep}${encodeURIComponent(a.paramName)}=${encodeURIComponent(a.token)}`;
    }
    return url;
  }

  /** Fetch one page and return the parsed JSON body. */
  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await doFetch(url, { headers: buildHeaders(), signal: controller.signal, redirect: "follow" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${redactUrl(url)}`);
      }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Response from ${redactUrl(url)} is not valid JSON.`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** Extract the items array from a response body via itemsPath. */
  function extractItems(body) {
    const items = resolvePath(body, itemsPath);
    if (!Array.isArray(items)) {
      throw new Error(
        `itemsPath "${itemsPath || "(root)"}" did not resolve to an array in the API response. ` +
        "Set rest.itemsPath to the dot path of the items array."
      );
    }
    return items;
  }

  /** Map one API item into the WP shape the pipeline expects. */
  function mapItem(raw, idx) {
    const title = str(resolvePath(raw, mapping.title) ?? resolvePath(raw, "title.rendered") ?? resolvePath(raw, "title") ?? resolvePath(raw, "name")) || `Item ${idx + 1}`;
    let content = resolvePath(raw, mapping.content) ?? resolvePath(raw, "content.rendered") ?? resolvePath(raw, "content") ?? resolvePath(raw, "body") ?? resolvePath(raw, "html") ?? resolvePath(raw, "text") ?? "";
    if (typeof content !== "string") content = JSON.stringify(content);
    if (contentFormat === "text") content = textToParagraphs(content);

    const link = str(resolvePath(raw, mapping.link) ?? resolvePath(raw, "link") ?? resolvePath(raw, "url")) || "";
    let slug = str(resolvePath(raw, mapping.slug) ?? resolvePath(raw, "slug"));
    if (!slug) {
      slug = (link || title)
        .toLowerCase()
        .replace(/^https?:\/\/[^/]+\/?/, "") // strip origin for URLs
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);
    }
    if (!slug) slug = `item-${idx + 1}`;

    const modified = str(
      resolvePath(raw, mapping.modified) ?? resolvePath(raw, "modified") ?? resolvePath(raw, "modified_gmt") ??
      resolvePath(raw, "updated_at") ?? resolvePath(raw, "date") ?? resolvePath(raw, "created_at")
    ) || new Date().toISOString();

    const item = {
      title: { rendered: title },
      content: { rendered: content },
      slug,
      link,
      modified,
      _source: "rest",
    };
    const id = resolvePath(raw, mapping.id) ?? resolvePath(raw, "id");
    if (id != null) item.id = id;
    return item;
  }

  /**
   * Fetch a page of items. Page 1 also captures totalPages for
   * pagination=totalPages; cursor mode follows cursorPath.
   * Returns WP-shaped items, or null when there are no more.
   */
  async function fetchRestPage(page) {
    // Static inline items (no fetching) — single shot.
    if (rest.items) {
      if (page > 1) return null;
      return rest.items.slice(0, maxItems).map(mapItem);
    }

    if (pagination === "none" && page > 1) return null;

    const body = await fetchJson(buildUrl({ page }));
    const items = extractItems(body).map(mapItem);

    if (pagination === "totalPages") {
      const total = Number(resolvePath(body, rest.totalPagesPath));
      if (Number.isFinite(total) && page >= total) return items.length ? items : null;
      return items.length ? items : null; // also stops on empty page
    }

    // "page" mode: stop on empty page or short page (perPage known).
    if (!items.length) return null;
    if (pagination === "page" && items.length < perPage) return items;

    // Page-mode full pages continue; cap for safety.
    if (page * perPage >= maxItems) {
      console.log(`🛑 REST source reached maxItems cap (${maxItems}).`);
      return items;
    }
    return items;
  }

  /**
   * fetchPage as the pipeline calls it: fetchFn(page, companyName).
   * Wraps cursor/link modes (which are sequential state machines) around the
   * page-numbered interface by replaying pages internally and caching them.
   */
  let replay = { mode: null, queue: [], cursor: null, exhausted: false, totalPagesFetched: false };
  async function fetchPage(pageNumber, _companyName) {
    if (!rest.items && pagination === "page") return fetchRestPage(pageNumber);
    if (!rest.items && pagination === "none" && pageNumber === 1) return fetchRestPage(1);
    if (!rest.items && pagination === "totalPages") return fetchRestPage(pageNumber);

    // Sequential modes: fetch everything once, then hand out one batch per
    // page number (the pipeline's docLimit trim still applies per batch).
    if (replay.mode !== pagination) {
      replay = { mode: pagination, queue: [], cursor: null, exhausted: false };
      try {
        if (pagination === "cursor") {
          let guard = 0;
          while (!replay.exhausted && guard++ < 1000 && replay.queue.length < maxItems) {
            const body = await fetchJson(buildUrl({ cursor: replay.cursor }));
            const items = extractItems(body).map(mapItem);
            replay.queue.push(...items);
            replay.cursor = str(resolvePath(body, rest.cursorPath));
            if (!replay.cursor || !items.length) replay.exhausted = true;
          }
        } else if (pagination === "link") {
          let url = buildUrl({ page: 1 });
          let guard = 0;
          while (url && guard++ < 1000 && replay.queue.length < maxItems) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            let res, body;
            try {
              res = await doFetch(url, { headers: buildHeaders(), signal: controller.signal });
              if (!res.ok) throw new Error(`HTTP ${res.status} from ${redactUrl(url)}`);
              body = JSON.parse(await res.text());
            } finally {
              clearTimeout(timer);
            }
            replay.queue.push(...extractItems(body).map(mapItem));
            url = parseLinkNext(res.headers.get("link"));
          }
        }
      } catch (err) {
        console.error(`❌ REST source failed: ${err.message}`);
        logToFile("error.log", `❌ REST source: ${err.message}`);
        if (!replay.queue.length) throw err;
        // partial results still ingest — surfaced via log
      }
      replay.queue = replay.queue.slice(0, maxItems);
    }

    if (!replay.queue.length) return null;
    const BATCH = perPage;
    const batch = replay.queue.splice(0, BATCH);
    return batch.length ? batch : null;
  }

  // Posts and pages both map to the same REST list — fetchPost returns null
  // (like url.js/file.js) so the pipeline's post+page double pass doesn't
  // ingest every document twice. Selected-scope by WP ids is not applicable
  // to custom sources.
  return {
    fetchPage,
    fetchPost: async () => null,
    fetchWpByIds: async () => [],
  };
}

// ------------------------------------------------------------------
// Internals
// ------------------------------------------------------------------

/** Resolve "a.b.c" / "a[0].b" style dot paths. Returns undefined when missing. */
export function resolvePath(obj, path) {
  if (path == null || path === "") return obj;
  const parts = String(path)
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Parse a Link header and return the rel="next" URL, or null. */
export function parseLinkNext(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="?next"?/i);
    if (m) return m[1];
  }
  return null;
}

/** Strip query auth tokens from a URL before logging. */
function redactUrl(url) {
  return url.replace(/([?&](?:api_key|token|key|access_token)=)[^&]+/gi, "$1***");
}

function str(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/** Wrap plain text into HTML paragraphs (same spirit as file.js). */
function textToParagraphs(text) {
  if (!text) return "<p>No content extracted.</p>";
  return text
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${p.trim().replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
