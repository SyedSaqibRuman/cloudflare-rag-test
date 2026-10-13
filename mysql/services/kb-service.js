// --------------------------
// KB SERVICE
// Validation + transactional writes for tenant knowledge bases
// (knowledge_bases). Validation is pure and DB-free; all SQL lives in the
// repositories (D5). Writers throw errors carrying a `status` so the router
// can map them to 4xx. Mirrors catalog-service.js (F4 pattern).
// --------------------------
import {
  ModelRepository,
  ResourceRepository,
  KbRepository,
  AuditRepository,
  CredentialRepository,
} from "../repositories.js";
import { getCompanyConfig } from "../../config/index.js";
import { validateRestSourceConfig } from "../../ingest/sources/rest.js";

import { KB_SOURCE_TYPES, KB_ENABLED_SOURCE_TYPES, KB_DEFAULT_SOURCE_TYPE, isSourceTypeEnabled } from "../../shared/catalog-enums.js";
import { RESOURCE_NAME_RE } from "../../shared/patterns.js";
import { isVectorCapableProvider } from "../../shared/vector-capability.js";
import { probeEmbeddingModel } from "./embedding-probe.js";
import { findDefaultBinding } from "../../shared/default-bindings.js";
import { discoverSitemaps, SitemapError } from "../../ingest/sources/sitemap/index.js";

export const KB_KEY_RE = /^[a-z0-9-]+$/;
export const SOURCE_TYPES = KB_SOURCE_TYPES;

// Backward-compatible HttpError — extends AppError so the error handler
// middleware recognizes it and the test suite's `instanceof HttpError` checks pass.
import { AppError } from "../../shared/errors.js";

export class HttpError extends AppError {
  constructor(status, message) {
    super(message, status);
  }
}

// ------------------------------------------------------------------
// KB VALIDATION (pure, DB-free)
// ------------------------------------------------------------------

function isPosInt(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * Validate KB input. Normalizes defaults for optional fields.
 * @param {Object} input
 * @param {Object} [opts]
 * @param {string} [opts.currentSourceType] - the row's ALREADY-STORED
 *   source_type (set by `updateKb`). A withdrawn source type is tolerated when
 *   it is this unchanged value, so editing a legacy WordPress/custom KB stays
 *   possible without letting anybody switch a KB ONTO a withdrawn source.
 * @returns {{ ok: boolean, value?: Object, errors?: Object<string,string> }}
 */
/**
 * Normalize webhook events to a JSON-safe format.
 * Accepts: comma-separated string, JSON array, or null.
 * Returns: JSON array string (for JSON column) or null.
 */
function normalizeWebhookEvents(value) {
  if (!value) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "string") {
    const events = value.split(",").map((e) => e.trim()).filter(Boolean);
    return events.length > 0 ? JSON.stringify(events) : null;
  }
  return null;
}

