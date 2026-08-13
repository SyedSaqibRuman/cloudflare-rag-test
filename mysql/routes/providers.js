// --------------------------
// providers routes (Clean Architecture: one router per resource group).
// Extracted verbatim from the former mysql/gateway-router.js monolith.
// --------------------------
import express from "express";
import {
  ProviderRepository,
  ModelRepository,
  PricingRepository,
  AuditRepository,
} from "../repositories.js";
import * as Registry from "../services/provider-registry.js";
import * as CatalogImporter from "../services/catalog-importer.js";
import { wrap } from "./helpers.js";

const router = express.Router();


// GET /gateway/providers
router.get(
  "/providers",
  wrap(async (_req, res) => {
    const providers = await Registry.listProviders();
    return res.json({ success: true, providers });
  })
);

// GET /gateway/providers/:key — full metadata incl. capabilities
router.get(
  "/providers/:key",
  wrap(async (req, res) => {
    const provider = await Registry.getProvider(req.params.key);
    if (!provider) {
      return res.status(404).json({ success: false, error: `Unknown provider '${req.params.key}'.` });
    }
    return res.json({ success: true, provider });
  })
);

// GET /gateway/providers/:key/auth-form — dynamic credential form
router.get(
  "/providers/:key/auth-form",
  wrap(async (req, res) => {
    const fields = await Registry.getAuthForm(req.params.key);
    if (fields === null) {
      return res.status(404).json({ success: false, error: `Unknown provider '${req.params.key}'.` });
    }
    return res.json({ success: true, providerKey: req.params.key, fields });
  })
);

// GET /gateway/providers/:key/resources — resource provisioning templates
router.get(
  "/providers/:key/resources",
  wrap(async (req, res) => {
    const templates = await Registry.getResourceTemplates(req.params.key);
    if (templates === null) {
      return res.status(404).json({ success: false, error: `Unknown provider '${req.params.key}'.` });
    }
    return res.json({ success: true, providerKey: req.params.key, templates });
  })
);

// GET /gateway/providers/:key/models — models + current pricing
router.get(
  "/providers/:key/models",
  wrap(async (req, res) => {
    const models = await Registry.getModels(req.params.key);
    if (models === null) {
      return res.status(404).json({ success: false, error: `Unknown provider '${req.params.key}'.` });
    }
    return res.json({ success: true, providerKey: req.params.key, models });
  })
);

// Model category ENUM in schema/v5.sql — must stay in sync.
const MODEL_CATEGORIES = ["chat", "embedding", "reranker", "image", "tts", "stt", "vision"];

// Model keys mirror the config-layer contract (config/validation.js allows the
// same charset) so catalog values are always settable as company config values.
// Vendor-prefixed IDs like @cf/baai/bge-base-en-v1.5 or xai/grok-4.6 carry @/:
// and letters/digits of either case — e.g. @cf/moondream/moondream3.1-9B-A2B.
const MODEL_KEY_RE = /^[a-zA-Z0-9@][a-zA-Z0-9._:@/-]*$/;

