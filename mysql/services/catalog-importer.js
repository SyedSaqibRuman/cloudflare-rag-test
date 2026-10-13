// --------------------------
// PROVIDER CATALOG IMPORTER
// Imports a provider definition (JSON) into the global catalog tables —
// providers, provider_auth_schemas, provider_endpoints, provider_capabilities,
// provider_models (+ pricing), provider_resource_types — in one transaction.
//
// The JSON is the *import/seed format* only; MySQL is the runtime source of
// truth (the provider registry re-reads it after every import). Re-importing
// an existing provider refreshes its metadata (upserts) and never touches
// tenant credentials/resources.
//
// Accepted shapes (both are normalized to the same canonical form):
//   { provider: { key, name, category, website?, documentation? },
//     authentication: { fields: [...] },
//     endpoints: [...], capabilities: [...], models: [...], resources: [...] }
//   { providerKey, providerName, category, authFields: [...], ... }  (flat)
// --------------------------
import { getPool } from "../pool.js";
import { CatalogImportRepository } from "../repositories.js";

export const PROVIDER_CATEGORIES = [
  "ai",
  "embedding",
  "vector",
  "storage",
  "graph",
  "image",
  "speech",
  "search",
  "database",
  "email",
  "analytics",
];
export const PROVIDER_AUTH_TYPES = ["api_key", "bearer_token", "oauth2", "basic_auth", "custom"];
export const AUTH_FIELD_TYPES = [
  "text",
  "password",
  "textarea",
  "select",
  "url",
  "email",
  "numeric",
  "json",
  "file",
];
export const MODEL_CATEGORIES = ["chat", "embedding", "reranker", "image", "tts", "stt", "vision"];
export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];

const PROVIDER_KEY_RE = /^[a-z0-9_]+$/;
const ENDPOINT_KEY_RE = /^[a-z0-9-]+$/;
const RESOURCE_TYPES = [
  "vector_index",
  "object_bucket",
  "sql_database",
  "kv_namespace",
  "graph_database",
  "embedding_index",
  "search_index",
  "cache_namespace",
];

/** Error with an HTTP status — the router maps numeric `status` to the code. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isUrl(value) {
  if (!value) return true; // optional
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalize the two accepted JSON shapes into one canonical definition,
 * validating each section. Pure — no DB access, unit-testable.
 * @param {Object} def
 * @returns {{ ok: true, value: Object } | { ok: false, errors: Object<string,string> }}
 */