export function validateKbInput(input = {}, opts = {}) {
  const errors = {};

  if (!input.kbKey?.trim()) {
    errors.kbKey = "kbKey is required.";
  } else if (!KB_KEY_RE.test(input.kbKey)) {
    errors.kbKey = "kbKey must match /^[a-z0-9-]+$/.";
  } else if (input.kbKey.length < 3 || input.kbKey.length > 63) {
    errors.kbKey = "kbKey must be 3-63 characters.";
  }

  if (!input.kbName?.trim()) {
    errors.kbName = "kbName is required.";
  } else if (input.kbName.trim().length > 200) {
    errors.kbName = "kbName must be at most 200 characters.";
  }

  if (input.description !== undefined && input.description !== null && input.description.length > 65535) {
    errors.description = "description must be at most 65535 characters.";
  }

  for (const field of ["vectorResourceId", "storageResourceId", "graphResourceId", "embeddingModelId"]) {
    const v = input[field];
    if (v !== undefined && v !== null && v !== "" && !isPosInt(Number(v))) {
      errors[field] = `${field} must be a positive integer when set.`;
    }
  }

  // External resource names (live Cloudflare resources) — validated against
  // RESOURCE_NAME_RE when set; mutually exclusive with the numeric id for
  // the same resource type.
  for (const field of ["vectorExternalId", "storageExternalId"]) {
    const v = input[field];
    if (v !== undefined && v !== null && v !== "") {
      if (typeof v !== "string" || !RESOURCE_NAME_RE.test(v)) {
        errors[field] = `${field} must be a lowercase resource name (3-63 chars: letters, digits, hyphens, underscores).`;
      }
    }
  }

  const chunkSize = input.chunkSize ?? 512;
  if (input.chunkSize !== undefined && input.chunkSize !== null && !Number.isInteger(Number(input.chunkSize))) {
    errors.chunkSize = "chunkSize must be an integer.";
  } else if (Number(chunkSize) < 1 || Number(chunkSize) > 10000) {
    errors.chunkSize = "chunkSize must be 1-10000.";
  }

  const chunkOverlap = input.chunkOverlap ?? 50;
  if (input.chunkOverlap !== undefined && input.chunkOverlap !== null && !Number.isInteger(Number(input.chunkOverlap))) {
    errors.chunkOverlap = "chunkOverlap must be an integer.";
  } else if (Number(chunkOverlap) < 0 || Number(chunkOverlap) >= Number(chunkSize)) {
    errors.chunkOverlap = "chunkOverlap must be 0..(chunkSize-1).";
  }

  const retrievalTopK = input.retrievalTopK ?? 10;
  if (input.retrievalTopK !== undefined && input.retrievalTopK !== null && !Number.isInteger(Number(input.retrievalTopK))) {
    errors.retrievalTopK = "retrievalTopK must be an integer.";
  } else if (Number(retrievalTopK) < 1 || Number(retrievalTopK) > 100) {
    errors.retrievalTopK = "retrievalTopK must be 1-100.";
  }

  const threshold = input.retrievalScoreThreshold ?? 0.7;
  if (input.retrievalScoreThreshold !== undefined && input.retrievalScoreThreshold !== null) {
    const n = Number(threshold);
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) {
      errors.retrievalScoreThreshold = "retrievalScoreThreshold must be a number 0-1.";
    }
  }

  // Source type resolution order: explicit input → the row's already-stored
  // value (the updateKb merge) → the first OFFERED type. The `??` chain means a
  // caller that omits sourceType on an update inherits the stored one instead
  // of being silently migrated to the default.
  const sourceType = input.sourceType ?? opts.currentSourceType ?? KB_DEFAULT_SOURCE_TYPE;

  // REST (custom) source validation — reject bad configs at save time so an
  // ingest never discovers them mid-run. Pure function, no I/O. The
  // "needs a rest block" nag is gated on the type still being selectable, so a
  // withdrawn `custom` reports ONE actionable error (sourceType) rather than two.
  if ((sourceType === "custom" || input.rest) && input.sourceConfig?.rest) {
    const check = validateRestSourceConfig(input.sourceConfig.rest);
    if (!check.ok) {
      errors.sourceConfig = `Invalid rest source_config: ${check.errors.join(" ")}`;
    }
  } else if (sourceType === "custom" && isSourceTypeEnabled(sourceType) && input.sourceConfig && !input.sourceConfig.rest) {
    errors.sourceConfig =
      'source_type "custom" requires a "rest" block in source_config ' +
      '(e.g. { "rest": { "endpoint": "https://api.example.com/items?page={page}" } }).';
  }
  if (sourceType && !SOURCE_TYPES.includes(sourceType)) {
    errors.sourceType = `sourceType must be one of: ${KB_ENABLED_SOURCE_TYPES.join(", ")}.`;
  } else if (!isSourceTypeEnabled(sourceType) && sourceType !== opts.currentSourceType) {
    // Withdrawn source (see KB_DISABLED_SOURCE_TYPES in shared/catalog-enums.js).
    // A KB that ALREADY uses it may still be re-saved unchanged (that is a no-op,
    // not a selection) — but nobody can point a KB at one.
    errors.sourceType =
      `sourceType '${sourceType}' is no longer available. ` +
      `Use one of: ${KB_ENABLED_SOURCE_TYPES.join(", ")}.`;
  }

  // URL source validation — same save-time principle as the custom-rest block
  // above: an unconfigured url source must fail the SAVE, not the ingest
  // (createSourceAdapter would otherwise throw mid-run). String sourceConfig
  // is skipped (legacy stored shape, parsed downstream).
  //
  // A `websiteUrl` alone is valid: the sitemap is discovered automatically at
  // ingest time, so the user never has to supply a sitemap URL.
  if (sourceType === "url" && (input.sourceConfig === undefined || input.sourceConfig === null || typeof input.sourceConfig === "object")) {
    const cfg = input.sourceConfig || {};
    const urls = Array.isArray(cfg.urls) ? cfg.urls.filter(Boolean) : [];
    const sitemapUrl = typeof cfg.sitemapUrl === "string" ? cfg.sitemapUrl.trim() : "";
    const websiteUrl = typeof cfg.websiteUrl === "string" ? cfg.websiteUrl.trim() : "";
    if (!urls.length && !sitemapUrl && !websiteUrl) {
      errors.sourceConfig =
        'source_type "url" requires a websiteUrl (the sitemap is discovered automatically), ' +
        'or at least one URL, or a sitemapUrl, in source_config ' +
        '(e.g. { "websiteUrl": "https://example.com" }).';
    } else if (cfg.maxUrls != null && (!Number.isInteger(Number(cfg.maxUrls)) || Number(cfg.maxUrls) < 1)) {
      errors.sourceConfig = "maxUrls must be a positive integer.";
    } else if (cfg.maxDepth != null && (!Number.isInteger(Number(cfg.maxDepth)) || Number(cfg.maxDepth) < 1)) {
      errors.sourceConfig = "maxDepth must be a positive integer.";
    }
  }

  // Per-KB graph extraction tuning (only meaningful when GraphRAG is on;
  // validated whenever present so bad values never reach the DB).
  const graphExtractMaxChunks = input.graphExtractMaxChunks ?? null;
  if (graphExtractMaxChunks !== null && graphExtractMaxChunks !== undefined) {
    const n = Number(graphExtractMaxChunks);
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      errors.graphExtractMaxChunks = "graphExtractMaxChunks must be an integer 1-50.";
    }
  }
  const graphExtractConcurrency = input.graphExtractConcurrency ?? null;
  if (graphExtractConcurrency !== null && graphExtractConcurrency !== undefined) {
    const n = Number(graphExtractConcurrency);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      errors.graphExtractConcurrency = "graphExtractConcurrency must be an integer 1-10.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      kbKey: input.kbKey.trim(),
      kbName: input.kbName.trim(),
      description: input.description?.trim() || null,
      vectorResourceId: input.vectorResourceId ? Number(input.vectorResourceId) : null,
      vectorExternalId: input.vectorExternalId || null,
      graphResourceId: input.graphResourceId ? Number(input.graphResourceId) : null,
      storageResourceId: input.storageResourceId ? Number(input.storageResourceId) : null,
      storageExternalId: input.storageExternalId || null,
      embeddingModelId: input.embeddingModelId ? Number(input.embeddingModelId) : null,
      chunkSize: Number(chunkSize),
      chunkOverlap: Number(chunkOverlap),
      retrievalTopK: Number(retrievalTopK),
      retrievalScoreThreshold: Number(threshold),
      enableGraphRag: Boolean(input.enableGraphRag),
      graphExtractMaxChunks: graphExtractMaxChunks != null ? Number(graphExtractMaxChunks) : null,
      graphExtractConcurrency: graphExtractConcurrency != null ? Number(graphExtractConcurrency) : null,
      enableHybridSearch: input.enableHybridSearch !== false,
      sourceType,
      sourceConfig: input.sourceConfig || null,
      webhookUrl: input.webhookUrl || null,
      webhookSecret: input.webhookSecret || null,
      webhookEvents: normalizeWebhookEvents(input.webhookEvents),
      isActive: input.isActive !== false,
    },
  };
}

