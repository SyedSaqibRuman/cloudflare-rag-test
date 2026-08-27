// --------------------------
// companies routes (Clean Architecture: one router per resource group).
// Extracted verbatim from the former mysql/gateway-router.js monolith.
// --------------------------
import express from "express";
import {
  CompanyRepository,
  ResourceRepository,
  AuditRepository,
} from "../repositories.js";
import { wrap } from "./helpers.js";
import { parsePagination, paginate } from "./pagination.js";
import { actorFromReq, requireCompany } from "./shared-helpers.js";

const router = express.Router();


// GET /gateway/companies
router.get(
  "/companies",
  wrap(async (req, res) => {
    const companies = await CompanyRepository.list();
    const pagination = parsePagination(req);
    return paginate(res, companies, pagination, "companies", "/gateway/companies");
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
    // Seed the standard Development/Staging/Production environments so new
    // companies start with the Environment -> Credential hierarchy from day one.
    const environments = await CompanyRepository.ensureDefaultEnvironments(company.id);
    await AuditRepository.log({
      companyId: company.id,
      ...actorFromReq(req),
      action: "company.created",
      entityType: "company",
      entityId: company.id,
      afterState: { company_key: company.company_key, environments: environments.map((e) => e.env_key) },
      reason: "admin action",
    });
    return res.status(201).json({ success: true, company, environments });
  })
);

// GET /gateway/companies/:key — detail + environments
router.get(
  "/companies/:key",
  wrap(async (req, res) => {
    const company = await requireCompany(req.params.key);
    const environments = await CompanyRepository.environments(company.id);
    return res.json({ success: true, company: { ...company, environments } });
  })
);

// POST /gateway/companies/:key/environments
// Body: { envKey, envName, description?, isProduction?, sortOrder? }
const ENV_KEY_RE = /^[a-z0-9_-]{1,50}$/;
const envKeyFromBody = (body, res) => {
  const envKey = String(body?.envKey || "").trim();
  if (!ENV_KEY_RE.test(envKey)) {
    res.status(400).json({ success: false, error: `envKey is required and must match ${ENV_KEY_RE}.` });
    return null;
  }
  return envKey;
};

router.post(
  "/companies/:key/environments",
  wrap(async (req, res) => {
    const company = await requireCompany(req.params.key);
    const envKey = envKeyFromBody(req.body, res);
    if (!envKey) return;
    const envName = String(req.body?.envName || "").trim();
    if (!envName) {
      return res.status(400).json({ success: false, error: "envName is required." });
    }

    const existing = await CompanyRepository.environments(company.id);
    if (existing.some((e) => e.env_key === envKey)) {
      return res.status(409).json({ success: false, error: `Environment '${envKey}' already exists.` });
    }

    try {
      const id = await CompanyRepository.createEnvironment(company.id, {
        envKey,
        envName,
        description: req.body?.description || null,
        isProduction: req.body?.isProduction,
        sortOrder: req.body?.sortOrder === undefined ? undefined : Number(req.body.sortOrder),
      });
      await AuditRepository.log({
        companyId: company.id,
        ...actorFromReq(req),
        action: "environment.created",
        entityType: "environment",
        entityId: id,
        afterState: { company_key: company.company_key, env_key: envKey },
        reason: "admin action",
      });
      return res.status(201).json({ success: true, environment: { id, env_key: envKey, env_name: envName } });
    } catch (err) {
      if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ success: false, error: `Environment '${envKey}' already exists.` });
      }
      throw err;
    }
  })
);

// PUT /gateway/companies/:key/environments/:envKey — update name/description/flags
router.put(
  "/companies/:key/environments/:envKey",
  wrap(async (req, res) => {
    const company = await requireCompany(req.params.key);
    const envKey = String(req.params.envKey || "");
    if (!ENV_KEY_RE.test(envKey)) {
      return res.status(400).json({ success: false, error: `Invalid environment key '${envKey}'.` });
    }
    const envName = String(req.body?.envName || "").trim();
    if (!envName) {
      return res.status(400).json({ success: false, error: "envName is required." });
    }
    const updated = await CompanyRepository.updateEnvironment(company.id, envKey, {
      envName,
      description: req.body?.description || null,
      isProduction: req.body?.isProduction,
      sortOrder: req.body?.sortOrder === undefined ? undefined : Number(req.body.sortOrder),
    });
    if (!updated) {
      return res.status(404).json({ success: false, error: `Environment '${envKey}' not found.` });
    }
    await AuditRepository.log({
      companyId: company.id,
      ...actorFromReq(req),
      action: "environment.updated",
      entityType: "environment",
      entityId: null,
      afterState: { company_key: company.company_key, env_key: envKey, env_name: envName },
      reason: "admin action",
    });
    return res.json({ success: true, environment: { env_key: envKey, env_name: envName } });
  })
);

// DELETE /gateway/companies/:key/environments/:envKey — soft delete (deleted_at +
// is_active=false). Credentials that referenced it keep their row but resolve as
// unassigned (the LEFT JOINs drop the deleted environment).
router.delete(
  "/companies/:key/environments/:envKey",
  wrap(async (req, res) => {
    const company = await requireCompany(req.params.key);
    const envKey = String(req.params.envKey || "");
    if (!ENV_KEY_RE.test(envKey)) {
      return res.status(400).json({ success: false, error: `Invalid environment key '${envKey}'.` });
    }
    const deleted = await CompanyRepository.deleteEnvironment(company.id, envKey);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `Environment '${envKey}' not found.` });
    }
    await AuditRepository.log({
      companyId: company.id,
      ...actorFromReq(req),
      action: "environment.deleted",
      entityType: "environment",
      entityId: null,
      afterState: { company_key: company.company_key, env_key: envKey },
      reason: "admin action",
    });
    return res.json({ success: true, message: `Environment '${envKey}' deleted.` });
  })
);

// GET /gateway/companies/:key/resources
router.get(
  "/companies/:key/resources",
  wrap(async (req, res) => {
    const company = await requireCompany(req.params.key);
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
    const company = await requireCompany(req.params.key);
    const entries = await AuditRepository.listByCompany(company.id, {
      limit: req.query.limit || 100,
    });
    return res.json({ success: true, companyKey: company.company_key, entries });
  })
);


export default router;
