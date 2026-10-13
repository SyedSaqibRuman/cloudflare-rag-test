// --------------------------
// CLOUDFLARE RESOURCES ROUTER (live CRUD against the Cloudflare REST API)
// Unlike the registry-style provider_resources (which only RECORDS a row),
// these endpoints actually create/delete infrastructure on the Cloudflare
// account: Vectorize indexes, R2 buckets, D1 databases, KV namespaces.
//
// Credentials come from the company's saved gateway connections — the same
// api_token + account_id fields the Connections card stores for the
// cloudflare provider family (cloudflare, cloudflare_worker_ai,
// cloudflare_vectorize, cloudflare_r2, cloudflare_d1 all authenticate the
// same way). The provider_key on the page wins, then the umbrella
// `cloudflare`, then any other active family member.
//
// Resource types mirror the catalog's provider_resource_templates:
//   vector_index  → Vectorize v2  (/accounts/{id}/vectorize/v2/indexes)
//   object_bucket → R2 buckets    (/accounts/{id}/r2/buckets)
//   sql_database  → D1 databases  (/accounts/{id}/d1/database)
//   kv_namespace  → KV namespaces (/accounts/{id}/storage/kv/namespaces)
// --------------------------
import express from "express";
import { CompanyRepository, CredentialRepository, AuditRepository } from "../repositories.js";
import * as CredentialService from "../services/credential-service.js";
import { wrap } from "./helpers.js";
import { RESOURCE_NAME_RE } from "../../shared/patterns.js";
import { actorFromReq } from "./shared-helpers.js";

const router = express.Router();

const CF_BASE = "https://api.cloudflare.com/client/v4";

// Credential rows whose api_token/account_id can drive Cloudflare REST calls.
const CLOUDFLARE_KEYS = [
  "cloudflare",
  "cloudflare_worker_ai",
  "cloudflare_vectorize",
  "cloudflare_r2",
  "cloudflare_d1",
];

// Each resource type has a dedicated catalog provider whose connection is the
// best source of credentials for it (separate accounts are common: the
// umbrella `cloudflare` connection may sit on the AI/Vectorize account while
// the R2 buckets live under the `cloudflare_r2` account). The service-specific
// connection wins, then the page's provider key, then the umbrella, then any
// family member.
const TYPE_PREFERRED_PROVIDER = {
  vector_index: "cloudflare_vectorize",
  object_bucket: "cloudflare_r2",
  sql_database: "cloudflare_d1",
  kv_namespace: "cloudflare_worker_ai",
};

/** Fail an HTTP request with a message + status (handled by `wrap`). */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Cloudflare REST call: GET/POST/DELETE against `path` (relative to the CF
 * base URL) with the account API token. Throws with the provider's own error
 * message on failure ({ success:false, errors:[{code,message}] } or HTTP).
 */
async function cfFetch(token, path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`${CF_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Network error reaching Cloudflare: ${err.message}`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || (data && data.success === false)) {
    const err0 = data?.errors?.[0] || {};
    // Keep the provider's own message AND its error code (e.g. "10042 — Please
    // enable R2…") so the admin can look up the exact failure.
    const message = err0.message || data?.errors?.[0] || data?.error || `Cloudflare returned HTTP ${res.status}.`;
    const messageWithCode = err0.code != null ? `${err0.code} — ${message}` : message;
    const err = new Error(messageWithCode);
    // Always 502 (bad gateway) — the executor's contract for upstream provider
    // failures. Deliberately NOT the upstream status: 401/403 from Cloudflare
    // must never collide with the admin-session 401 that the portal treats as
    // "session expired" (it would log the user out on a bad token).
    err.status = 502;
    throw err;
  }
  return data;
}

/**
 * Pick the company's Cloudflare credential for a resource type: the dedicated
 * provider for that type wins (cloudflare_r2 for object_bucket, …), then the
 * page's provider key, then the umbrella `cloudflare`, then any active family
 * member. Decrypts it and returns the plaintext fields needed for REST calls.
 */
