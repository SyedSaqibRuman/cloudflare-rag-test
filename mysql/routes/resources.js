// --------------------------
// resources routes (Clean Architecture: one router per resource group).
// Extracted verbatim from the former mysql/gateway-router.js monolith.
// --------------------------
import express from "express";
import {
  CompanyRepository,
  CredentialRepository,
  ResourceRepository,
  AuditRepository,
  KbRepository,
} from "../repositories.js";
import * as Registry from "../services/provider-registry.js";
import { syncRagResource, clearRagResource } from "../services/rag-sync.js";
import { autoBindVectorResource } from "../services/kb-auto-bind.js";
import { wrap } from "./helpers.js";
import { actorFromReq, assertResourceNotKbBound } from "./shared-helpers.js";

const router = express.Router();

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
const RESOURCE_KEY_RE = /^[a-z0-9-]+$/;

// POST /gateway/companies/:key/resources — provision a resource under a
// credential (Phase D: company → credential → resource). The resource type
// must be one the provider's catalog advertises (provider_resource_types).
// Body: { providerKey, credentialId, resourceType, resourceKey, resourceName,
//         environmentKey?, externalResourceId?, externalRegion?,
//         description?, config?, isDefault? }
router.post(
  "/companies/:key/resources",
  wrap(async (req, res) => {
    const company = await CompanyRepository.findByKey(req.params.key);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${req.params.key}' not found.` });
    }
    const body = req.body || {};
    const errors = {};

    if (!body.providerKey?.trim()) errors.providerKey = "providerKey is required.";
    if (!body.credentialId) errors.credentialId = "credentialId is required.";
    if (!body.resourceType || !RESOURCE_TYPES.includes(body.resourceType)) {
      errors.resourceType = `resourceType must be one of ${RESOURCE_TYPES.join(", ")}.`;
    }
    if (!body.resourceKey?.trim() || !RESOURCE_KEY_RE.test(body.resourceKey)) {
      errors.resourceKey = "resourceKey must match /^[a-z0-9-]+$/.";
    } else if (body.resourceKey.length < 3 || body.resourceKey.length > 63) {
      errors.resourceKey = "resourceKey must be 3-63 characters.";
    }
    if (!body.resourceName?.trim()) {
      errors.resourceName = "resourceName is required.";
    } else if (body.resourceName.trim().length > 200) {
      errors.resourceName = "resourceName must be at most 200 characters.";
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, error: "Validation failed: " + JSON.stringify(errors), errors });
    }

    // The provider must exist and advertise this resource type.
    const provider = await Registry.getProvider(body.providerKey.trim());
    if (!provider) {
      return res.status(400).json({ success: false, error: `Unknown provider '${body.providerKey.trim()}'.` });
    }
    const templates = await Registry.getResourceTemplates(provider.provider_key);
    const template = (templates || []).find((t) => t.resource_type === body.resourceType);
    if (templates?.length && !template) {
      return res.status(400).json({
        success: false,
        error: `Provider '${provider.provider_key}' does not advertise resource type '${body.resourceType}'.`,
      });
    }

    // The credential must belong to this company AND to the chosen provider.
    const credential = await CredentialRepository.findById(body.credentialId);
    if (!credential || Number(credential.company_id) !== Number(company.id)) {
      return res.status(400).json({ success: false, error: `Unknown credentialId '${body.credentialId}'.` });
    }
    if (Number(credential.provider_id) !== Number(provider.id)) {
      return res.status(400).json({
        success: false,
        error: `Credential '${credential.credential_key}' is for provider '${credential.provider_id}', not '${provider.provider_key}'.`,
      });
    }

    // max_per_credential gate from the provider's resource template.
    if (template?.max_per_credential != null) {
      const count = await ResourceRepository.countByCredentialType(credential.id, body.resourceType);
      if (count >= Number(template.max_per_credential)) {
        return res.status(409).json({
          success: false,
          error: `This credential already has ${count} of '${body.resourceType}' (max ${template.max_per_credential}).`,
        });
      }
    }

    let environmentId = null;
    if (body.environmentKey) {
      const environments = await CompanyRepository.environments(company.id);
      const match = environments.find((e) => e.env_key === body.environmentKey);
      if (!match) {
        return res.status(400).json({ success: false, error: `Unknown environment '${body.environmentKey}'.` });
      }
      environmentId = match.id;
    }

    try {
      const id = await ResourceRepository.create(company.id, {
        credentialId: credential.id,
        providerId: provider.id,
        environmentId,
        resourceType: body.resourceType,
        resourceKey: body.resourceKey.trim(),
        resourceName: body.resourceName.trim(),
        externalResourceId: body.externalResourceId ?? null,
        externalResourceUrl: body.externalResourceUrl ?? null,
        externalRegion: body.externalRegion ?? null,
        description: body.description ?? null,
        config: body.config ?? null,
        isDefault: body.isDefault ?? false,
        createdBy: req.auth?.user || null,
      });
      await AuditRepository.log({
        companyId: company.id,
        ...actorFromReq(req),
        action: "resource.created",
        entityType: "provider_resource",
        entityId: id,
        afterState: {
          resource_key: body.resourceKey.trim(),
          resource_type: body.resourceType,
          provider_key: provider.provider_key,
          credential_key: credential.credential_key,
        },
        reason: "admin action",
      });
      // Mirror RAG-relevant resource config (graph_database database_name →
      // NEO4J_DATABASE) into the config store — best-effort.
      await syncRagResource(company.company_key, {
        resourceType: body.resourceType,
        config: body.config,
      });
      // AUTO-BIND: a new vector_index under a vector-capable provider becomes
      // the Vector Store of this company's KBs whose binding is broken (null,
      // deleted, inactive, or a non-vector provider). Healthy bindings and
      // external-id KBs are never touched. Best-effort — never fails the create.
      let rebound = [];
      try {
        const created = await ResourceRepository.findById(id);
        rebound = await autoBindVectorResource({
          kbRepo: KbRepository,
          resourceRepo: ResourceRepository,
          auditRepo: AuditRepository,
          company,
          newResource: created,
          actor: actorFromReq(req),
        });
      } catch (bindErr) {
        console.warn(`⚠️ KB auto-bind skipped: ${bindErr.message}`);
      }
      const rebindNote = rebound.length
        ? ` Auto-bound as the Vector Store for ${rebound.length} KB${rebound.length === 1 ? "" : "s"}: ${rebound.map((r) => `'${r.kb_key}'`).join(", ")}.`
        : "";
      return res.status(201).json({
        success: true,
        message: `Resource '${body.resourceKey.trim()}' provisioned under '${credential.credential_key}'.${rebindNote}`,
        resourceId: id,
        reboundKbs: rebound,
      });
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ success: false, error: `Resource key '${body.resourceKey.trim()}' already exists for this company.` });
      }
      throw err;
    }
  })
);

