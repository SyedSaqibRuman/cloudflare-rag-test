// --------------------------
// credentials routes (Clean Architecture: one router per resource group).
// Extracted verbatim from the former mysql/gateway-router.js monolith.
// --------------------------
import express from "express";
import {
  CompanyRepository,
  CredentialRepository,
  ModelRepository,
  ResourceRepository,
  AuditRepository,
} from "../repositories.js";
import * as Registry from "../services/provider-registry.js";
import * as CredentialService from "../services/credential-service.js";
import { PROBES } from "./probes.js";
import { wrap } from "./helpers.js";

const router = express.Router();


// GET /gateway/companies/:key/credentials — decrypted values never leave the DB
router.get(
  "/companies/:key/credentials",
  wrap(async (req, res) => {
    const company = await CompanyRepository.findByKey(req.params.key);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${req.params.key}' not found.` });
    }
    const credentials = await CredentialRepository.listByCompany(company.id);
    return res.json({ success: true, companyKey: company.company_key, credentials });
  })
);

// POST /gateway/companies/:key/credentials
// Body: { providerKey, credentialKey, credentialName, environmentKey?,
//         fields: { ... }, config?, rotationPolicy?, isDefault?, priority? }
router.post(
  "/companies/:key/credentials",
  wrap(async (req, res) => {
    const company = await CompanyRepository.findByKey(req.params.key);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${req.params.key}' not found.` });
    }

    const { providerKey, credentialKey, credentialName, environmentKey, fields, config } =
      req.body || {};
    if (!providerKey || !credentialKey?.trim() || !credentialName?.trim()) {
      return res.status(400).json({
        success: false,
        error: "providerKey, credentialKey and credentialName are required.",
      });
    }

    const provider = await Registry.getProvider(providerKey);
    if (!provider) {
      return res.status(400).json({ success: false, error: `Unknown provider '${providerKey}'.` });
    }

    const validation = CredentialService.validateFieldsAgainstSchema(fields || {}, provider.authForm);
    if (!validation.ok) {
      return res.status(400).json({ success: false, error: "Invalid credential fields.", errors: validation.errors });
    }

    let environmentId = null;
    if (environmentKey) {
      const environments = await CompanyRepository.environments(company.id);
      const match = environments.find((e) => e.env_key === environmentKey);
      if (!match) {
        return res.status(400).json({ success: false, error: `Unknown environment '${environmentKey}'.` });
      }
      environmentId = match.id;
    }

    const encryptMap = CredentialService.buildEncryptMap(provider.authForm);
    const { blob, version } = CredentialService.encryptCredential(fields || {}, encryptMap);

    const id = await CredentialRepository.create(company.id, {
      providerId: provider.id,
      environmentId,
      credentialKey,
      credentialName,
      config,
      encryptedCredentials: blob,
      encryptionVersion: version,
      rotationPolicy: req.body.rotationPolicy,
      autoRotateEnabled: req.body.autoRotateEnabled,
      priority: req.body.priority,
      isDefault: req.body.isDefault,
      createdBy: req.auth?.user || null,
    });

    await AuditRepository.log({
      companyId: company.id,
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "credential.created",
      entityType: "credential",
      entityId: id,
      afterState: { credential_key: credentialKey, provider_key: providerKey },
      reason: "admin action",
      isSensitive: true,
    });

    return res.status(201).json({
      success: true,
      message: `Credential '${credentialKey}' stored (encrypted at rest, encryption_version ${version}).`,
      credentialId: id,
    });
  })
);

