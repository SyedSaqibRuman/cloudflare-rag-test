// --------------------------
// 🔹 PAGINATION HELPER
// Shared utility for paginated list endpoints.
// Reads ?page= and ?perPage= from query, slices the array,
// and returns a structured response envelope.
// --------------------------

const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 200;

/**
 * Parse pagination query params from the request.
 * @param {import("express").Request} req
 * @param {{ defaultPerPage?: number }} [opts]
 * @returns {{ page: number, perPage: number, offset: number }}
 */
export function parsePagination(req, { defaultPerPage = DEFAULT_PER_PAGE } = {}) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, parseInt(req.query.perPage, 10) || defaultPerPage)
  );
  return { page, perPage, offset: (page - 1) * perPage };
}

/**
 * Paginate an array and build the response envelope.
 * Sets pagination headers (X-Total-Count, Link) on the response.
 *
 * @param {import("express").Response} res
 * @param {Array} items — full array from the repository
 * @param {{ page: number, perPage: number }} pagination — from parsePagination()
 * @param {string} dataKey — key name for the array in the response (e.g. "companies")
 * @param {string} basePath — URL path prefix for Link headers (e.g. "/gateway/companies")
 * @param {Record<string, string>} [extraQuery] — additional query params to preserve in Link headers
 * @returns {{ success: true, [dataKey]: Array, pagination: PaginationMeta }}
 */
export function paginate(res, items, pagination, dataKey, basePath, extraQuery = {}) {
  const total = items.length;
  const { page, perPage } = pagination;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const offset = (page - 1) * perPage;
  const pageItems = items.slice(offset, offset + perPage);

  // Build pagination metadata
  const meta = {
    page,
    perPage,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };

  // Set standard pagination headers
  res.set("X-Total-Count", String(total));
  res.set("X-Page-Count", String(totalPages));

  // Build Link headers for HATEOAS navigation
  const links = [];
  const qs = new URLSearchParams(extraQuery);
  if (meta.hasNextPage) {
    qs.set("page", String(page + 1));
    qs.set("perPage", String(perPage));
    links.push(`<${basePath}?${qs}>; rel="next"`);
  }
  if (meta.hasPrevPage) {
    qs.set("page", String(page - 1));
    qs.set("perPage", String(perPage));
    links.push(`<${basePath}?${qs}>; rel="prev"`);
  }
  if (totalPages > 1) {
    qs.set("page", "1");
    qs.set("perPage", String(perPage));
    links.push(`<${basePath}?${qs}>; rel="first"`);
    qs.set("page", String(totalPages));
    links.push(`<${basePath}?${qs}>; rel="last"`);
  }
  if (links.length > 0) {
    res.set("Link", links.join(", "));
  }

  // Build the response
  const response = { success: true, pagination: meta };
  response[dataKey] = pageItems;
  return res.json(response);
}