async function resolveCfCredential(company, providerKey, type) {
  const rows = await CredentialRepository.listByCompany(company.id, { includeStored: true });
  const active = rows.filter((r) => r && r.is_active);
  const pick = (key) => active.find((r) => r.provider_key === key);
  const row =
    pick(TYPE_PREFERRED_PROVIDER[type]) ||
    pick(providerKey) ||
    pick("cloudflare") ||
    active.find((r) => CLOUDFLARE_KEYS.includes(r.provider_key));
  if (!row) {
    throw new HttpError(
      404,
      `No active Cloudflare connection for company '${company.company_key}'. Add one on the Connections card first.`
    );
  }
  let fields;
  try {
    fields = CredentialService.decryptCredential(row.encrypted_credentials);
  } catch (err) {
    throw new HttpError(500, `Could not decrypt the Cloudflare credential: ${err.message}`);
  }
  const accountId = fields.account_id;
  const token = fields.api_token || fields.api_key;
  if (!accountId || !token) {
    throw new HttpError(
      400,
      `The '${row.provider_key}' connection is missing account_id or api_token.`
    );
  }
  return { row, accountId, token, fields };
}

// ------------------------------------------------------------------
// Per-type Cloudflare API shapes (path suffix, list/create/delete mapping,
// row normalization for the frontend table). listPath derives from basePath
// — R2/D1/KV paginate with per_page=100; Vectorize returns everything. The
// create + delete URLs always use basePath so query strings never leak into
// the resource id segment.
// ------------------------------------------------------------------
const TYPES = {
  vector_index: {
    label: "Vector Index",
    basePath: (a) => `/accounts/${a}/vectorize/v2/indexes`,
    listPath: (a) => `/accounts/${a}/vectorize/v2/indexes`,
    normalize: (r) => ({
      id: r.name,
      name: r.name,
      dimensions: r.config?.dimensions ?? null,
      metric: r.config?.metric ?? null,
      vectorCount: r.vector_count ?? null,
      createdAt: r.created_on ?? null,
    }),
    createBody: (name, config = {}) => ({
      name,
      description: config.description || "Created from the admin portal",
      config: {
        dimensions: Number(config.dimensions) || 768,
        metric: config.metric || "cosine",
      },
    }),
  },
  object_bucket: {
    label: "R2 Bucket",
    basePath: (a) => `/accounts/${a}/r2/buckets`,
    listPath: (a) => `/accounts/${a}/r2/buckets?per_page=100`,
    normalize: (r) => ({
      id: r.name,
      name: r.name,
      location: r.location ?? null,
      createdAt: r.creation_date ?? null,
    }),
    createBody: (name, config = {}) =>
      config.locationHint ? { name, location_hint: config.locationHint } : { name },
  },
  sql_database: {
    label: "D1 Database",
    basePath: (a) => `/accounts/${a}/d1/database`,
    listPath: (a) => `/accounts/${a}/d1/database?per_page=100`,
    normalize: (r) => ({
      id: r.uuid,
      name: r.name,
      uuid: r.uuid,
      version: r.version ?? null,
      numTables: r.num_tables ?? null,
      region: r.running_in_region ?? null,
      createdAt: r.created_at ?? null,
    }),
    createBody: (name, config = {}) =>
      config.locationHint ? { name, primary_location_hint: config.locationHint } : { name },
  },
  kv_namespace: {
    label: "KV Namespace",
    basePath: (a) => `/accounts/${a}/storage/kv/namespaces`,
    listPath: (a) => `/accounts/${a}/storage/kv/namespaces?per_page=100`,
    normalize: (r) => ({
      id: r.id,
      name: r.title,
      title: r.title,
      supportsUrlEncoding: r.supports_url_encoding ?? null,
      createdAt: null,
    }),
    createBody: (name) => ({ title: name }),
  },
};

/** Find the type config or 400. */
function typeConfig(type) {
  const t = TYPES[type];
  if (!t) {
    throw new HttpError(400, `Unknown resource type '${type}'. Expected one of: ${Object.keys(TYPES).join(", ")}.`);
  }
  return t;
}

/** Validate a resource name (shared RESOURCE_NAME_RE: lowercase letters,
 * digits, hyphens, underscores, 3–63 chars — same rule the portal uses). */
function validateName(name) {
  if (typeof name !== "string" || !RESOURCE_NAME_RE.test(name.trim())) {
    throw new HttpError(400, "Resource name must be 3–63 chars: lowercase letters, numbers, hyphens, underscores.");
  }
  return name.trim();
}