// POST /gateway/credentials/:id/verify
// Decrypts, validates against the provider auth schema, and (for providers
// with a built-in probe) performs a live connectivity check.
router.post(
  "/credentials/:id/verify",
  wrap(async (req, res) => {
    const row = await CredentialRepository.findWithEncrypted(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: "Credential not found." });
    }
    const providerKey = await Registry.providerKeyById(row.provider_id);
    const provider = providerKey ? await Registry.getProvider(providerKey) : null;
    const authSchema = provider?.authForm || [];

    const result = CredentialService.verifyCredential(row.encrypted_credentials, authSchema);

    let latencyMs = null;
    let probeError = null;
    if (result.status === "success" && authSchema.length > 0) {
      const probe = PROBES[providerKey];
      if (probe) {
        const probeResult = await probe(result.fields);
        if (!probeResult.ok) {
          result.status = "failed";
          probeError = probeResult.error;
        } else {
          latencyMs = probeResult.latencyMs ?? null;
        }
      }
    }

    await CredentialRepository.recordVerification(row.id, {
      status: result.status,
      error: result.error || probeError,
      latencyMs,
      verifiedBy: req.auth?.user || null,
    });
    await AuditRepository.log({
      companyId: row.company_id,
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: `credential.verified.${result.status}`,
      entityType: "credential",
      entityId: row.id,
      afterState: { last_verification_status: result.status },
      reason: "verification probe",
    });

    return res.json({
      success: result.status === "success",
      status: result.status,
      error: result.error || probeError,
      latencyMs,
      warning: result.warning,
    });
  })
);

// POST /gateway/credentials/:id/rotate — { fields?, rotationPolicy? }
router.post(
  "/credentials/:id/rotate",
  wrap(async (req, res) => {
    const row = await CredentialRepository.findWithEncrypted(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: "Credential not found." });
    }
    const providerKey = await Registry.providerKeyById(row.provider_id);
    const provider = providerKey ? await Registry.getProvider(providerKey) : null;
    const authSchema = provider?.authForm || [];

    const existing = CredentialService.decryptCredential(row.encrypted_credentials);
    const encryptMap = CredentialService.buildEncryptMap(authSchema);
    const { blob } = CredentialService.rotateCredential(existing, req.body?.fields || {}, encryptMap);

    await CredentialRepository.rotate(row.id, blob, { verifiedBy: req.auth?.user || null });
    await AuditRepository.log({
      companyId: row.company_id,
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "credential.rotated",
      entityType: "credential",
      entityId: row.id,
      beforeState: { rotated_at: row.last_rotated_at },
      afterState: { last_rotated_at: new Date().toISOString() },
      reason: req.body?.reason || "manual rotation",
      isSensitive: true,
    });

    return res.json({ success: true, message: "Credential rotated and re-encrypted." });
  })
);

