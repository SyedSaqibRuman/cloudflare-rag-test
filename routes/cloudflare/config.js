// --------------------------
// RUNTIME CONFIG ROUTES (/cloudflare/config)
// --------------------------
import express from "express";

import {
  getConfig,
  updateConfig,
  resetConfig,
  CONFIG_SECTIONS,
} from "../../config/index.js";

import { companyFromHeader } from "./helpers.js";

const router = express.Router();

// GET /cloudflare/config
// Returns the current runtime config for the specified company.
router.get("/", (req, res) => {
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
router.put("/", async (req, res) => {
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

    const result = await updateConfig(patch, companyName);

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
router.post("/reset", async (req, res) => {
  try {
    const config = await resetConfig();

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

export default router;