// ------------------------------------------------------------------
// RESOURCE OWNERSHIP CHECK (shared by saveKb / updateKb)
// ------------------------------------------------------------------

/**
 * Verify a resource id resolves to a row owned by this company.
 * Vector bindings additionally require a vector-capable provider — a
 * storage-only resource (e.g. cloudflare_r2) would make every ingest fail
 * with "Unsupported vector provider" before doing any work.
 * @returns {Promise<null | { error: string }>} null when every id checks out.
 */
async function checkResourceOwnership(companyId, value) {
  for (const [field, resourceId, { mustBeVectorCapable = false } = {}] of [
    ["vectorResourceId", value.vectorResourceId, { mustBeVectorCapable: true }],
    ["storageResourceId", value.storageResourceId],
  ]) {
    if (!resourceId) continue;
    const resource = await ResourceRepository.findById(resourceId);
    if (!resource) return { error: `Unknown ${field} '${resourceId}'.` };
    if (Number(resource.company_id) !== Number(companyId)) {
      return { error: `${field} '${resourceId}' does not belong to this company.` };
    }
    if (mustBeVectorCapable && !isVectorCapableProvider(resource.provider_key)) {
      return {
        error:
          `${field} '${resourceId}' points to provider '${resource.provider_key}', which cannot store ` +
          `vectors. Pick a Cloudflare (Vectorize), Pinecone, Qdrant, Weaviate, or OpenAI index.`,
      };
    }
  }
  return null;
}

