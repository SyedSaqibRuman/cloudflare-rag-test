// --------------------------
// VECTOR RESOURCES ROUTER (live CRUD for the non-Cloudflare vector databases)
// Mirrors cloudflare-resources.js for the Qdrant / Pinecone / Weaviate family:
// unlike /companies/:key/resources (registry rows only), these endpoints talk
// to the ACTUAL vector store through the company's saved gateway connection —
// a Qdrant collection, a Pinecone index, or a Weaviate class.
//
// Creating an index also REGISTERS it (a provider_resources row of type
// vector_index bound to the same credential), so the new store is immediately
// selectable in the KB wizard / Config page — the live name is written to
// external_resource_id and to the config key the resolvers look for
// (collection_name / class_name / index_name, see ingest/resolve.js).
// Deleting drops the live index first, then soft-deletes the registry rows so
// a failed provider call never orphans the binding.
//
// Credentials come from the company's ACTIVE credential for that provider
// (host + api_key, see migrations 025/026) — never from process.env.
// --------------------------
import express from "express";
import {
  CompanyRepository,
  CredentialRepository,
  ResourceRepository,
  AuditRepository,
} from "../repositories.js";
import * as CredentialService from "../services/credential-service.js";
import { createVectorAdapter } from "../adapters/vector/factory.js";
import { clearRagResource } from "../services/rag-sync.js";
import { wrap } from "./helpers.js";
import { VECTOR_RESOURCE_NAME_RES } from "../../shared/patterns.js";
import { assertResourceNotKbBound } from "./shared-helpers.js";
import { actorFromReq } from "./shared-helpers.js";

const router = express.Router();

// Providers whose indexes can be created/listed/deleted live from the portal.
const VECTOR_PROVIDERS = ["pinecone", "qdrant", "weaviate"];

// Per-provider display + validation copy (the portal card mirrors these).
const PROVIDER_META = {
  pinecone: {
    label: "Pinecone Index",
    nameHint: "lowercase letters, digits and hyphens (1–45 chars, must start/end alphanumeric)",
  },
  qdrant: {
    label: "Qdrant Collection",
    nameHint: "letters, digits, underscores, hyphens and dots (2–63 chars)",
  },
  weaviate: {
    label: "Weaviate Class",
    nameHint: "must start with an uppercase letter; letters, digits and underscores only",
  },
};

// provider → the config key holding the store's name. The ingest/query
// resolvers read these (ingest/resolve.js configIndexName, kb-retrieval.js
// vectorIndexMatchesKb), so registering under the right key is what makes a
// portal-created store bindable to a KB.
const NAME_CONFIG_KEY = {
  pinecone: "index_name",
  qdrant: "collection_name",
  weaviate: "class_name",
};

/** Fail an HTTP request with a message + status (handled by `wrap`). */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Validate + normalize the :provider path segment. */
function providerFromParam(raw) {
  const providerKey = String(raw || "").toLowerCase();
  if (!VECTOR_PROVIDERS.includes(providerKey)) {
    throw new HttpError(
      400,
      `Unknown vector provider '${raw}'. Expected one of: ${VECTOR_PROVIDERS.join(", ")}.`
    );
  }
  return providerKey;
}

/** Validate a store name against the provider's own naming rules. */
function validateName(providerKey, name) {
  const value = typeof name === "string" ? name.trim() : "";
  const re = VECTOR_RESOURCE_NAME_RES[providerKey];
  if (!value || !re?.test(value)) {
    throw new HttpError(
      400,
      `${PROVIDER_META[providerKey].label} name must be ${PROVIDER_META[providerKey].nameHint}.`
    );
  }
  return value;
}

/** Slugs a store name into the resource_key charset (/^[a-z0-9-]+$/). */
const resourceSlug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Pick the company's active credential for a vector provider and build its
 * adapter. Throws 404 when no connection exists, 500 on an undecryptable blob.
 */
