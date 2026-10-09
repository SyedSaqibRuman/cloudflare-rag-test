import { runtimeConfig, getCompanyConfig } from "../config/index.js";

// --------------------------
// HTTP REQUEST CONTEXT
// One place for the two rules every layer needs: resolving a company from the
// x-company-name header, and deciding whether a browser origin is one of ours.
// app.js middleware and route helpers cross this seam, so the error messages
// and the <company>.com rule cannot drift between layers.
// --------------------------

const ALLOWED_ORIGINS = [
  "https://dev.popularcert.com",
  "https://staging.popularcert.com",
  "https://www.popularcert.com",
  "https://popularcert.com",
  "https://crm.popularcert.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
];

const STATIC_HOSTS = new Set(
  ALLOWED_ORIGINS.map((o) => {
    try { return new URL(o).hostname; } catch { return null; }
  }).filter(Boolean)
);

// A company's domain is derived from its name: x-company-name 'popularcert' → popularcert.com.
function companyDomains() {
  return Object.keys(runtimeConfig.COMPANIES).map((name) => `${name}.com`);
}

function parseHost(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    return null;
  }
}

const isDevHost =
  (host) =>
  host === "localhost" ||
  host.endsWith(".localhost") ||
  host === "127.0.0.1" ||
  host === "[::1]" ||
  host === "::1";

/**
 * Resolve a company from the x-company-name header, with optional fallback
 * to the ?company= query param (query: true) and/or body.company
 * (body: true). Header wins over query, query over body.
 * Returns { companyName, error } — exactly one is set.
 */
export function companyFromRequest(req, { query = false, body = false } = {}) {
  const header = req.headers?.["x-company-name"]?.trim();
  const fromQuery = query ? req.query?.company?.trim() : "";
  const fromBody = body ? req.body?.company?.trim() : "";
  const company = header || fromQuery || fromBody;
  if (!company) {
    return { companyName: null, error: "Company is required (x-company-name header, ?company=, or body.company)." };
  }
  if (!getCompanyConfig(company)) {
    return { companyName: null, error: `Company '${company}' not found. Create it in the admin portal first.` };
  }
  return { companyName: company, error: null };
}

/**
 * CORS check: is this origin allowed at all? Static allowlist hosts, dev
 * hosts, and any runtime company's <company>.com (plus subdomains) pass.
 * Null origin (non-browser clients) passes.
 */
export function isAllowedOrigin(origin) {
  if (!origin) return true;
  const host = parseHost(origin);
  if (!host) return false;
  if (isDevHost(host)) return true;
  if (STATIC_HOSTS.has(host)) return true;
  return companyDomains().some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Origin check for a specific company (per-company API key enforcement):
 * browser calls must come from <company>.com or a subdomain. Null origin and
 * dev hosts pass. Returns { ok: true } or { ok: false, status, error }.
 */
export function companyOriginCheck(origin, companyName) {
  if (!origin) return { ok: true };
  const host = parseHost(origin);
  if (!host) return { ok: false, status: 400, error: "Invalid Origin header." };
  if (isDevHost(host)) return { ok: true };
  const domain = `${companyName}.com`;
  if (host === domain || host.endsWith(`.${domain}`)) return { ok: true };
  return {
    ok: false,
    status: 403,
    error: `Origin '${host}' is not allowed for company '${companyName}'. Expected '${domain}' or a subdomain.`,
  };
}