/**
 * Resolve external resource names (live Cloudflare resources) to numeric
 * provider_resources ids.  For each external id that is provided:
 *  1. If a numeric id was also provided for that type, it wins (explicit id >
 *     name resolution).
 *  2. Otherwise, look up an existing provider_resources row with matching
 *     external_resource_id owned by this company.
 *  3. If no row exists, auto-provision one so downstream code (ingestion,
 *     display JOINs) can bind to it.
 *
 * Mutates `value` in place, setting vectorResourceId / storageResourceId.
 * @param {number} companyId
 * @param {object} value  (from validateKbInput)
 * @returns {Promise<{ error: string } | null>} null on success
 */
async function resolveExternalResources(companyId, value) {
  const PAIRS = [
    ["vectorExternalId", "vectorResourceId", "vector_index"],
    ["storageExternalId", "storageResourceId", "object_bucket"],
  ];

  for (const [extField, idField, resourceType] of PAIRS) {
    const extName = value[extField];
    if (!extName) continue;
    // When an external name is explicitly provided, clear any inherited numeric
    // id so resolution runs.  An explicit numeric id from the caller (not from
    // the existing-row merge) would have been validated as a string in the
    // frontend and sent as vectorResourceId, not vectorExternalId.
    value[idField] = null;

    // 1. Try to find an existing provider_resources row with this external id.
    let resource = await ResourceRepository.findByExternalId(companyId, extName, resourceType);

    // 2. Auto-provision a lightweight row so the KB has something to bind to.
    if (!resource) {
      // Find any active Cloudflare credential to attach the resource under.
      const creds = await CredentialRepository.listByCompany(companyId, { includeStored: true });
      const cfCreds = (creds || []).filter((c) => c && c.is_active && c.provider_key?.startsWith("cloudflare"));
      if (cfCreds.length === 0) {
        return { error: `No active Cloudflare connection for '${extField}'. Add one on the Connections card first.` };
      }
      const cred = cfCreds[0];
      const resourceId = await ResourceRepository.create(companyId, {
        credentialId: cred.id,
        providerId: cred.provider_id,
        resourceType,
        resourceKey: extName,
        resourceName: extName,
        externalResourceId: extName,
        status: "active",
      });
      resource = { id: resourceId, company_id: companyId };
    }

    value[idField] = Number(resource.id);
  }
  return null;
}

/**
 * DEFAULT-BINDING RESOLUTION (create/edit-time auto-bind).
 *
 * When a KB is saved with NO explicit Vector Store / Document Storage binding
 * (vectorResourceId / vectorExternalId / storageResourceId / storageExternalId
 * all absent — the wizard's "Company default (config)" path), resolve the
 * company's configured defaults (config VECTOR_INDEX / R2_BUCKET_NAME) against
 * the company's provisioned provider_resources rows and bind the matching ones.
 *
 * The config value may hold either the resource's `resource_key` (what the
 * Config page dropdown writes for registry rows) or the raw `external_resource_id`
 * (what live Cloudflare selectors write) — both are matched.
 *
 * Vector candidates from storage-only providers are skipped (never auto-bind a
 * binding that ingestion would immediately reject). A missing config value or a
 * non-matching resource simply leaves the field null — no error: "company
 * default" stays a best-effort convenience, never a hard requirement.
 *
 * @param {number} companyId      company.id
 * @param {string} companyKey     company.company_key (config lookup key)
 * @param {Object} value          validateKbInput result — mutated in place
 * @param {Object} [deps]         injectable repos for tests
 * @returns {Promise<{ vectorBound: boolean, storageBound: boolean }>}
 */