async function resolveContext(req, providerKey) {
  const company = await CompanyRepository.findByKey(req.params.key);
  if (!company) {
    throw new HttpError(404, `Company '${req.params.key}' not found.`);
  }
  const rows = await CredentialRepository.listByCompany(company.id, { includeStored: true });
  const row = (rows || []).filter((r) => r && r.is_active).find((r) => r.provider_key === providerKey);
  if (!row) {
    throw new HttpError(
      404,
      `No active ${providerKey} connection for company '${company.company_key}'. Add one on the Connections card first.`
    );
  }
  let fields;
  try {
    fields = CredentialService.decryptCredential(row.encrypted_credentials);
  } catch (err) {
    throw new HttpError(500, `Could not decrypt the ${providerKey} credential: ${err.message}`);
  }
  let adapter;
  try {
    adapter = createVectorAdapter(providerKey, { ...fields, companyName: company.company_key });
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  return { company, credential: row, fields, adapter };
}

/**
 * Register a live index as a provider_resources row so KBs can bind it.
 * Idempotent: an existing row for the same external id is reused. resource_key
 * is provider-prefixed + slugified (dodges cross-provider collisions) and
 * retried with a numeric suffix if the per-company uniqueness key rejects it.
 * @returns {Promise<number|null>} the resource id, or null when registration failed
 */
async function registerVectorResource(company, credential, { providerKey, name, config }) {
  const existing = await ResourceRepository.findByExternalId(company.id, name, "vector_index");
  if (existing) return existing.id;

  const base = `${providerKey}-${resourceSlug(name)}`.slice(0, 63);
  for (let attempt = 0; attempt < 5; attempt++) {
    const resourceKey = attempt === 0 ? base : `${base.slice(0, 60)}-${attempt + 1}`;
    try {
      return await ResourceRepository.create(company.id, {
        credentialId: credential.id,
        providerId: credential.provider_id,
        resourceType: "vector_index",
        resourceKey,
        resourceName: name,
        externalResourceId: name,
        description: `Live ${PROVIDER_META[providerKey].label} created from the Providers page`,
        config: { ...config, [NAME_CONFIG_KEY[providerKey]]: name },
        status: "active",
      });
    } catch (err) {
      if (err?.code !== "ER_DUP_ENTRY") throw err;
    }
  }
  return null;
}


// GET /gateway/companies/:key/vector/resources/:provider
// Live list of the store's indexes / collections / classes.
router.get(
  "/companies/:key/vector/resources/:provider",
  wrap(async (req, res) => {
    const providerKey = providerFromParam(req.params.provider);
    const { company, credential, adapter } = await resolveContext(req, providerKey);
    let resources;
    try {
      resources = await adapter.listIndexes();
    } catch (err) {
      // Always 502 (bad gateway) for upstream provider failures — deliberately
      // NOT the upstream status: a 401/403 from the vector store must never
      // collide with the admin-session 401 the portal treats as "logged out".
      throw new HttpError(502, err.message);
    }
    return res.json({
      success: true,
      companyKey: company.company_key,
      credentialKey: credential.credential_key,
      providerKey,
      resources,
    });
  })
);

// POST /gateway/companies/:key/vector/resources/:provider
// Body: { name, config? } — config carries the type-specific create options
// (dimensions/metric/cloud/region for Pinecone, dimensions/distance for
// Qdrant, vectorizer for Weaviate).
router.post(
  "/companies/:key/vector/resources/:provider",
  wrap(async (req, res) => {
    const providerKey = providerFromParam(req.params.provider);
    const name = validateName(providerKey, req.body?.name);
    const { company, credential, adapter } = await resolveContext(req, providerKey);
    const config = req.body?.config && typeof req.body.config === "object" ? req.body.config : {};

    // Pre-check existence (same as the Cloudflare routes) so an existing store
    // answers 409 with a clear message instead of the provider's own error.
    let live;
    try {
      live = await adapter.listIndexes();
    } catch (err) {
      throw new HttpError(502, err.message);
    }
    if (live.some((r) => r.name === name)) {
      throw new HttpError(409, `${PROVIDER_META[providerKey].label} '${name}' already exists.`);
    }

    let row;
    try {
      row = await adapter.createIndex({ name, ...config });
    } catch (err) {
      throw new HttpError(502, err.message);
    }

    // Registration is best-effort — the live index exists either way, and the
    // generic Resources card can still register it manually.
    let resourceId = null;
    try {
      resourceId = await registerVectorResource(company, credential, { providerKey, name, config });
    } catch (err) {
      console.warn(`⚠️ Could not register live ${providerKey} resource '${name}': ${err.message}`);
    }

    await AuditRepository.log({
      companyId: company.id,
      ...actorFromReq(req),
      action: "vector_resource.created",
      entityType: "vector_resource",
      entityId: resourceId,
      afterState: { providerKey, name, credential_key: credential.credential_key, resource_id: resourceId },
      reason: "admin action (live vector store resource)",
    });
    return res.status(201).json({
      success: true,
      message: `${PROVIDER_META[providerKey].label} '${name}' created.`,
      resource: row,
      resourceId,
    });
  })
);

// DELETE /gateway/companies/:key/vector/resources/:provider/:name
// Drops the live index, then soft-deletes the registry rows bound to it.
router.delete(
  "/companies/:key/vector/resources/:provider/:name",
  wrap(async (req, res) => {
    const providerKey = providerFromParam(req.params.provider);
    const name = String(req.params.name || "").trim();
    if (!name) throw new HttpError(400, `${PROVIDER_META[providerKey].label} name is required.`);

    const { company, credential, adapter } = await resolveContext(req, providerKey);

    // KB-binding guard runs BEFORE the provider API call — a bound store must
    // stay intact (soft-deleting its registry rows under a live KB leaves the
    // stale-pointer "Vector store is not configured" breakage).
    const boundRows = (await ResourceRepository.listByCompany(company.id, { resourceType: "vector_index" })).filter(
      (r) => r.external_resource_id === name
    );
    for (const row of boundRows) {
      await assertResourceNotKbBound(row, PROVIDER_META[providerKey].label);
    }

    try {
      await adapter.deleteIndex(name);
    } catch (err) {
      throw new HttpError(502, err.message);
    }

    // Unregister the rows pointing at this external store (soft delete, same
    // semantics as DELETE /gateway/resources/:id).
    let unregistered = 0;
    for (const row of boundRows) {
      await ResourceRepository.remove(row.id);
      await clearRagResource(company.id, row);
      unregistered += 1;
    }

    await AuditRepository.log({
      companyId: company.id,
      ...actorFromReq(req),
      action: "vector_resource.deleted",
      entityType: "vector_resource",
      entityId: null,
      afterState: { providerKey, name, credential_key: credential.credential_key, unregistered },
      reason: "admin action (live vector store resource)",
    });
    return res.json({
      success: true,
      message: `${PROVIDER_META[providerKey].label} '${name}' deleted.`,
      unregistered,
    });
  })
);

export default router;
