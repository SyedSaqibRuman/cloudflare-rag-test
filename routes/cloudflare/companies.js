// --------------------------
// COMPANY MANAGEMENT ROUTES (/cloudflare/companies)
// --------------------------
import express from "express";

import {
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
  resetCompanyConfig,
} from "../../config/index.js";

const router = express.Router();

// GET /cloudflare/companies
// List all companies with summary. Enriches each company with the selected
// assistant's name so the UI can show it instead of the legacy CONSULTANT_NAME.
router.get("/", async (req, res) => {
  const companies = listCompanies();
  // Best-effort: resolve the assistant name for companies with ASSISTANT_KEY.
  try {
    const { CompanyRepository, AssistantRepository } = await import("../../mysql/repositories.js");
    for (const c of companies) {
      if (!c.ASSISTANT_KEY) continue;
      const row = await CompanyRepository.findByKey(c.name);
      if (!row) continue;
      const asst = await AssistantRepository.findByKey(row.id, c.ASSISTANT_KEY);
      if (asst?.assistant_name) c.assistantName = asst.assistant_name;
    }
  } catch {
    /* MySQL not configured — companies still list, just without assistant names */
  }
  return res.json({ success: true, companies });
});

// POST /cloudflare/companies
// Create a new company.
// Body: { name, config?: { BASE_URL, LLM_MODEL, ... } }
router.post("/", async (req, res) => {
  const { name, config: patch } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: "Company name is required." });
  }

  const result = await createCompany(name, patch);

  if (result.error) {
    return res.status(400).json({ success: false, error: result.error });
  }

  return res.status(201).json({
    success: true,
    message: `Company '${name.trim()}' created.`,
    config: result.config,
  });
});

// GET /cloudflare/companies/:name
// Get a single company's full config.
// The API key is never returned; hasApiKey indicates whether one is set.
router.get("/:name", (req, res) => {
  const config = getCompany(req.params.name);
  if (!config) {
    return res.status(404).json({ success: false, error: `Company '${req.params.name}' not found.` });
  }
  const { API_KEY, ...publicConfig } = config;
  return res.json({ success: true, config: publicConfig, hasApiKey: !!API_KEY });
});

// PUT /cloudflare/companies/:name
// Update a company's config.
// Body: { BASE_URL, LLM_MODEL, ... }
router.put("/:name", async (req, res) => {
  const result = await updateCompany(req.params.name, req.body);

  if (result.error) {
    return res.status(400).json({ success: false, error: result.error });
  }

  return res.json({
    success: true,
    message: `Company '${req.params.name}' updated.`,
    config: result.config,
  });
});

// DELETE /cloudflare/companies/:name
router.delete("/:name", async (req, res) => {
  const result = await deleteCompany(req.params.name);

  if (result.error) {
    return res.status(400).json({ success: false, error: result.error });
  }

  return res.json({ success: true, message: `Company '${req.params.name}' deleted.` });
});

// POST /cloudflare/companies/:name/reset
// Reset a company's config to env defaults.
router.post("/:name/reset", async (req, res) => {
  const result = await resetCompanyConfig(req.params.name);

  if (result.error) {
    return res.status(400).json({ success: false, error: result.error });
  }

  return res.json({ success: true, message: `Company '${req.params.name}' reset to defaults.`, config: result.config });
});

export default router;