export async function applyDefaultResourceBindings(companyId, companyKey, value, deps = {}) {
  const resourceRepo = deps.resourceRepo ?? ResourceRepository;
  const getConfig = deps.getConfig ?? getCompanyConfig;

  // Only fill fields the caller left empty — explicit bindings always win.
  const needVector = !value.vectorResourceId && !value.vectorExternalId;
  const needStorage = !value.storageResourceId && !value.storageExternalId;
  if (!needVector && !needStorage) return { vectorBound: false, storageBound: false };

  const cfg = getConfig(companyKey) || {};
  const wantVector = needVector ? (cfg.VECTOR_INDEX || "").trim() : "";
  const wantStorage = needStorage ? (cfg.R2_BUCKET_NAME || "").trim() : "";
  if (!wantVector && !wantStorage) return { vectorBound: false, storageBound: false };

  let resources = [];
  try {
    resources = (await resourceRepo.listByCompany(companyId)) || [];
  } catch {
    return { vectorBound: false, storageBound: false }; // best-effort
  }

  // Config name → resource row (shared matcher: resource_key OR
  // external_resource_id; vector side skips non-capable providers).
  if (needVector && wantVector) {
    const match = findDefaultBinding(resources, wantVector, "vector_index", { requireVectorCapable: true });
    if (match) {
      value.vectorResourceId = Number(match.id);
      value.vectorExternalId = null; // id binding wins; external stays derived
    }
  }
  if (needStorage && wantStorage) {
    const match = findDefaultBinding(resources, wantStorage, "object_bucket");
    if (match) {
      value.storageResourceId = Number(match.id);
      value.storageExternalId = null;
    }
  }

  return {
    vectorBound: Boolean(value.vectorResourceId),
    storageBound: Boolean(value.storageResourceId),
  };
}

/** Snapshot the embedding provider key for the row (denormalized column). */
async function resolveEmbeddingProvider(embeddingModelId) {
  if (!embeddingModelId) return null;
  const model = await ModelRepository.findById(embeddingModelId);
  if (!model) throw new HttpError(404, `Unknown embeddingModelId '${embeddingModelId}'.`);
  return model.provider_key;
}

/**
 * Save-time sitemap resolution for website-source KBs (sourceType "url" with
 * a websiteUrl and no explicit sitemap): run robots.txt discovery NOW so the
 * KB row stores the resolved sitemap and creation fails fast with a clear 400
 * when the site exposes none — instead of the first ingest discovering the
 * problem. Success stamps `sitemapUrl` (+ `sitemapResolvedAt` diagnostics)
 * into sourceConfig; ingest reuses the stored value and skips discovery.
 * Discovery is best-effort-cheap: robots fetch + fallbacks + a shallow crawl
 * capped at 20 URLs just to pin the root sitemap.
 * @param {Object} value  validated KB input (mutated in place)
 * @param {Function} [discoverFn]  test seam — replaces discoverSitemaps
 * @returns {Promise<void>}
 * @throws {HttpError} 502 when the website exposes no sitemap (robots.txt +
 *   standard fallback locations all came up empty)
 */
async function resolveWebsiteSitemap(value, discoverFn = discoverSitemaps) {
  const cfg = value.sourceConfig;
  if (
    value.sourceType !== "url" ||
    !cfg ||
    typeof cfg !== "object" ||
    !cfg.websiteUrl ||
    (typeof cfg.sitemapUrl === "string" && cfg.sitemapUrl.trim())
  ) {
    return; // not a website-only config, or the sitemap is already explicit
  }
  try {
    const result = await discoverFn(cfg.websiteUrl, { limits: { maxUrls: 20 } });
    const sitemapUrl = result?.discoveredSitemaps?.[0] || null;
    if (!sitemapUrl) {
      throw new HttpError(
        502,
        `Could not find a sitemap for '${cfg.websiteUrl}'. The site exposes none via robots.txt ` +
          "or the standard locations (/sitemap.xml, /sitemap_index.xml, /wp-sitemap.xml)."
      );
    }
    value.sourceConfig = { ...cfg, sitemapUrl, sitemapResolvedAt: new Date().toISOString() };
  } catch (err) {
    // SitemapError carries the §31 user-facing copy (no sitemap found / bad
    // website URL) — definitive, so reject the save with it. UNEXPECTED
    // internal errors fail OPEN (same philosophy as the embedding probe):
    // log and save without the sitemap; ingest re-runs discovery.
    if (err instanceof SitemapError) {
      throw new HttpError(err.status === 400 ? 400 : 502, err.message);
    }
    if (err instanceof HttpError) throw err;
    console.error(`⚠️ Sitemap discovery failed for '${cfg.websiteUrl}' — saving without a resolved sitemap: ${err.message}`);
  }
}

