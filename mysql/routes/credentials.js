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
import { getProbe } from "./probes.js";
import { wrap } from "./helpers.js";
import { parsePagination } from "./pagination.js";
import { diagnoseError } from "../../shared/error-tag.js";
import { syncRagCredentials, clearRagCredentials } from "../services/rag-sync.js";
import { actorFromReq, assertResourceNotKbBound } from "./shared-helpers.js";
import { ConflictError } from "../../shared/errors.js";

export { diagnoseError }; // re-export for the gateway test suite (dynamic import)

const router = express.Router();

// mysql2 surfaces unique-key violations as ER_DUP_ENTRY (errno 1062). Since
// migration 029 dropped the global uk_credential_key, the only uniqueness
// left on credentials is the per-tenant composite (company + provider +
// environment + key) — map a collision to a 409 with an actionable message
// instead of a raw 500.
const isDupEntry = (err) => err?.code === "ER_DUP_ENTRY" || err?.errno === 1062;


// GET /gateway/companies/:key/credentials — SECRET values never leave the DB.
// ?includeInactive=1 also returns disabled credentials (the 9Router-style
// Providers page needs them to show the "Disabled" state + re-enable toggle).
// ?includeStored=1 additionally returns each credential's NON-SECRET stored
// fields (text/url/select — e.g. Cloudflare account_id, base_url) decrypted,
// under `fields`, so the edit form can prefill them. Password/encrypted
// fields are stripped before the response leaves the server.
router.get(
  "/companies/:key/credentials",
  wrap(async (req, res) => {
    const company = await CompanyRepository.findByKey(req.params.key);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${req.params.key}' not found.` });
    }
    const includeInactive = req.query.includeInactive === "1" || req.query.includeInactive === "true";
    const includeStored = req.query.includeStored === "1" || req.query.includeStored === "true";
    const credentials = await CredentialRepository.listByCompany(company.id, { includeInactive, includeStored });

    if (includeStored) {
      // Decrypt each blob and keep only fields the auth schema marks as
      // non-secret (field_type not password/secret). The raw blob and any
      // encrypted values are dropped so secrets never serialize.
      for (const cred of credentials) {
        const schema = cred.provider_key ? (await Registry.getProvider(cred.provider_key))?.authForm || [] : [];
        // WHITELIST: only fields the auth schema explicitly declares as
        // non-secret (field_type text/url/select — e.g. Cloudflare's
        // account_id, base_url) come back. "Secret" = a password-type field.
        // Stored values under names NOT in the schema (e.g. a legacy generic
        // "api_key" field) are ALWAYS dropped — never assume unknown fields
        // are safe to expose.
        const allowed = new Set(
          schema.filter((f) => f.field_type !== "password").map((f) => f.field_name)
        );
        let stored = {};
        try {
          const decrypted = CredentialService.decryptCredential(cred.encrypted_credentials);
          for (const [key, value] of Object.entries(decrypted)) {
            if (allowed.has(key)) stored[key] = value;
          }
        } catch {
          /* malformed/legacy blob — return no stored fields */
        }
        delete cred.encrypted_credentials;
        delete cred.encryption_version;
        cred.fields = stored;
      }
    }

    const pagination = parsePagination(req);
    const total = credentials.length;
    const { page, perPage } = pagination;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const offset = (page - 1) * perPage;
    const pageCredentials = credentials.slice(offset, offset + perPage);
    res.set("X-Total-Count", String(total));
    res.set("X-Page-Count", String(totalPages));
    return res.json({
      success: true,
      companyKey: company.company_key,
      credentials: pageCredentials,
      pagination: { page, perPage, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
    });
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

    let id;
    try {
      id = await CredentialRepository.create(company.id, {
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
    } catch (err) {
      if (isDupEntry(err)) {
        throw new ConflictError(
          `A credential with key '${credentialKey}' already exists for this company, provider and environment — pick a different credential key.`,
          "CREDENTIAL_KEY_EXISTS"
        );
      }
      throw err;
    }

    await AuditRepository.log({
      companyId: company.id,
      ...actorFromReq(req),
      action: "credential.created",
      entityType: "credential",
      entityId: id,
      afterState: { credential_key: credentialKey, provider_key: providerKey },
      reason: "admin action",
      isSensitive: true,
    });

    // Mirror the connection's fields into the RAG config store so the RAG
    // pipeline (resolveCreds) uses the same credentials — best-effort.
    await syncRagCredentials(company.company_key, fields || {}, { providerKey });

    return res.status(201).json({
      success: true,
      message: `Credential '${credentialKey}' stored (encrypted at rest, encryption_version ${version}).`,
      credentialId: id,
    });
  })
);

// ------------------------------------------------------------------
// Shared verification core — used by the single-credential verify endpoint
// and the 9Router-style batch "Test All" endpoint. Decrypts, validates
// against the provider auth schema, runs the live probe when one exists,
// records the outcome on the row, and audits it.
// ------------------------------------------------------------------
async function runVerify(row, actorId = null) {
  const providerKey = await Registry.providerKeyById(row.provider_id);
  const provider = providerKey ? await Registry.getProvider(providerKey) : null;
  const authSchema = provider?.authForm || [];

  const result = CredentialService.verifyCredential(row.encrypted_credentials, authSchema);

  // Neo4j: the database name lives on the company's graph_database RESOURCE,
  // not the credential's auth fields — inject it so the probe verifies the
  // real database exists (instead of defaulting to a 'neo4j' name that Aura
  // instances don't have).
  if (providerKey === "neo4j" && result.fields && !result.fields.database) {
    const graphs = await ResourceRepository.listByCompany(row.company_id, { resourceType: "graph_database" });
    const db = graphs[0]?.config?.database_name;
    if (db) result.fields.database = String(db).trim();
  }

  let latencyMs = null;
  let probeError = null;
  let probeWarning = null;
  if (result.status === "success" && authSchema.length > 0) {
    const probe = getProbe(providerKey, provider);
    if (probe) {
      const probeResult = await probe(result.fields);
      if (!probeResult.ok) {
        result.status = "failed";
        probeError = probeResult.error;
      } else {
        latencyMs = probeResult.latencyMs ?? null;
        probeWarning = probeResult.warning ?? null;
      }
    }
  }

  await CredentialRepository.recordVerification(row.id, {
    status: result.status,
    error: result.error || probeError,
    latencyMs,
    verifiedBy: actorId,
  });
  await AuditRepository.log({
    companyId: row.company_id,
    actorType: "admin",
    actorId,
    action: `credential.verified.${result.status}`,
    entityType: "credential",
    entityId: row.id,
    afterState: { last_verification_status: result.status },
    reason: "verification probe",
  });

  return {
    status: result.status,
    error: result.error || probeError,
    latencyMs,
    warning: result.warning || probeWarning,
  };
}


// POST /gateway/credentials/test-batch — 9Router "Test All" flow.
// Body: { companyKey, group? | providerKey? }
//   group: "custom" | "oauth" | "apikey" (section ids from the Providers
//   page) — tests every ACTIVE credential of the company in that section.
//   providerKey: test just that provider's credentials instead.
// Runs the same decrypt → schema-validate → live-probe pipeline as the
// per-credential verify endpoint (recording + auditing each result), then
// returns a summary + per-credential results for the results modal.
router.post(
  "/credentials/test-batch",
  wrap(async (req, res) => {
    const { companyKey, group, providerKey } = req.body || {};
    if (!companyKey) {
      return res.status(400).json({ success: false, error: "companyKey is required." });
    }
    const company = await CompanyRepository.findByKey(companyKey);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${companyKey}' not found.` });
    }

    const rows = await CredentialRepository.listByCompany(company.id);
    const providers = await Registry.listProviders();
    const authByKey = new Map(providers.map((p) => [p.providerKey, p.authType]));
    const sectionOf = (key) => {
      if (key.startsWith("oc_") || key.startsWith("ac_")) return "custom";
      return authByKey.get(key) === "oauth2" ? "oauth" : "apikey";
    };

    let targets = rows;
    if (providerKey) {
      targets = rows.filter((r) => r.provider_key === providerKey);
    } else if (group) {
      targets = rows.filter((r) => sectionOf(r.provider_key) === group);
    }

    const results = [];
    for (const row of targets) {
      const r = await runVerify(row, req.auth?.user || null);
      results.push({
        credentialId: row.id,
        credentialName: row.credential_name,
        providerKey: row.provider_key,
        valid: r.status === "success",
        latencyMs: r.latencyMs,
        error: r.error,
        diagnosis: r.status === "success" ? null : diagnoseError(r.error, row.provider_key),
      });
    }

    const passed = results.filter((r) => r.valid).length;
    return res.json({
      success: true,
      mode: providerKey ? "provider" : group || "all",
      summary: { total: results.length, passed, failed: results.length - passed },
      results,
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

    const result = await runVerify(row, req.auth?.user || null);

    return res.json({
      success: result.status === "success",
      status: result.status,
      error: result.error,
      latencyMs: result.latencyMs,
      warning: result.warning,
    });
  })
);

// POST /gateway/companies/:key/connections/test — 9Router-style "Check" flow.
// Tests UNSAVED credential fields against the provider's auth schema + live
// probe (if the provider has one), so the modal can verify before creating the
// credential. Purely read-only: nothing is persisted, nothing is audited.
// Body: { providerKey, fields: { ... } }
router.post(
  "/companies/:key/connections/test",
  wrap(async (req, res) => {
    const company = await CompanyRepository.findByKey(req.params.key);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${req.params.key}' not found.` });
    }

    const { providerKey, fields = {} } = req.body || {};
    if (!providerKey) {
      return res.status(400).json({ success: false, error: "providerKey is required." });
    }

    const provider = await Registry.getProvider(providerKey);
    if (!provider) {
      return res.status(400).json({ success: false, error: `Unknown provider '${providerKey}'.` });
    }
    const authSchema = provider.authForm || [];

    // Neo4j: pre-save Check injects the company's graph_database resource name
    // when the form doesn't carry one, so the live probe verifies the actual
    // database (the auth schema has no database field — it lives on resources).
    if (providerKey === "neo4j" && !fields.database) {
      const graphs = await ResourceRepository.listByCompany(company.id, { resourceType: "graph_database" });
      const db = graphs[0]?.config?.database_name;
      if (db) fields.database = String(db).trim();
    }

    const validation = CredentialService.validateFieldsAgainstSchema(fields || {}, authSchema);
    if (!validation.ok) {
      return res.status(200).json({
        success: false,
        status: "failed",
        error: Object.values(validation.errors).join(" "),
        errors: validation.errors,
        latencyMs: null,
        checkedAt: new Date().toISOString(),
      });
    }

    // Live probe (hand-written override or schema-driven generic — same source
    // as the post-save verify endpoint). Providers with neither only get
    // format-level validation.
    const probe = getProbe(providerKey, provider);
    let latencyMs = null;
    let probeError = null;
    let probeWarning = null;
    if (probe) {
      const probeResult = await probe(fields || {});
      if (!probeResult.ok) {
        probeError = probeResult.error;
      } else {
        latencyMs = probeResult.latencyMs ?? null;
        probeWarning = probeResult.warning ?? null;
      }
    }

    const ok = !probeError;
    return res.json({
      success: ok,
      status: ok ? "success" : "failed",
      error: probeError,
      latencyMs,
      checkedAt: new Date().toISOString(),
      warning:
        probeWarning ||
        (!authSchema.length ? "This provider has no auth schema — format-level check only." : undefined),
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

    // Rotated fields may have changed — mirror them into the RAG config store.
    const company = await CompanyRepository.findById(row.company_id);
    if (company) {
      await syncRagCredentials(company.company_key, { ...existing, ...(req.body?.fields || {}) }, { providerKey });
    }
    await AuditRepository.log({
      companyId: row.company_id,
      ...actorFromReq(req),
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
    let merged = null;
    // Hoisted so the RAG-sync hook below can scope neo4j field mapping to the
    // provider (the provider lookup only runs when secrets actually change).
    let providerKey = null;
    const provided = Object.fromEntries(
      Object.entries(body.fields || {}).filter(([, v]) => String(v).trim() !== "")
    );
    if (Object.keys(provided).length > 0) {
      providerKey = await Registry.providerKeyById(row.provider_id);
      const provider = providerKey ? await Registry.getProvider(providerKey) : null;
      // Never re-encrypt without a schema: an empty encrypt map would write
      // the merged fields as PLAINTEXT (codec pass-through). Mirror the POST
      // create guard instead of silently downgrading stored secrets.
      if (!provider) {
        return res.status(400).json({ success: false, error: `Unknown provider for credential '${row.credential_key}'.` });
      }
      const authSchema = provider?.authForm || [];
      const existing = CredentialService.decryptCredential(row.encrypted_credentials);
      merged = { ...existing, ...provided };
      const validation = CredentialService.validateFieldsAgainstSchema(merged, authSchema);
      if (!validation.ok) {
        return res.status(400).json({ success: false, error: "Invalid credential fields.", errors: validation.errors });
      }
      const encryptMap = CredentialService.buildEncryptMap(authSchema);
      ({ blob: encryptedCredentials } = CredentialService.encryptCredential(merged, encryptMap));
    }

    const credentialName = body.credentialName ?? row.credential_name;
    const isDefault = body.isDefault ?? !!row.is_default;
    // Only flip is_active when the body carries it — the repository treats
    // undefined as "keep the stored value" (findWithEncrypted doesn't select
    // is_active, so it can never be a safe default here).
    const isActive = body.isActive !== undefined ? !!body.isActive : undefined;
    const beforeState = {
      credential_key: row.credential_key,
      credential_name: row.credential_name,
      environment_id: row.environment_id,
      is_default: !!row.is_default,
    };

    let updated;
    try {
      updated = await CredentialRepository.update(row.id, {
        credentialName,
        environmentId,
        config: body.config !== undefined ? body.config : row.config,
        priority: body.priority ?? row.priority,
        isDefault,
        isActive,
        rotationPolicy: body.rotationPolicy ?? row.rotation_policy,
        autoRotateEnabled: body.autoRotateEnabled ?? !!row.auto_rotate_enabled,
        encryptedCredentials,
        updatedBy: req.auth?.user || null,
      });
    } catch (err) {
      if (isDupEntry(err)) {
        // The credential key itself never changes on update — a collision can
        // only come from moving the credential into an environment that
        // already holds a credential with the same key for this provider.
        throw new ConflictError(
          `This provider already has a credential with key '${row.credential_key}' in the target environment — pick a different environment.`,
          "CREDENTIAL_KEY_EXISTS"
        );
      }
      throw err;
    }
    if (!updated) {
      return res.status(404).json({ success: false, error: "Credential not found." });
    }

    // Mirror the merged secret fields into the RAG config store when secrets
    // actually changed (metadata-only edits skip the sync). Runs only after the
    // credential row committed — a failed update must not leak into the RAG store.
    if (encryptedCredentials) {
      const company = await CompanyRepository.findById(row.company_id);
      if (company) await syncRagCredentials(company.company_key, merged, { providerKey });
    }

    await AuditRepository.log({
      companyId: row.company_id,
      ...actorFromReq(req),
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
    // KB-binding guard: deleting the connection would break every KB bound to
    // one of this credential's resources (ingest fails with "Vector store is
    // not configured" once the resource's credential can no longer resolve).
    // The credential is still live here, so listByCompany sees all its rows.
    const credResources = (await ResourceRepository.listByCompany(row.company_id)).filter(
      (r) => r.credential_id === row.id
    );
    for (const resource of credResources) {
      await assertResourceNotKbBound(resource, "Resource");
    }
    await CredentialRepository.remove(row.id);
    await AuditRepository.log({
      companyId: row.company_id,
      ...actorFromReq(req),
      action: "credential.deleted",
      entityType: "credential",
      entityId: row.id,
      afterState: { credential_key: row.credential_key },
      reason: "admin action",
      isSensitive: true,
    });

    // Clear the RAG config keys this connection provided (unless a remaining
    // connection still provides them). Best-effort.
    try {
      const removedFields = CredentialService.decryptCredential(row.encrypted_credentials);
      const providerKey = await Registry.providerKeyById(row.provider_id);
      await clearRagCredentials(row.company_id, removedFields, { providerKey });
    } catch {
      /* malformed blob — nothing to clear */
    }
    return res.json({ success: true, message: "Credential deleted." });
  })
);

// ============================================================
// 4. MODEL ACCESS
// ============================================================

// POST /gateway/credentials/model-access/bulk — 9Router "Disable All" (and
// its inverse) for one provider: flips is_enabled on EVERY model-access
// grant of the company's credentials for that provider in one UPDATE.
// Body: { companyKey, providerKey, enabled? (default false) }
// Only grants that already exist are affected — granting a model creates its
// row (per-credential ModelsModal), so a never-granted model has nothing to
// disable. Audits one model_access.bulk_updated row per action.
router.post(
  "/credentials/model-access/bulk",
  wrap(async (req, res) => {
    const { companyKey, providerKey, enabled = false } = req.body || {};
    if (!companyKey || !providerKey) {
      return res.status(400).json({ success: false, error: "companyKey and providerKey are required." });
    }
    const company = await CompanyRepository.findByKey(companyKey);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${companyKey}' not found.` });
    }
    const provider = await Registry.getProvider(providerKey);
    if (!provider) {
      return res.status(400).json({ success: false, error: `Unknown provider '${providerKey}'.` });
    }

    const affected = await ResourceRepository.setModelAccessByProvider(company.id, provider.id, {
      enabled: !!enabled,
    });
    await AuditRepository.log({
      companyId: company.id,
      ...actorFromReq(req),
      action: "model_access.bulk_updated",
      entityType: "credential_model_access",
      entityId: null,
      afterState: {
        provider_key: providerKey,
        enabled: !!enabled,
        affected_grants: affected,
      },
      reason: "admin action (9Router Disable All)",
    });

    return res.json({
      success: true,
      message: `${enabled ? "Enabled" : "Disabled"} ${affected} model-access grant(s) for '${providerKey}'.`,
      affected,
    });
  })
);

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
      ...actorFromReq(req),
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