export function validateProviderDefinition(def = {}) {
  const errors = {};

  // --- provider base -------------------------------------------------------
  const wrapped = def.provider && typeof def.provider === "object" ? def.provider : def;
  const providerKey = wrapped.key || wrapped.providerKey || "";
  const providerName = wrapped.name || wrapped.providerName || "";
  const category = wrapped.category || "";

  if (!providerKey || !PROVIDER_KEY_RE.test(providerKey)) {
    errors.providerKey = `provider key is required and must match ${PROVIDER_KEY_RE}.`;
  } else if (providerKey.length < 3 || providerKey.length > 50) {
    errors.providerKey = "provider key must be 3-50 characters.";
  }
  if (!providerName || String(providerName).trim().length > 100) {
    errors.providerName = "provider name is required (max 100 chars).";
  }
  if (!category || !PROVIDER_CATEGORIES.includes(category)) {
    errors.category = `category must be one of ${PROVIDER_CATEGORIES.join(", ")}.`;
  }
  if (wrapped.authType && !PROVIDER_AUTH_TYPES.includes(wrapped.authType)) {
    errors.authType = `authType must be one of ${PROVIDER_AUTH_TYPES.join(", ")}.`;
  }
  for (const field of ["website", "websiteUrl", "documentation", "documentationUrl", "defaultApiBaseUrl", "logoUrl"]) {
    const v = wrapped[field];
    if (v !== undefined && v !== null && v !== "" && !isUrl(v)) {
      errors[field] = `${field} must be a valid URL.`;
    }
  }
  if (wrapped.apiKeyFormatRegex && String(wrapped.apiKeyFormatRegex).length > 500) {
    errors.apiKeyFormatRegex = "apiKeyFormatRegex is too long.";
  }

  // --- auth fields ---------------------------------------------------------
  const rawFields = def.authentication?.fields ?? def.authFields ?? def.authentication ?? [];
  const authFields = Array.isArray(rawFields) ? rawFields : [];
  if (!Array.isArray(rawFields)) {
    errors.authFields = "authentication.fields must be an array.";
  } else {
    authFields.forEach((f, i) => {
      const p = `authFields[${i}]`;
      if (!f.name || !/^[a-z0-9_]+$/.test(f.name)) {
        errors[`${p}.name`] = `${p} field name must match /^[a-z0-9_]+$/.`;
      }
      if (!f.label || String(f.label).length > 200) {
        errors[`${p}.label`] = `${p} field label is required (max 200 chars).`;
      }
      if (f.type && !AUTH_FIELD_TYPES.includes(f.type)) {
        errors[`${p}.type`] = `${p} field type must be one of ${AUTH_FIELD_TYPES.join(", ")}.`;
      }
      if (f.validationRegex && String(f.validationRegex).length > 500) {
        errors[`${p}.validationRegex`] = `${p} validationRegex is too long.`;
      }
      if (f.type === "select" && f.selectOptions !== undefined && !Array.isArray(f.selectOptions)) {
        errors[`${p}.selectOptions`] = `${p} selectOptions must be an array of { value, label }.`;
      }
    });
  }

  // --- endpoints -----------------------------------------------------------
  const endpoints = Array.isArray(def.endpoints) ? def.endpoints : [];
  if (def.endpoints !== undefined && !Array.isArray(def.endpoints)) {
    errors.endpoints = "endpoints must be an array.";
  }
  endpoints.forEach((e, i) => {
    const p = `endpoints[${i}]`;
    if (!e.key || !ENDPOINT_KEY_RE.test(e.key)) {
      errors[`${p}.key`] = `${p} endpoint key must match ${ENDPOINT_KEY_RE}.`;
    }
    if (!e.name || String(e.name).length > 100) {
      errors[`${p}.name`] = `${p} endpoint name is required (max 100 chars).`;
    }
    if (!e.url || !isUrl(e.url)) {
      errors[`${p}.url`] = `${p} endpoint url is required and must be a valid URL.`;
    }
    if (e.method && !HTTP_METHODS.includes(e.method)) {
      errors[`${p}.method`] = `${p} http method must be one of ${HTTP_METHODS.join(", ")}.`;
    }
    if (e.timeoutSeconds !== undefined && (!Number.isInteger(e.timeoutSeconds) || e.timeoutSeconds < 1 || e.timeoutSeconds > 3600)) {
      errors[`${p}.timeoutSeconds`] = `${p} timeoutSeconds must be an integer 1-3600.`;
    }
  });

  // --- capabilities --------------------------------------------------------
  const capabilities = Array.isArray(def.capabilities) ? def.capabilities : [];
  if (def.capabilities !== undefined && !Array.isArray(def.capabilities)) {
    errors.capabilities = "capabilities must be an array of keys or { key, supported?, config? }.";
  }
  capabilities.forEach((c, i) => {
    const key = typeof c === "string" ? c : c?.key;
    if (!key || !/^[a-z0-9_-]+$/.test(key)) {
      errors[`capabilities[${i}].key`] = `capabilities[${i}] must be a key matching /^[a-z0-9_-]+$/.`;
    }
  });

  // --- models + pricing ----------------------------------------------------
  const models = Array.isArray(def.models) ? def.models : [];
  if (def.models !== undefined && !Array.isArray(def.models)) {
    errors.models = "models must be an array.";
  }
  models.forEach((m, i) => {
    const p = `models[${i}]`;
    // Same charset as the config layer — vendor-prefixed IDs like
    // @cf/baai/bge-base-en-v1.5 carry @ / : and mixed case (moondream3.1-9B-A2B).
    if (!m.key || !/^[a-zA-Z0-9@][a-zA-Z0-9._:@/-]*$/.test(m.key)) {
      errors[`${p}.key`] = `${p} model key is required (e.g. gpt-4o, @cf/baai/bge-base-en-v1.5).`;
    }
    if (!m.name || String(m.name).length > 200) {
      errors[`${p}.name`] = `${p} model name is required (max 200 chars).`;
    }
    if (!m.category || !MODEL_CATEGORIES.includes(m.category)) {
      errors[`${p}.category`] = `${p} model category must be one of ${MODEL_CATEGORIES.join(", ")}.`;
    }
    if (m.pricing !== undefined && !Array.isArray(m.pricing)) {
      errors[`${p}.pricing`] = `${p} pricing must be an array.`;
    } else {
      (m.pricing || []).forEach((pr, j) => {
        const q = `${p}.pricing[${j}]`;
        if (pr.effectiveFrom !== undefined && !isDate(pr.effectiveFrom)) {
          errors[`${q}.effectiveFrom`] = `${q} effectiveFrom must be YYYY-MM-DD.`;
        }
        if (pr.effectiveTo !== undefined && pr.effectiveTo !== null && !isDate(pr.effectiveTo)) {
          errors[`${q}.effectiveTo`] = `${q} effectiveTo must be YYYY-MM-DD or null.`;
        }
      });
    }
  });

  // --- resources -----------------------------------------------------------
  const resources = Array.isArray(def.resources) ? def.resources : [];
  if (def.resources !== undefined && !Array.isArray(def.resources)) {
    errors.resources = "resources must be an array.";
  }
  resources.forEach((r, i) => {
    const p = `resources[${i}]`;
    if (!r.type || !RESOURCE_TYPES.includes(r.type)) {
      errors[`${p}.type`] = `${p} resource type must be one of ${RESOURCE_TYPES.join(", ")}.`;
    }
    if (r.displayName !== undefined && String(r.displayName).length > 100) {
      errors[`${p}.displayName`] = `${p} displayName must be at most 100 chars.`;
    }
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      providerKey,
      providerName: String(providerName).trim(),
      category,
      websiteUrl: wrapped.website ?? wrapped.websiteUrl ?? null,
      documentationUrl: wrapped.documentation ?? wrapped.documentationUrl ?? null,
      logoUrl: wrapped.logoUrl ?? null,
      defaultApiBaseUrl: wrapped.defaultApiBaseUrl ?? null,
      authType: wrapped.authType ?? "bearer_token",
      authHeaderName: wrapped.authHeaderName ?? "Authorization",
      apiKeyFormatRegex: wrapped.apiKeyFormatRegex ?? wrapped.apiKeyFormat ?? null,
      authFields: authFields.map((f, i) => ({
        fieldName: f.name,
        fieldLabel: f.label,
        fieldType: f.type ?? "text",
        fieldPlaceholder: f.placeholder ?? null,
        fieldHelpText: f.helpText ?? f.help ?? null,
        fieldDefaultValue: f.defaultValue ?? f.default ?? null,
        isRequired: f.required ?? true,
        validationRegex: f.validationRegex ?? null,
        validationMinLength: f.minLength ?? null,
        validationMaxLength: f.maxLength ?? null,
        isEncrypted: f.encrypted ?? true,
        encryptionStoragePath: f.storagePath ?? f.name,
        displayOrder: f.displayOrder ?? i,
        fieldGroup: f.group ?? "main",
        fieldWidth: f.width ?? "full",
        selectOptions: f.selectOptions ?? null,
        showWhen: f.showWhen ?? null,
      })),
      endpoints: endpoints.map((e) => ({
        endpointKey: e.key,
        endpointName: e.name,
        endpointUrl: e.url,
        httpMethod: e.method ?? "POST",
        defaultTimeoutSeconds: e.timeoutSeconds ?? 30,
        isDefault: e.isDefault ?? false,
      })),
      capabilities: capabilities.map((c) =>
        typeof c === "string" ? { capabilityKey: c } : { capabilityKey: c.key, isSupported: c.supported, config: c.config }
      ),
      models: models.map((m) => ({
        modelKey: m.key,
        modelName: m.name,
        modelFamily: m.family ?? null,
        category: m.category,
        supportsStreaming: m.streaming ?? false,
        supportsFunctionCalling: m.functionCalling ?? m.tools ?? false,
        supportsVision: m.vision ?? false,
        maxContextWindow: m.maxContextWindow ?? null,
        maxOutputTokens: m.maxOutputTokens ?? null,
        pricing: (m.pricing || []).map((pr) => ({
          effectiveFrom: pr.effectiveFrom ?? todayYmd(),
          effectiveTo: pr.effectiveTo ?? null,
          inputPricePerMillion: pr.inputPricePerMillion ?? null,
          outputPricePerMillion: pr.outputPricePerMillion ?? null,
          cachedInputPricePerMillion: pr.cachedInputPricePerMillion ?? null,
          imagePrice: pr.imagePrice ?? null,
          audioInputPricePerMillion: pr.audioInputPricePerMillion ?? null,
          audioOutputPricePerMillion: pr.audioOutputPricePerMillion ?? null,
          requestPrice: pr.requestPrice ?? null,
          priceCurrency: pr.priceCurrency ?? "USD",
          billingUnit: pr.billingUnit ?? "tokens",
          tierName: pr.tierName ?? "standard",
          minUnits: pr.minUnits ?? null,
          rateLimitNotes: pr.rateLimitNotes ?? null,
        })),
      })),
      resources: resources.map((r) => ({
        resourceType: r.type,
        displayName: r.displayName ?? r.type,
        description: r.description ?? null,
        iconName: r.iconName ?? null,
        displayColor: r.displayColor ?? null,
        configSchema: r.configSchema ?? null,
        isRequired: r.required ?? false,
        isDefaultEnabled: r.defaultEnabled ?? false,
        maxPerCredential: r.maxPerCredential ?? null,
        provisionEndpointKey: r.provisionEndpointKey ?? null,
        provisionMethod: r.provisionMethod ?? null,
        provisionPayloadSchema: r.provisionPayloadSchema ?? null,
        healthCheckEndpointKey: r.healthCheckEndpointKey ?? null,
        healthCheckIntervalSeconds: r.healthCheckIntervalSeconds ?? null,
        displayOrder: r.displayOrder ?? 0,
      })),
    },
  };
}