/**
 * Bind-time validation for a KB's embedding model: probe the provider's
 * embeddings endpoint with ONE live test embed through the same resolution the
 * ingest path uses. Definitive failures (model 404, bad key, unsupported
 * provider, missing credential) reject the save with a clear 400; transient
 * provider outages (5xx/network) fail OPEN so an outage can't brick KB
 * configuration (the per-run fallback counters + KB-detail warning card cover
 * the runtime signal).
 * @param {number|string|null} embeddingModelId
 * @param {string} companyKey   for error messages / probe context
 * @param {number} companyId
 * @param {Function} [probeFn]  test seam — defaults to the real live probe
 */
async function probeOrThrow(embeddingModelId, companyKey, companyId, probeFn = probeEmbeddingModel) {
  if (!embeddingModelId) return;
  const probe = await probeFn({ companyId, embeddingModelId: Number(embeddingModelId) });
  if (probe.ok && !probe.skipped) return; // healthy binding
  if (probe.ok) {
    // Transient outage — allow, but say so in the logs (visible signal).
    console.warn(`⚠️ KB embedding probe inconclusive for ${companyKey} (${probe.reason}: ${probe.detail ?? ""}) — binding allowed`);
    return;
  }
  const err = new HttpError(
    400,
    `Embedding model probe failed (${probe.providerKey ?? "?"}/${probe.modelKey ?? "?"}: ${probe.reason}) — ${probe.detail ?? "the provider rejected the test embed"}. Fix or remove the embedding model binding before saving.`
  );
  // Structured verdict rides along so the routes layer can expose it and the
  // portal can decode it into actionable UI (banner on the KB modal).
  err.probe = probe;
  throw err;
}

// ------------------------------------------------------------------
// KB WRITERS
// ------------------------------------------------------------------

/**
 * Create a KB for a company. Enforces the uk_company_kb uniqueness key and
 * the company's max_knowledge_bases capacity gate, then persists + audits.
 * @param {Object} company  CompanyRepository row (from requireGatewayCompany)
 * @param {Object} input
 * @param {Object} [actor]  actorType/actorId/actorIp for the audit trail
 * @param {Object} [opts]   test seams — `probe` replaces the live embedding probe
 * @returns {Promise<{kbId: number, kbKey: string}>}
 */
export async function saveKb(company, input, actor = {}, opts = {}) {
  const check = validateKbInput(input);
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const value = check.value;

  if (await KbRepository.findByKey(company.id, value.kbKey)) {
    throw new HttpError(409, `Knowledge base '${value.kbKey}' already exists.`);
  }

  const count = (await KbRepository.listByCompany(company.id)).length;
  if (company.max_knowledge_bases != null && count >= Number(company.max_knowledge_bases)) {
    throw new HttpError(409, `Company KB limit reached (${company.max_knowledge_bases}).`);
  }

  const extError = await resolveExternalResources(company.id, value);
  if (extError) throw new HttpError(400, extError.error);

  // "Company default" bindings → resolve config VECTOR_INDEX / R2_BUCKET_NAME
  // against provisioned resources so the KB never ships unbound by accident.
  await applyDefaultResourceBindings(company.id, company.company_key, value);

  const ownershipError = await checkResourceOwnership(company.id, value);
  if (ownershipError) throw new HttpError(400, ownershipError.error);

  const embeddingModelProvider = await resolveEmbeddingProvider(value.embeddingModelId);
  // Bind-time probe: a dead embedding model is rejected here, not discovered
  // from a failed ingest (root-cause fix for the NVIDIA embeddings papercut).
  await probeOrThrow(value.embeddingModelId, company.company_key, company.id, opts.probe);

  // Website-source KBs: resolve the sitemap from robots.txt NOW (save-time),
  // so the KB stores it and a sitemap-less site fails creation, not ingestion.
  await resolveWebsiteSitemap(value, opts.discoverSitemaps);

  const kbId = await KbRepository.create(company.id, { ...value, embeddingModelProvider });
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "kb.created",
    entityType: "kb",
    entityId: kbId,
    afterState: { kb_key: value.kbKey },
    reason: actor.reason ?? "admin action",
  });
  return { kbId, kbKey: value.kbKey };
}

