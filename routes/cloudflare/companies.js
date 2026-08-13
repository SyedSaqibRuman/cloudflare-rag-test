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
// List all companies with summary.
router.get("/", (req, res) => {
  try {
    const companies = listCompanies();
    return res.json({ success: true, companies });
  } catch (err) {
    console.error("❌ GET /companies error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /cloudflare/companies
// Create a new company.
// Body: { name, config?: { BASE_URL, LLM_MODEL, ... } }
router.post("/", async (req, res) => {
  try {
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
  } catch (err) {
    console.error("❌ POST /companies error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /cloudflare/companies/:name
// Get a single company's full config.
// The API key is never returned; hasApiKey indicates whether one is set.
router.get("/:name", (req, res) => {
  try {
    const config = getCompany(req.params.name);
    if (!config) {
      return res.status(404).json({ success: false, error: `Company '${req.params.name}' not found.` });
    }
    const { API_KEY, ...publicConfig } = config;
    return res.json({ success: true, config: publicConfig, hasApiKey: !!API_KEY });
  } catch (err) {
    console.error("❌ GET /companies/:name error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /cloudflare/companies/:name
// Update a company's config.
// Body: { BASE_URL, LLM_MODEL, ... }
router.put("/:name", async (req, res) => {
  try {
    const result = await updateCompany(req.params.name, req.body);

    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      message: `Company '${req.params.name}' updated.`,
      config: result.config,
    });
  } catch (err) {
    console.error("❌ PUT /companies/:name error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /cloudflare/companies/:name
router.delete("/:name", async (req, res) => {
  try {
    const result = await deleteCompany(req.params.name);

    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }

    return res.json({ success: true, message: `Company '${req.params.name}' deleted.` });
  } catch (err) {
    console.error("❌ DELETE /companies/:name error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /cloudflare/companies/:name/reset
// Reset a company's config to env defaults.
router.post("/:name/reset", async (req, res) => {
  try {
    const result = await resetCompanyConfig(req.params.name);

    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }

    return res.json({ success: true, message: `Company '${req.params.name}' reset to defaults.`, config: result.config });
  } catch (err) {
    console.error("❌ POST /companies/:name/reset error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
