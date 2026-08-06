import express from "express";

import {
  listVectors,
  findVector,
  createVectorIndex,
  deleteVectorIndex,
} from "../services/vectorize.js";

import {
  listBuckets,
  createBucket,
  deleteBucket,
  clearBucket,
} from "../services/r2.js";

import {
  getConfig,
  updateConfig,
  resetConfig,
  resetPrompt,
  resetCompanyConfig,
  CONFIG_SECTIONS,
  resolvePromptVariables,
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
  setCompanyApiKey,
  generateApiKey,
  validateConfigKey,
} from "../config/index.js";
import { env } from "../env.js";
import { companyFromRequest } from "../utils/request-context.js";

const router = express.Router();

function validateResourceName(name) {
  if (!name?.trim()) {
    return "Name is required.";
  }

  const normalized = name.trim();

  if (!/^[a-z0-9-]+$/.test(normalized)) {
    return "Name must contain only lowercase letters, numbers, and hyphens.";
  }

  if (normalized.length < 3 || normalized.length > 63) {
    return "Name must be between 3 and 63 characters.";
  }

  return null;
}

// Index/bucket/config/prompt routes resolve the company from the header,
// ?company= query, or body.company (see utils/request-context.js). Without a
// company there is nothing to resolve against, so fail fast with a clear 400
// instead of letting the Cloudflare SDK throw an auth error.
function companyFromHeader(req, res) {
  const { companyName, error } = companyFromRequest(req, { query: true, body: true });
  if (error) {
    res.status(400).json({ success: false, error });
    return null;
  }
  return companyName;
}

// ============================================================
// 0. COMPANY MANAGEMENT
// ============================================================