/**
 * Update a KB (kbKey is not editable — it is the route identity). Re-validates
 * merged input, re-checks resource ownership, persists + audits before/after.
 * @param {Object} company
 * @param {string} kbKey
 * @param {Object} input
 * @param {Object} [actor]
 * @param {Object} [opts]   test seams — `probe` replaces the live embedding probe
 * @returns {Promise<{kbId: number, kbKey: string}>}
 */
export async function updateKb(company, kbKey, input, actor = {}, opts = {}) {
  const existing = await KbRepository.findByKey(company.id, kbKey);
  if (!existing) throw new HttpError(404, `Knowledge base '${kbKey}' not found.`);

  const merged = {
    ...existing,
    kbName: existing.kb_name,
    description: existing.description,
    vectorResourceId: existing.vector_resource_id,
    vectorExternalId: existing.vector_external_id ?? null,
    storageResourceId: existing.storage_resource_id,
    storageExternalId: existing.storage_external_id ?? null,
    embeddingModelId: existing.embedding_model_id,
    chunkSize: existing.chunk_size,
    chunkOverlap: existing.chunk_overlap,
    retrievalTopK: existing.retrieval_top_k,
    retrievalScoreThreshold: Number(existing.retrieval_score_threshold),
    enableGraphRag: Boolean(existing.enable_graph_rag),
    graphExtractMaxChunks: existing.graph_extract_max_chunks ?? null,
    graphExtractConcurrency: existing.graph_extract_concurrency ?? null,
    enableHybridSearch: Boolean(existing.enable_hybrid_search),
    // A NULL source_type row predates the wizard — resolve it to the current
    // default rather than the retired "wordpress".
    sourceType: existing.source_type || KB_DEFAULT_SOURCE_TYPE,
    sourceConfig: existing.source_config ?? null,
    webhookUrl: existing.webhook_url ?? null,
    webhookSecret: existing.webhook_secret ?? null,
    webhookEvents: existing.webhook_events ?? null,
    isActive: Boolean(existing.is_active),
    ...input,
  };
  merged.kbKey = existing.kb_key; // never editable

  // `currentSourceType` lets a KB that already uses a WITHDRAWN source type
  // (legacy WordPress / custom rows) be re-saved unchanged, while still
  // rejecting any attempt to move a KB ONTO one.
  const check = validateKbInput(merged, { currentSourceType: existing.source_type });
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const value = check.value;
  const extError = await resolveExternalResources(company.id, value);
  if (extError) throw new HttpError(400, extError.error);

  // "Company default" bindings → resolve config VECTOR_INDEX / R2_BUCKET_NAME
  // against provisioned resources (only fills fields the merged input leaves
  // empty — an existing explicit binding is preserved and never overridden).
  await applyDefaultResourceBindings(company.id, company.company_key, value);

  const ownershipError = await checkResourceOwnership(company.id, value);
  if (ownershipError) throw new HttpError(400, ownershipError.error);

  const embeddingModelProvider = await resolveEmbeddingProvider(value.embeddingModelId);
  // Only probe when the binding CHANGED — re-saving an unchanged (possibly
  // long-standing) binding shouldn't hard-fail because a provider wobbled.
  if (value.embeddingModelId !== existing.embedding_model_id) {
    await probeOrThrow(value.embeddingModelId, company.company_key, company.id, opts.probe);
  }

  // Website-source KBs: resolve the sitemap from robots.txt NOW (save-time)
  // when a websiteUrl was added/changed without an explicit sitemap.
  await resolveWebsiteSitemap(value, opts.discoverSitemaps);

  await KbRepository.update(existing.id, { ...value, embeddingModelProvider });
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "kb.updated",
    entityType: "kb",
    entityId: existing.id,
    beforeState: { kb_key: existing.kb_key, status: existing.status },
    // Secrets are never persisted into audit logs — record presence only.
    afterState: {
      kb_key: value.kbKey,
      ...value,
      webhookSecret: value.webhookSecret ? "[set]" : null,
    },
    reason: actor.reason ?? "admin action",
  });
  return { kbId: existing.id, kbKey: existing.kb_key };
}