// PUT /gateway/resources/:id — update a resource's editable metadata
// (resourceKey / credential are immutable — recreate to move).
router.put(
  "/resources/:id",
  wrap(async (req, res) => {
    const existing = await ResourceRepository.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Resource not found." });
    }
    const body = req.body || {};
    if (body.resourceName !== undefined && body.resourceName !== null) {
      if (!String(body.resourceName).trim()) {
        return res.status(400).json({ success: false, error: "resourceName is required." });
      }
      if (String(body.resourceName).trim().length > 200) {
        return res.status(400).json({ success: false, error: "resourceName must be at most 200 characters." });
      }
    }
    const patch = {};
    for (const [key, value] of [
      ["resourceName", body.resourceName],
      ["externalResourceId", body.externalResourceId],
      ["externalResourceUrl", body.externalResourceUrl],
      ["externalRegion", body.externalRegion],
      ["description", body.description],
      ["config", body.config],
      ["status", body.status],
      ["isDefault", body.isDefault],
      ["isActive", body.isActive],
    ]) {
      if (value !== undefined) patch[key] = value;
    }
    await ResourceRepository.update(Number(req.params.id), patch);
    // Mirror the updated config (e.g. a new database_name) into the RAG store.
    if (patch.config !== undefined) {
      const company = await CompanyRepository.findById(existing.company_id);
      if (company) {
        await syncRagResource(company.company_key, {
          resourceType: existing.resource_type,
          config: patch.config,
        });
      }
    }
    await AuditRepository.log({
      companyId: existing.company_id,
      ...actorFromReq(req),
      action: "resource.updated",
      entityType: "provider_resource",
      entityId: Number(req.params.id),
      beforeState: { resource_key: existing.resource_key },
      afterState: { resource_key: existing.resource_key, ...patch },
      reason: "admin action",
    });
    return res.json({ success: true, message: "Resource updated." });
  })
);

// DELETE /gateway/resources/:id — soft delete (row no longer resolvable)
router.delete(
  "/resources/:id",
  wrap(async (req, res) => {
    const existing = await ResourceRepository.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Resource not found." });
    }
    // KB-binding guard: a resource a knowledge base still points at must not
    // be deletable — the stale pointer makes ingest fail with "Vector store
    // is not configured" and retrieval silently lose the KB.
    await assertResourceNotKbBound(existing, "Resource");
    await ResourceRepository.remove(Number(req.params.id));
    // Clear the RAG keys this resource provided (if none remain).
    await clearRagResource(existing.company_id, existing);
    await AuditRepository.log({
      companyId: existing.company_id,
      ...actorFromReq(req),
      action: "resource.deleted",
      entityType: "provider_resource",
      entityId: Number(req.params.id),
      afterState: { resource_key: existing.resource_key },
      reason: "admin action",
    });
    return res.json({ success: true, message: "Resource deleted." });
  })
);

export default router;