// GET /cloudflare/companies
// List all companies with summary.
router.get("/companies", (req, res) => {
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
router.post("/companies", (req, res) => {
  try {
    const { name, config: patch } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, error: "Company name is required." });
    }

    const result = createCompany(name, patch);

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
router.get("/companies/:name", (req, res) => {
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
router.put("/companies/:name", (req, res) => {
  try {
    const result = updateCompany(req.params.name, req.body);

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
router.delete("/companies/:name", (req, res) => {
  try {
    const result = deleteCompany(req.params.name);

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
router.post("/companies/:name/reset", (req, res) => {
  try {
    const result = resetCompanyConfig(req.params.name);

    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }

    return res.json({ success: true, message: `Company '${req.params.name}' reset to defaults.`, config: result.config });
  } catch (err) {
    console.error("❌ POST /companies/:name/reset error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 0b. API KEY MANAGEMENT (gates /ask and /ask-stream only)
// ============================================================

// POST /cloudflare/companies/:name/apikey
// Generate (or rotate) the company's API key. The key is returned exactly once.
router.post("/companies/:name/apikey", (req, res) => {
  try {
    const apiKey = generateApiKey();
    const result = setCompanyApiKey(req.params.name, apiKey);
    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }
    return res.json({ success: true, apiKey, message: "API key generated. It will only be shown this once." });
  } catch (err) {
    console.error("❌ POST /companies/:name/apikey error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /cloudflare/companies/:name/apikey
// Revoke the company's API key (ask/ask-stream become open again).
router.delete("/companies/:name/apikey", (req, res) => {
  try {
    const result = setCompanyApiKey(req.params.name, null);
    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }
    return res.json({ success: true, message: `API key revoked for '${req.params.name}'.` });
  } catch (err) {
    console.error("❌ DELETE /companies/:name/apikey error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /cloudflare/companies/:name/apikey
// Check whether the company has an API key set (never returns the key itself).
router.get("/companies/:name/apikey", (req, res) => {
  try {
    const config = getCompany(req.params.name);
    if (!config) {
      return res.status(404).json({ success: false, error: `Company '${req.params.name}' not found.` });
    }
    return res.json({ success: true, hasApiKey: !!config.API_KEY });
  } catch (err) {
    console.error("❌ GET /companies/:name/apikey error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 1. VECTORIZE INDEXES
// ============================================================

// GET /cloudflare/indexes
router.get("/indexes", async (req, res) => {
  try {
    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const indexes = await listVectors(companyName);
    return res.json({ success: true, indexes });
  } catch (err) {
    console.error("❌ GET /indexes error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /cloudflare/indexes
router.post("/indexes", async (req, res) => {
  try {
    const { name, dimensions } = req.body;

    const nameError = validateResourceName(name);
    if (nameError) {
      return res.status(400).json({ success: false, error: nameError });
    }

    if (dimensions !== undefined && (typeof dimensions !== "number" || dimensions <= 0)) {
      return res.status(400).json({ success: false, error: "dimensions must be a positive number." });
    }

    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const existing = await findVector(name, companyName);
    if (existing) {
      return res.status(200).json({ success: true, index: existing, message: "Index already exists." });
    }

    const index = await createVectorIndex(name, companyName, dimensions);
    return res.status(201).json({ success: true, index });
  } catch (err) {
    console.error("❌ POST /indexes error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /cloudflare/indexes/:name
router.delete("/indexes/:name", async (req, res) => {
  try {
    const { name } = req.params;

    const nameError = validateResourceName(name);
    if (nameError) {
      return res.status(400).json({ success: false, error: nameError });
    }

    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const existing = await findVector(name, companyName);
    if (!existing) {
      return res.status(404).json({ success: false, error: `Index '${name}' not found.` });
    }

    const result = await deleteVectorIndex(name, companyName);
    return res.json({ success: true, message: result });
  } catch (err) {
    console.error("❌ DELETE /indexes/:name error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 2. R2 BUCKETS
// ============================================================

// GET /cloudflare/buckets
router.get("/buckets", async (req, res) => {
  try {
    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const buckets = await listBuckets(companyName);
    return res.json({ success: true, buckets });
  } catch (err) {
    console.error("❌ GET /buckets error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /cloudflare/buckets
router.post("/buckets", async (req, res) => {
  try {
    const { name } = req.body;

    const nameError = validateResourceName(name);
    if (nameError) {
      return res.status(400).json({ success: false, error: nameError });
    }

    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const bucket = await createBucket(name, companyName);
    if (!bucket) {
      return res.status(500).json({ success: false, error: "Failed to create bucket." });
    }
    return res.status(201).json({ success: true, bucket });
  } catch (err) {
    console.error("❌ POST /buckets error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /cloudflare/buckets/:name
router.delete("/buckets/:name", async (req, res) => {
  try {
    const { name } = req.params;

    const nameError = validateResourceName(name);
    if (nameError) {
      return res.status(400).json({ success: false, error: nameError });
    }

    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const result = await deleteBucket(name, companyName);
    if (!result) {
      return res.status(404).json({ success: false, error: `Bucket '${name}' not found or could not be deleted.` });
    }
    return res.json({ success: true, message: `Bucket '${name}' deleted.` });
  } catch (err) {
    console.error("❌ DELETE /buckets/:name error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /cloudflare/buckets/:name/clear
router.post("/buckets/:name/clear", async (req, res) => {
  try {
    const { name } = req.params;

    const nameError = validateResourceName(name);
    if (nameError) {
      return res.status(400).json({ success: false, error: nameError });
    }

    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const result = await clearBucket(name, companyName);
    if (!result) {
      return res.status(500).json({ success: false, error: `Failed to clear bucket '${name}'.` });
    }
    return res.json({ success: true, message: `Bucket '${name}' cleared.` });
  } catch (err) {
    console.error("❌ POST /buckets/:name/clear error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 3. RUNTIME CONFIG (active company)
// ============================================================

// GET /cloudflare/config
// Returns the current runtime config for the specified company.
router.get("/config", (req, res) => {
  try {
    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const c = getConfig(companyName);
    const config = {};
    for (const { section, keys } of CONFIG_SECTIONS) {
      config[section] = {};
      for (const key of keys) config[section][key] = c[key] ?? "";
    }
    config.AUTH = { API_KEY_ENABLED: !!c.API_KEY };
    return res.json({ success: true, config });
  } catch (err) {
    console.error("❌ GET /config error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /cloudflare/config
// Update runtime config values for a company.
router.put("/config", (req, res) => {
  try {
    const companyName = companyFromHeader(req, res);
    if (!companyName) return;

    const patch = {};

    // --- Legacy shorthand: { baseUrl } ---
    if (req.body.baseUrl) {
      patch.BASE_URL = req.body.baseUrl;
    }

    // --- Model shorthand: { models: { LLM_MODEL, ... } } ---
    if (req.body.models && typeof req.body.models === "object") {
      Object.assign(patch, req.body.models);
    }

    // --- Generic key/value ---
    if (req.body.key && req.body.value !== undefined) {
      patch[req.body.key] = String(req.body.value);
    }

    // Validate + apply through the single write path (updateConfig → updateCompany),
    // which rejects unknown keys and auto-follows EMBEDDING_DIMENSIONS from
    // EMBEDDING_MODEL — no inline re-derivation here.

    const result = updateConfig(patch, companyName);

    if (result.errors?.length) {
      return res.status(400).json({ success: false, errors: result.errors });
    }

    console.log(`✅ Config updated:`, Object.keys(patch).join(", "));

    return res.json({
      success: true,
      message: "Config updated.",
      config: result.config,
    });
  } catch (err) {
    console.error("❌ PUT /config error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /cloudflare/config/reset
router.post("/config/reset", (req, res) => {
  try {
    const config = resetConfig();

    console.log("🗑 Config reset to env defaults");

    return res.json({
      success: true,
      message: "Config reset to env defaults.",
      config,
    });
  } catch (err) {
    console.error("❌ POST /config/reset error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 4. SYSTEM PROMPT
// ============================================================

// GET /cloudflare/prompt
router.get("/prompt", (req, res) => {
  try {
    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const config = getConfig(companyName);
    const template = config.SYSTEM_PROMPT || "";
    const resolved = resolvePromptVariables(template, config);
    return res.json({
      success: true,
      prompt: {
        template,
        resolved,
        variables: {
          CONSULTANT_NAME: config.CONSULTANT_NAME,
          COMPANY_NAME: config.COMPANY_NAME,
          CONTACT_US_URL: config.CONTACT_US_URL,
          LOCATIONS_URL: config.LOCATIONS_URL,
          SERVICES_URL: config.SERVICES_URL,
          BASE_URL: config.BASE_URL,
        },
      },
    });
  } catch (err) {
    console.error("❌ GET /prompt error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /cloudflare/prompt
router.put("/prompt", (req, res) => {
  try {
    const template = req.body.template || req.body.value;
    if (!template || typeof template !== "string" || !template.trim()) {
      return res.status(400).json({ success: false, error: "template must be a non-empty string." });
    }

    const err = validateConfigKey("SYSTEM_PROMPT", template);
    if (err) {
      return res.status(400).json({ success: false, error: err });
    }

    const companyName = companyFromHeader(req, res);
    if (!companyName) return;

    const result = updateConfig({ SYSTEM_PROMPT: template.trim() }, companyName);
    if (result.errors?.length) {
      return res.status(400).json({ success: false, errors: result.errors });
    }

    const config = getConfig(companyName);
    const resolved = resolvePromptVariables(template.trim(), config);
    console.log("✅ System prompt updated");

    return res.json({
      success: true,
      message: "System prompt updated.",
      prompt: {
        template: template.trim(),
        resolved,
      },
    });
  } catch (err) {
    console.error("❌ PUT /prompt error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /cloudflare/prompt/reset
router.post("/prompt/reset", (req, res) => {
  try {
    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const result = resetPrompt(companyName);
    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }
    console.log("🗑 System prompt reset to default");
    return res.json({
      success: true,
      message: "System prompt reset to default.",
      prompt: result,
    });
  } catch (err) {
    console.error("❌ POST /prompt/reset error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