/**
 * Hard-delete a KB (D10) + audit.
 * @param {Object} company
 * @param {string} kbKey
 * @param {Object} [actor]
 * @returns {Promise<void>}
 */
export async function removeKb(company, kbKey, actor = {}) {
  const existing = await KbRepository.findByKey(company.id, kbKey);
  if (!existing) throw new HttpError(404, `Knowledge base '${kbKey}' not found.`);

  await KbRepository.remove(existing.id);
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "kb.deleted",
    entityType: "kb",
    entityId: existing.id,
    afterState: { kb_key: existing.kb_key },
    reason: actor.reason ?? "admin action",
  });
}

// Neo4j I/O caps — same budget as ingest/graph-extract.js so a stalled graph
// can never hang an admin request.
const GRAPH_DELETE_QUERY_TIMEOUT_MS = 20_000;
const GRAPH_DELETE_CLOSE_TIMEOUT_MS = 10_000;

/**
 * Resolve a promise or reject after `ms` — graph I/O must never hang a request.
 * The losing promise keeps settling in the background; its rejection is
 * handled by Promise.race, so no unhandled rejections.
 */
function withGraphTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Delete a KB's entities + relationships from the Neo4j knowledge graph.
 * Uses the SAME graph connection the ingest pipeline resolves
 * (getGraphConfig → company NEO4J_* config), so the button always cleans
 * exactly what ingestion wrote. Best-effort like the rest of the graph
 * pipeline: an unreachable graph returns `graphReachable: false` instead of
 * failing the request, and the KB row itself is never touched.
 *
 * @param {Object} company
 * @param {string} kbKey
 * @returns {Promise<{ configured: boolean, graphReachable: boolean, nodesDeleted: number, relationshipsDeleted: number }>}
 */
export async function clearKbGraph(company, kbKey) {
  // Resolve the same connection ingest uses.
  const { getGraphConfig } = await import("../../query/graph.js");
  const graph = getGraphConfig(company.company_key);
  if (!graph) {
    return { configured: false, graphReachable: false, nodesDeleted: 0, relationshipsDeleted: 0 };
  }

  let nodesDeleted = 0;
  let relationshipsDeleted = 0;
  let reachable = false;

  try {
    const neo4j = await import("neo4j-driver");
    const driver = neo4j.default.driver(
      graph.uri,
      neo4j.default.auth.basic(graph.username, graph.password),
      { connectionTimeout: 10_000, disableLosslessIntegers: true }
    );
    try {
      const session = driver.session({
        database: graph.database || "neo4j",
        defaultAccessMode: neo4j.default.session.WRITE,
      });
      try {
        // Count first (for the message + audit), then delete.
        const countRes = await withGraphTimeout(
          session.run(
            "MATCH (e:Entity) WHERE e.kb_key = $kbKey " +
            "OPTIONAL MATCH (e)-[r]-(neighbor) " +
            "RETURN count(DISTINCT e) AS nodes, count(DISTINCT r) AS rels",
            { kbKey }
          ),
          GRAPH_DELETE_QUERY_TIMEOUT_MS,
          "Neo4j graph count"
        );
        const row = countRes.records[0];
        nodesDeleted = row ? Number(row.get("nodes")) : 0;
        relationshipsDeleted = row ? Number(row.get("rels")) : 0;
        reachable = true;

        if (nodesDeleted > 0) {
          await withGraphTimeout(
            session.run(
              "MATCH (e:Entity) WHERE e.kb_key = $kbKey DETACH DELETE e",
              { kbKey }
            ),
            GRAPH_DELETE_QUERY_TIMEOUT_MS,
            "Neo4j graph delete"
          );
        }
      } finally {
        await withGraphTimeout(session.close(), GRAPH_DELETE_CLOSE_TIMEOUT_MS, "Neo4j session.close").catch(() => {});
      }
    } finally {
      await withGraphTimeout(driver.close(), GRAPH_DELETE_CLOSE_TIMEOUT_MS, "Neo4j driver.close").catch(() => {});
    }
  } catch {
    // Unreachable/timeout — report honestly; the KB row is untouched.
    reachable = false;
  }

  return { configured: true, graphReachable: reachable, nodesDeleted, relationshipsDeleted };
}