// PUT /gateway/credentials/:id — update metadata + optionally re-encrypt field
// values. Provider and credential_key are immutable. Blank secret fields keep
// the stored value (decrypted values never appear in the response).
router.put(
  "/credentials/:id",
  wrap(async (req, res) => {
    const row = await CredentialRepository.findWithEncrypted(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: "Credential not found." });
    }

    const body = req.body || {};
    if (body.credentialName !== undefined && !String(body.credentialName).trim()) {
      return res.status(400).json({ success: false, error: "credentialName cannot be empty." });
    }

    let environmentId = row.environment_id;
    if (body.environmentKey !== undefined) {
      if (!body.environmentKey) {
        environmentId = null;
      } else {
        const environments = await CompanyRepository.environments(row.company_id);
        const match = environments.find((e) => e.env_key === body.environmentKey);
        if (!match) {
          return res.status(400).json({ success: false, error: `Unknown environment '${body.environmentKey}'.` });
        }
        environmentId = match.id;
      }
    }

    // Merge provided secret values over the stored blob and re-encrypt in
    // place (no rotation-version bump). Validation runs against the merged
    // state so required fields satisfied by stored values still pass. The
    // registry is only loaded when secrets actually change — cheap metadata
    // edits (name/env/flags) never touch the catalog cache.
    let encryptedCredentials;
    const provided = Object.fromEntries(
      Object.entries(body.fields || {}).filter(([, v]) => String(v).trim() !== "")
    );
    if (Object.keys(provided).length > 0) {
      const providerKey = await Registry.providerKeyById(row.provider_id);
      const provider = providerKey ? await Registry.getProvider(providerKey) : null;
      // Never re-encrypt without a schema: an empty encrypt map would write
      // the merged fields as PLAINTEXT (codec pass-through). Mirror the POST
      // create guard instead of silently downgrading stored secrets.
      if (!provider) {
        return res.status(400).json({ success: false, error: `Unknown provider for credential '${row.credential_key}'.` });
      }
      const authSchema = provider?.authForm || [];
      const existing = CredentialService.decryptCredential(row.encrypted_credentials);
      const merged = { ...existing, ...provided };
      const validation = CredentialService.validateFieldsAgainstSchema(merged, authSchema);
      if (!validation.ok) {
        return res.status(400).json({ success: false, error: "Invalid credential fields.", errors: validation.errors });
      }
      const encryptMap = CredentialService.buildEncryptMap(authSchema);
      ({ blob: encryptedCredentials } = CredentialService.encryptCredential(merged, encryptMap));
    }

    const credentialName = body.credentialName ?? row.credential_name;
    const isDefault = body.isDefault ?? !!row.is_default;
    const beforeState = {
      credential_key: row.credential_key,
      credential_name: row.credential_name,
      environment_id: row.environment_id,
      is_default: !!row.is_default,
    };

    const updated = await CredentialRepository.update(row.id, {
      credentialName,
      environmentId,
      config: body.config !== undefined ? body.config : row.config,
      priority: body.priority ?? row.priority,
      isDefault,
      rotationPolicy: body.rotationPolicy ?? row.rotation_policy,
      autoRotateEnabled: body.autoRotateEnabled ?? !!row.auto_rotate_enabled,
      encryptedCredentials,
      updatedBy: req.auth?.user || null,
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: "Credential not found." });
    }

    await AuditRepository.log({
      companyId: row.company_id,
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "credential.updated",
      entityType: "credential",
      entityId: row.id,
      beforeState,
      afterState: {
        credential_key: row.credential_key,
        credential_name: credentialName,
        environment_id: environmentId,
        is_default: isDefault,
      },
      reason: body.reason || "admin update",
      isSensitive: Object.keys(provided).length > 0,
    });

    return res.json({
      success: true,
      message:
        `Credential '${row.credential_key}' updated.` +
        (encryptedCredentials ? " Secret values re-encrypted." : ""),
    });
  })
);

// DELETE /gateway/credentials/:id — soft delete + audit
router.delete(
  "/credentials/:id",
  wrap(async (req, res) => {
    const row = await CredentialRepository.findWithEncrypted(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: "Credential not found." });
    }
    await CredentialRepository.remove(row.id);
    await AuditRepository.log({
      companyId: row.company_id,
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "credential.deleted",
      entityType: "credential",
      entityId: row.id,
      afterState: { credential_key: row.credential_key },
      reason: "admin action",
      isSensitive: true,
    });
    return res.json({ success: true, message: "Credential deleted." });
  })
);

// ============================================================
// 4. MODEL ACCESS
// ============================================================

// GET /gateway/credentials/:id/models
router.get(
  "/credentials/:id/models",
  wrap(async (req, res) => {
    const rows = await ResourceRepository.listModelAccess(req.params.id);
    return res.json({ success: true, credentialId: Number(req.params.id), models: rows });
  })
);

// POST /gateway/credentials/:id/models — grant/update model access
// Body: { modelId, rateLimitPerMin?, monthlyQuotaTokens?, isDefaultForCategory? }
router.post(
  "/credentials/:id/models",
  wrap(async (req, res) => {
    const row = await CredentialRepository.findWithEncrypted(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: "Credential not found." });
    }
    const { modelId, ...opts } = req.body || {};
    if (!modelId) {
      return res.status(400).json({ success: false, error: "modelId is required." });
    }
    const model = await ModelRepository.findById(modelId);
    if (!model) {
      return res.status(400).json({ success: false, error: `Unknown model id '${modelId}'.` });
    }
    await ResourceRepository.grantModelAccess(row.company_id, row.id, modelId, opts);
    await AuditRepository.log({
      companyId: row.company_id,
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "model_access.granted",
      entityType: "credential_model_access",
      entityId: row.id,
      afterState: { model_key: model.model_key, ...opts },
      reason: "admin action",
    });
    return res.json({ success: true, message: `Model '${model.model_key}' access granted.` });
  })
);


export default router;