/** Shared company + credential resolution for every route below. */
async function resolveContext(req) {
  const company = await CompanyRepository.findByKey(req.params.key);
  if (!company) {
    throw new HttpError(404, `Company '${req.params.key}' not found.`);
  }
  const type = req.params.type;
  const { row, accountId, token } = await resolveCfCredential(
    company,
    req.body?.providerKey || "cloudflare",
    type
  );
  return { company, credential: row, accountId, token };
}

// GET /gateway/companies/:key/cloudflare/resources/:type
router.get(
  "/companies/:key/cloudflare/resources/:type",
  wrap(async (req, res) => {
    const t = typeConfig(req.params.type);
    const { company, credential, accountId, token } = await resolveContext(req);
    const data = await cfFetch(token, t.listPath(accountId));
    const items = extractItems(data);
    return res.json({
      success: true,
      companyKey: company.company_key,
      credentialKey: credential.credential_key,
      type: req.params.type,
      resources: items.map(t.normalize),
    });
  })
);

/** Pull the resource array out of a Cloudflare list response (some types wrap
 *  it under .result.buckets, others return it flat under .result). */
function extractItems(data) {
  const list = data?.result || [];
  return Array.isArray(list) ? list : Array.isArray(list?.buckets) ? list.buckets : [];
}

/**
 * Live list of a Cloudflare resource type for a company (shared with the KB
 * options endpoint so config selectors see the real account resources). Uses
 * the same type-aware credential resolution as the routes. Throws when the
 * company has no usable Cloudflare connection — callers catch and degrade.
 * @param {object} company  gateway company row ({ id, company_key })
 * @param {string} type     vector_index | object_bucket | sql_database | kv_namespace
 * @returns {Promise<Array<object>>} normalized resource rows ({ id, name, … })
 */
export async function listLiveCloudflareResources(company, type) {
  const t = typeConfig(type);
  const { accountId, token } = await resolveCfCredential(company, "cloudflare", type);
  const data = await cfFetch(token, t.listPath(accountId));
  return extractItems(data).map(t.normalize);
}

// POST /gateway/companies/:key/cloudflare/resources/:type
// Body: { name, providerKey?, config? } — config carries type-specific create
// options (dimensions/metric, locationHint, description).
router.post(
  "/companies/:key/cloudflare/resources/:type",
  wrap(async (req, res) => {
    const t = typeConfig(req.params.type);
    const name = validateName(req.body?.name);
    const { company, credential, accountId, token } = await resolveContext(req);
    const data = await cfFetch(token, t.listPath(accountId));
    const list = data?.result || [];
    const items = Array.isArray(list) ? list : Array.isArray(list?.buckets) ? list.buckets : [];
    if (items.some((r) => (t.normalize(r).name) === name)) {
      throw new HttpError(409, `A ${t.label.toLowerCase()} named '${name}' already exists.`);
    }
    const created = await cfFetch(token, t.basePath(accountId), {
      method: "POST",
      body: t.createBody(name, req.body?.config || {}),
    });
    const row = created?.result || {};
    await AuditRepository.log({
      companyId: company.id,
      ...actorFromReq(req),
      action: "cloudflare_resource.created",
      entityType: "cloudflare_resource",
      entityId: null,
      afterState: { type: req.params.type, name, provider_key: credential.provider_key },
      reason: "admin action (live Cloudflare resource)",
    });
    return res.status(201).json({
      success: true,
      message: `${t.label} '${name}' created.`,
      resource: t.normalize(row),
    });
  })
);

// DELETE /gateway/companies/:key/cloudflare/resources/:type/:id
// :id is the resource's name (vector/bucket) or uuid (d1/kv).
router.delete(
  "/companies/:key/cloudflare/resources/:type/:id",
  wrap(async (req, res) => {
    const t = typeConfig(req.params.type);
    const { company, credential, accountId, token } = await resolveContext(req);
    await cfFetch(token, `${t.basePath(accountId)}/${encodeURIComponent(req.params.id)}`, {
      method: "DELETE",
    });
    await AuditRepository.log({
      companyId: company.id,
      ...actorFromReq(req),
      action: "cloudflare_resource.deleted",
      entityType: "cloudflare_resource",
      entityId: null,
      afterState: { type: req.params.type, id: req.params.id, provider_key: credential.provider_key },
      reason: "admin action (live Cloudflare resource)",
    });
    return res.json({
      success: true,
      message: `${t.label} '${req.params.id}' deleted.`,
    });
  })
);

export default router;