// POST /gateway/providers/:key/models — upsert a single provider model
// (with optional pricing rows). The importer only runs full definitions, so
// this is the UI's way to add one model at a time. Upsert semantics: same
// provider_id+model_key refreshes the row in place.
router.post(
  "/providers/:key/models",
  wrap(async (req, res) => {
    const provider = await Registry.getProvider(req.params.key);
    if (!provider) {
      return res.status(404).json({ success: false, error: `Unknown provider '${req.params.key}'.` });
    }

    const b = req.body || {};
    const modelKey = String(b.key || b.modelKey || "").trim();
    const modelName = String(b.name || b.modelName || "").trim();
    const category = String(b.category || "").trim();
    if (!MODEL_KEY_RE.test(modelKey) || modelKey.length > 100) {
      return res.status(400).json({ success: false, error: "Model key must be 1-100 chars: letters, numbers, dots, underscores, hyphens, and @ / : for vendor-prefixed IDs (e.g. gpt-4o, @cf/baai/bge-base-en-v1.5)." });
    }
    if (!modelName || modelName.length > 200) {
      return res.status(400).json({ success: false, error: "Model name is required (max 200 chars)." });
    }
    if (!MODEL_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: `Category must be one of: ${MODEL_CATEGORIES.join(", ")}.` });
    }

    const modelId = await ModelRepository.upsert(provider.id, {
      modelKey,
      modelName,
      modelFamily: b.family || b.modelFamily || null,
      category,
      supportsStreaming: b.streaming ?? b.supportsStreaming ?? false,
      supportsFunctionCalling: b.functionCalling ?? b.supportsFunctionCalling ?? false,
      supportsVision: b.vision ?? b.supportsVision ?? false,
      maxContextWindow: b.maxContextWindow ? Number(b.maxContextWindow) : null,
      maxOutputTokens: b.maxOutputTokens ? Number(b.maxOutputTokens) : null,
    });

    let pricingCount = 0;
    if (Array.isArray(b.pricing) && b.pricing.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      for (const p of b.pricing) {
        await PricingRepository.create(modelId, {
          effectiveFrom: p.effectiveFrom ?? today,
          inputPricePerMillion: p.inputPricePerMillion ?? null,
          outputPricePerMillion: p.outputPricePerMillion ?? null,
          priceCurrency: p.priceCurrency ?? "USD",
        });
        pricingCount += 1;
      }
    }

    // Drop the cache so the catalog/detail views pick up the model immediately.
    Registry.invalidateRegistry();

    await AuditRepository.log({
      companyId: null,
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "provider.model.upserted",
      entityType: "provider_model",
      entityId: modelId,
      afterState: { provider_key: req.params.key, model_key: modelKey, category },
      reason: "catalog update",
      isSensitive: false,
    });

    return res.status(201).json({
      success: true,
      message: `Model '${modelKey}' upserted for '${req.params.key}'.` + (pricingCount ? ` ${pricingCount} price row(s) added.` : ""),
      modelId,
    });
  })
);

/** Load a model and confirm it belongs to the provider in the URL path. */
async function resolveProviderModel(key, id) {
  const provider = await Registry.getProvider(key);
  if (!provider) {
    const err = new Error(`Unknown provider '${key}'.`);
    err.status = 404;
    throw err;
  }
  const model = await ModelRepository.findById(Number(id));
  if (!model || Number(model.provider_id) !== provider.id) {
    const err = new Error(`Model '${id}' not found for provider '${key}'.`);
    err.status = 404;
    throw err;
  }
  return { provider, model };
}

// PUT /gateway/providers/:key/models/:id — update a model's metadata. The
// model_key IS editable (it's the unique key per provider, so renaming onto a
// key already used by another model on the same provider is refused with 409);
// name/family/category/flags and context/output windows are editable too.
// Pricing is managed via /gateway/pricing.
router.put(
  "/providers/:key/models/:id",
  wrap(async (req, res) => {
    const { model } = await resolveProviderModel(req.params.key, req.params.id);
    const b = req.body || {};
    const modelName = b.name !== undefined ? String(b.name).trim() : model.model_name;
    const category = b.category !== undefined ? String(b.category).trim() : model.category;
    if (!modelName || modelName.length > 200) {
      return res.status(400).json({ success: false, error: "Model name is required (max 200 chars)." });
    }
    if (!MODEL_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, error: `Category must be one of: ${MODEL_CATEGORIES.join(", ")}.` });
    }
    // model_key is editable — validate it when the body carries one (an absent
    // or blank key keeps the stored value; the DB enforces (provider_id,
    // model_key) uniqueness, so a rename onto an existing key throws
    // ER_DUP_ENTRY → 409).
    const newKey = String(b.key ?? b.modelKey ?? model.model_key).trim() || model.model_key;
    if (!MODEL_KEY_RE.test(newKey) || newKey.length > 100) {
      return res.status(400).json({ success: false, error: "Model key must be 1-100 chars: letters, numbers, dots, underscores, hyphens, and @ / : for vendor-prefixed IDs (e.g. gpt-4o, @cf/baai/bge-base-en-v1.5)." });
    }
    const renamed = newKey !== model.model_key;

    try {
      await ModelRepository.update(model.id, {
        modelKey: newKey,
        modelName,
        modelFamily: b.family !== undefined ? (b.family ?? null) : model.model_family,
        category,
        supportsStreaming: b.streaming ?? b.supportsStreaming ?? !!model.supports_streaming,
        supportsFunctionCalling: b.functionCalling ?? b.supportsFunctionCalling ?? !!model.supports_function_calling,
        supportsVision: b.vision ?? b.supportsVision ?? !!model.supports_vision,
        maxContextWindow: b.maxContextWindow !== undefined ? Number(b.maxContextWindow) || null : model.max_context_window,
        maxOutputTokens: b.maxOutputTokens !== undefined ? Number(b.maxOutputTokens) || null : model.max_output_tokens,
      });
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ success: false, error: `Model key '${newKey}' already exists for provider '${req.params.key}'.` });
      }
      throw err;
    }
    Registry.invalidateRegistry();

    await AuditRepository.log({
      companyId: null,
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "provider.model.updated",
      entityType: "provider_model",
      entityId: model.id,
      beforeState: { provider_key: req.params.key, model_key: model.model_key },
      afterState: { provider_key: req.params.key, model_key: newKey, category },
      reason: "catalog update",
      isSensitive: false,
    });

    return res.json({
      success: true,
      message: `Model '${newKey}' ${renamed ? "renamed and " : ""}updated for '${req.params.key}'.`,
      modelId: model.id,
    });
  })
);

