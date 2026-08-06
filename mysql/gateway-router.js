// --------------------------
// GATEWAY ROUTER — AI Gateway platform layer (MySQL)
// Mounted at /gateway (behind requireAdmin, like /cloudflare). Everything
// here reads/writes the MySQL catalog + tenant tables through the repository
// layer — never raw SQL in routes. When MySQL is not configured in .env,
// every route answers 503 so the rest of the app keeps working.
// --------------------------
import express from "express";
import { env } from "../env.js";
import { isMysqlConfigured, pingDb } from "./pool.js";
import {
  ProviderRepository,
  ModelRepository,
  CompanyRepository,
  CredentialRepository,
  ResourceRepository,
  AuditRepository,
} from "./repositories.js";
import * as Registry from "./services/provider-registry.js";
import * as CredentialService from "./services/credential-service.js";

const router = express.Router();

// Async handler wrapper — Express 5 forwards rejected promises, but keeping
// the uniform { success, error } shape here matches the rest of the API.
const wrap = (fn) => (req, res) => {
  fn(req, res).catch((err) => {
    console.error("❌ /gateway error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
};

// Every gateway route requires a configured database.
const gate = (req, res, next) => {
  if (!isMysqlConfigured()) {
    return res.status(503).json({
      success: false,
      error:
        "MySQL gateway layer is not configured. Set MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE in .env and run: node mysql/migrate.js",
    });
  }
  next();
};

router.use(gate);

// ============================================================
// 0. HEALTH
// ============================================================

// GET /gateway/health — DB connectivity probe (also forces pool creation)
router.get(
  "/health",
  wrap(async (_req, res) => {
    await pingDb();
    return res.json({
      success: true,
      configured: true,
      database: env.MYSQL_DATABASE,
      registryLoaded: Registry.isRegistryLoaded(),
      connected: true,
    });
  })
);

// ============================================================
// 1. PROVIDER CATALOG (read-only from routes)
// ============================================================

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

// ============================================================
// 2. COMPANIES
// ============================================================

// GET /gateway/companies
router.get(
  "/companies",
  wrap(async (_req, res) => {
    const companies = await CompanyRepository.list();
    return res.json({ success: true, companies });
  })
);

// POST /gateway/companies — { companyKey, companyName, planTier?, ... }
router.post(
  "/companies",
  wrap(async (req, res) => {
    const { companyKey, companyName, planTier, maxKnowledgeBases, maxAssistants } = req.body || {};
    if (!companyKey?.trim() || !/^[a-z0-9_]+$/.test(companyKey)) {
      return res.status(400).json({
        success: false,
        error: "companyKey is required and must match /^[a-z0-9_]+$/.",
      });
    }
    if (!companyName?.trim()) {
      return res.status(400).json({ success: false, error: "companyName is required." });
    }
    if (await CompanyRepository.findByKey(companyKey)) {
      return res.status(409).json({ success: false, error: `Company '${companyKey}' already exists.` });
    }
    const company = await CompanyRepository.create({
      companyKey,
      companyName,
      planTier,
      maxKnowledgeBases,
      maxAssistants,
    });
    await AuditRepository.log({
      companyId: company.id,
      actorType: "admin",
      actorId: req.auth?.user || null,
      action: "company.created",
      entityType: "company",
      entityId: company.id,
      afterState: { company_key: company.company_key },
      reason: "admin action",
    });
    return res.status(201).json({ success: true, company });
  })
);

// GET /gateway/companies/:key — detail + environments
router.get(
  "/companies/:key",
  wrap(async (req, res) => {
    const company = await CompanyRepository.findByKey(req.params.key);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${req.params.key}' not found.` });
    }
    const environments = await CompanyRepository.environments(company.id);
    return res.json({ success: true, company: { ...company, environments } });
  })
);

// GET /gateway/companies/:key/resources
router.get(
  "/companies/:key/resources",
  wrap(async (req, res) => {
    const company = await CompanyRepository.findByKey(req.params.key);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${req.params.key}' not found.` });
    }
    const resources = await ResourceRepository.listByCompany(company.id, {
      resourceType: req.query.type || null,
    });
    return res.json({ success: true, companyKey: company.company_key, resources });
  })
);

// GET /gateway/companies/:key/audit
router.get(
  "/companies/:key/audit",
  wrap(async (req, res) => {
    const company = await CompanyRepository.findByKey(req.params.key);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${req.params.key}' not found.` });
    }
    const entries = await AuditRepository.listByCompany(company.id, {
      limit: req.query.limit || 100,
    });
    return res.json({ success: true, companyKey: company.company_key, entries });
  })
);

// ============================================================
// 3. CREDENTIALS (encrypted at rest, never returned decrypted)
// ============================================================

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

// ============================================================
// LIVE PROBES (verify endpoint)
// Add a probe per provider_key to get connectivity checks beyond format
// validation. Probes receive the decrypted credential fields and must return
// { ok, latencyMs?, error? }.
// ============================================================
const PROBES = {
  async cloudflare(fields) {
    const token = fields.api_token || fields.api_key;
    if (!token) {
      return { ok: false, error: "Cloudflare API token missing." };
    }
    const start = Date.now();
    try {
      const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok || body.success !== true) {
        return { ok: false, error: body.errors?.[0]?.message || `Cloudflare returned HTTP ${res.status}.` };
      }
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, error: `Network error: ${err.message}` };
    }
  },
};

export default router;