/**
 * Import a provider definition into the catalog in one transaction.
 *
 * By default this is a pure upsert — child rows are refreshed by key and rows
 * that aren't in the definition are left untouched (safe for the JSON import
 * modal, which may pass partial definitions).
 *
 * Pass `{ replaceChildren: true }` (the edit-wizard path) to additionally
 * DELETE provider_auth_schemas / provider_endpoints / provider_resource_types
 * rows for this provider that are NOT in the definition — i.e. the provided
 * sections become the full set. Capabilities, models, and pricing are never
 * deleted (the wizard doesn't manage those; re-import keeps them).
 *
 * @param {Object} def — see validateProviderDefinition for shapes
 * @param {{ replaceChildren?: boolean, getPool?: () => Promise<object> }} [opts]
 *   `getPool` is a test seam (the unit tests inject a fake connection pool);
 *   callers that omit it use the real mysql2 pool from `../pool.js`.
 * @returns {Promise<{providerId:number, created:boolean, counts:{...}}>}
 * @throws {HttpError} on validation failure (400)
 */
export async function importProviderDefinition(def, opts = {}) {
  const check = validateProviderDefinition(def);
  if (!check.ok) {
    throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));
  }
  const v = check.value;

  const pool = await (opts.getPool || getPool)();
  const conn = await pool.getConnection();
  const counts = { authFields: 0, endpoints: 0, capabilities: 0, resources: 0, models: 0, pricing: 0 };
  let providerId;
  let created;
  try {
    await conn.beginTransaction();

    const up = await CatalogImportRepository.upsertProvider(v, conn);
    providerId = up.id;
    created = up.created;

    for (const f of v.authFields) {
      await CatalogImportRepository.upsertAuthField(providerId, f, conn);
      counts.authFields += 1;
    }
    for (const e of v.endpoints) {
      await CatalogImportRepository.upsertEndpoint(providerId, e, conn);
      counts.endpoints += 1;
    }
    for (const c of v.capabilities) {
      await CatalogImportRepository.upsertCapability(providerId, c, conn);
      counts.capabilities += 1;
    }
    for (const r of v.resources) {
      await CatalogImportRepository.upsertResourceType(providerId, r, conn);
      counts.resources += 1;
    }
    for (const m of v.models) {
      await CatalogImportRepository.upsertModel(providerId, m, conn);
      counts.models += 1;
      const modelId = await CatalogImportRepository.modelIdByKey(providerId, m.modelKey, conn);
      for (const p of m.pricing) {
        if (p.effectiveTo === null) {
          // new open-ended row supersedes the current one (D3 invariant)
          await CatalogImportRepository.closeOpenPricing(modelId, p.effectiveFrom, conn);
        }
        await CatalogImportRepository.insertPricing(modelId, p, conn);
        counts.pricing += 1;
      }
    }

    // Edit-wizard semantics: the provided child sections become the full set.
    // Deletes run AFTER the upserts so the freshly written rows are always in
    // the keep-list; capabilities/models/pricing are intentionally untouched.
    if (opts.replaceChildren) {
      await CatalogImportRepository.deleteAuthFieldsNotIn(
        providerId,
        v.authFields.map((f) => f.fieldName),
        conn
      );
      await CatalogImportRepository.deleteEndpointsNotIn(
        providerId,
        v.endpoints.map((e) => e.endpointKey),
        conn
      );
      await CatalogImportRepository.deleteResourceTypesNotIn(
        providerId,
        v.resources.map((r) => r.resourceType),
        conn
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return { providerId, created, counts };
}