// DELETE /gateway/providers/:key/models/:id — hard delete. Pricing and
// credential_model_access rows CASCADE (see schema/v5.sql), so tenant grants
// for the model disappear with it.
router.delete(
  "/providers/:key/models/:id",
  wrap(async (req, res) => {
    const { model } = await resolveProviderModel(req.params.key, req.params.id);
    await ModelRepository.remove(model.id);
    Registry.invalidateRegistry();

    await AuditRepository.log({
      companyId: null,
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "provider.model.deleted",
      entityType: "provider_model",
      entityId: model.id,
      afterState: { provider_key: req.params.key, model_key: model.model_key },
      reason: "catalog update",
      isSensitive: false,
    });

    return res.json({
      success: true,
      message: `Model '${model.model_key}' deleted for '${req.params.key}'.`,
    });
  })
);

const PROVIDER_CATEGORIES = [
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
const PROVIDER_AUTH_TYPES = ["api_key", "bearer_token", "oauth2", "basic_auth", "custom"];

// POST /gateway/providers — create a provider (blank slate: no auth schema,
// models, or endpoints yet — those come from later catalog phases/UI).
router.post(
  "/providers",
  wrap(async (req, res) => {
    const body = req.body || {};
    const errors = {};

    if (!body.providerKey?.trim()) {
      errors.providerKey = "providerKey is required.";
    } else if (!/^[a-z0-9_]+$/.test(body.providerKey)) {
      errors.providerKey = "providerKey must match /^[a-z0-9_]+$/.";
    } else if (body.providerKey.trim().length < 3 || body.providerKey.trim().length > 50) {
      errors.providerKey = "providerKey must be 3-50 characters.";
    }

    if (!body.providerName?.trim()) {
      errors.providerName = "providerName is required.";
    } else if (body.providerName.trim().length > 100) {
      errors.providerName = "providerName must be at most 100 characters.";
    }

    if (!body.category) {
      errors.category = "category is required.";
    } else if (!PROVIDER_CATEGORIES.includes(body.category)) {
      errors.category = `category must be one of ${PROVIDER_CATEGORIES.join(", ")}.`;
    }

    if (body.authType !== undefined && body.authType !== null && !PROVIDER_AUTH_TYPES.includes(body.authType)) {
      errors.authType = `authType must be one of ${PROVIDER_AUTH_TYPES.join(", ")}.`;
    }

    for (const field of ["websiteUrl", "documentationUrl", "defaultApiBaseUrl"]) {
      if (body[field] !== undefined && body[field] !== null && body[field] !== "") {
        if (String(body[field]).length > 500) {
          errors[field] = `${field} must be at most 500 characters.`;
        } else {
          try {
            new URL(body[field]);
          } catch {
            errors[field] = `${field} must be a valid URL.`;
          }
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, error: "Validation failed: " + JSON.stringify(errors), errors });
    }

    if (await ProviderRepository.activeByKey(body.providerKey.trim())) {
      return res.status(409).json({ success: false, error: `Provider '${body.providerKey.trim()}' already exists.` });
    }

    const id = await ProviderRepository.create({
      providerKey: body.providerKey.trim(),
      providerName: body.providerName.trim(),
      category: body.category,
      authType: body.authType ?? "bearer_token",
      websiteUrl: body.websiteUrl ?? null,
      documentationUrl: body.documentationUrl ?? null,
      defaultApiBaseUrl: body.defaultApiBaseUrl ?? null,
      isActive: body.isActive ?? true,
    });
    Registry.invalidateRegistry();
    await AuditRepository.log({
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "provider.created",
      entityType: "provider",
      entityId: id,
      afterState: { provider_key: body.providerKey.trim(), category: body.category },
      reason: "admin action",
    });
    return res.status(201).json({
      success: true,
      message: `Provider '${body.providerKey.trim()}' created.`,
      providerId: id,
    });
  })
);

// PUT /gateway/providers/:key — update a provider's editable metadata
// (providerKey is the route identity and is never editable). Partial updates
// merge over the stored row: only present fields are written + validated.
router.put(
  "/providers/:key",
  wrap(async (req, res) => {
    const existing = await Registry.getProvider(req.params.key);
    if (!existing) {
      return res.status(404).json({ success: false, error: `Unknown provider '${req.params.key}'.` });
    }

    const body = req.body || {};
    const errors = {};

    if (body.providerName !== undefined && body.providerName !== null) {
      if (!String(body.providerName).trim()) errors.providerName = "providerName is required.";
      else if (String(body.providerName).trim().length > 100) errors.providerName = "providerName must be at most 100 characters.";
    }
    if (body.category !== undefined && body.category !== null) {
      if (!PROVIDER_CATEGORIES.includes(body.category)) errors.category = `category must be one of ${PROVIDER_CATEGORIES.join(", ")}.`;
    }
    if (body.authType !== undefined && body.authType !== null) {
      if (!PROVIDER_AUTH_TYPES.includes(body.authType)) errors.authType = `authType must be one of ${PROVIDER_AUTH_TYPES.join(", ")}.`;
    }
    for (const field of ["websiteUrl", "documentationUrl", "defaultApiBaseUrl"]) {
      if (body[field] !== undefined && body[field] !== null && body[field] !== "") {
        if (String(body[field]).length > 500) errors[field] = `${field} must be at most 500 characters.`;
        else {
          try {
            new URL(body[field]);
          } catch {
            errors[field] = `${field} must be a valid URL.`;
          }
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, error: "Validation failed: " + JSON.stringify(errors), errors });
    }

    const patch = {};
    for (const [key, value] of [
      ["providerName", body.providerName],
      ["category", body.category],
      ["authType", body.authType],
      ["websiteUrl", body.websiteUrl],
      ["documentationUrl", body.documentationUrl],
      ["defaultApiBaseUrl", body.defaultApiBaseUrl],
      ["isActive", body.isActive],
    ]) {
      if (value !== undefined) patch[key] = typeof value === "string" ? value.trim() : value;
    }
    patch.providerName = patch.providerName ?? existing.provider_name;
    if (!patch.providerName.trim()) {
      return res.status(400).json({ success: false, error: "Validation failed: providerName is required." });
    }

    await ProviderRepository.update(req.params.key, patch);
    Registry.invalidateRegistry();
    const updated = await Registry.getProvider(req.params.key);
    await AuditRepository.log({
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "provider.updated",
      entityType: "provider",
      entityId: existing.id,
      beforeState: {
        provider_name: existing.provider_name,
        category: existing.primary_service_category,
        auth_type: existing.auth_type,
        website_url: existing.website_url,
        documentation_url: existing.documentation_url,
        default_api_base_url: existing.default_api_base_url,
      },
      afterState: {
        provider_name: updated.provider_name,
        category: updated.primary_service_category,
        auth_type: updated.auth_type,
        website_url: updated.website_url,
        documentation_url: updated.documentation_url,
        default_api_base_url: updated.default_api_base_url,
      },
      reason: "admin action",
    });
    return res.json({ success: true, message: `Provider '${req.params.key}' updated.`, providerId: existing.id });
  })
);

// POST /gateway/providers/import — Provider JSON -> catalog (transactional
// upsert of providers + auth schemas + endpoints + capabilities + models +
// pricing + resource types). MySQL is the runtime source of truth; the JSON
// is the seed/import format. Re-importing an existing provider refreshes it.
router.post(
  "/providers/import",
  wrap(async (req, res) => {
    const body = req.body || {};
    const definition =
      body.definition && typeof body.definition === "object" ? body.definition : body;
    const result = await CatalogImporter.importProviderDefinition(definition, {
      replaceChildren: body.replaceChildren === true,
    });
    Registry.invalidateRegistry();
    const provider = await Registry.getProvider(
      definition.providerKey || definition.provider?.key || definition.key
    );
    await AuditRepository.log({
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "provider.imported",
      entityType: "provider",
      entityId: result.providerId,
      afterState: {
        provider_key: definition.providerKey || definition.provider?.key || definition.key,
        provider_id: result.providerId,
        imported: result.created ? "created" : "refreshed",
        counts: result.counts,
      },
      reason: "admin action",
    });
    return res.status(result.created ? 201 : 200).json({
      success: true,
      providerId: result.providerId,
      created: result.created,
      counts: result.counts,
      provider,
    });
  })
);

// DELETE /gateway/providers/:key — hard delete (D10, like KBs). Catalog child
// tables CASCADE; credentials/provider_resources RESTRICT, so deleting a
// provider those rows reference is refused with a 409 unless force=true, which
// permanently deletes the referencing tenant rows first (audited per row).
router.delete(
  "/providers/:key",
  wrap(async (req, res) => {
    const existing = await Registry.getProvider(req.params.key);
    if (!existing) {
      return res.status(404).json({ success: false, error: `Unknown provider '${req.params.key}'.` });
    }
    const force = req.query.force === "true" || req.query.force === "1";
    try {
      await ProviderRepository.remove(req.params.key);
    } catch (err) {
      if (err?.code !== "ER_ROW_IS_REFERENCED_2") throw err;

      // The FK on provider_id is a hard RESTRICT that ignores deleted_at, so
      // soft-deleted credentials/resources (left behind by deleted tenants)
      // still block the delete. They are logically dead — purge them
      // automatically. Only *active* referencing rows need an explicit
      // force=true to be permanently removed.
      const [creds, resources] = await Promise.all([
        CredentialRepository.listByProvider(existing.id),
        ResourceRepository.listByProvider(existing.id),
      ]);
      const hasActive =
        creds.some((c) => !c.deleted_at) || resources.some((r) => !r.deleted_at);

      if (hasActive && !force) {
        return res.status(409).json({
          success: false,
          error: `Provider '${req.params.key}' is referenced by tenant credentials or resources and cannot be deleted. Pass force=true to permanently delete those rows too.`,
        });
      }

      // Purge the blocked rows: all of them when force is passed, otherwise
      // just the soft-deleted (already logically removed) leftovers.
      const credsToPurge = force ? creds : creds.filter((c) => c.deleted_at);
      for (const row of credsToPurge) {
        await CredentialRepository.removePermanent(row.id);
        await AuditRepository.log({
          companyId: row.company_id,
          actorType: "admin",
          actorId: req.auth?.user || null,
          action: "credential.deleted",
          entityType: "credential",
          entityId: row.id,
          afterState: { credential_key: row.credential_key, provider_key: req.params.key, forced: force },
          reason: force
            ? "admin action (force provider delete)"
            : "provider delete (soft-deleted credential cleanup)",
          isSensitive: true,
        });
      }
      const resourcesToPurge = force ? resources : resources.filter((r) => r.deleted_at);
      for (const row of resourcesToPurge) {
        await ResourceRepository.removePermanent(row.id);
        await AuditRepository.log({
          companyId: row.company_id,
          actorType: "admin",
          actorId: req.auth?.user || null,
          action: "resource.deleted",
          entityType: "provider_resource",
          entityId: row.id,
          afterState: { resource_key: row.resource_key, provider_key: req.params.key, forced: force },
          reason: force
            ? "admin action (force provider delete)"
            : "provider delete (soft-deleted resource cleanup)",
        });
      }
      await ProviderRepository.remove(req.params.key);
    }
    Registry.invalidateRegistry();
    await AuditRepository.log({
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "provider.deleted",
      entityType: "provider",
      entityId: existing.id,
      beforeState: { provider_key: existing.provider_key, category: existing.primary_service_category, forced: force },
      reason: "admin action",
    });
    return res.json({ success: true, message: `Provider '${req.params.key}' deleted.` });
  })
);


export default router;
