// --------------------------
// RUNTIME CONFIG ROUTES (/cloudflare/config)
// --------------------------
import express from "express";

import {
  getConfig,
  updateConfig,
  resetConfig,
  CONFIG_SECTIONS,
  PROMPT_VARIABLE_KEYS,
} from "../../config/index.js";

import { companyFromHeader } from "./helpers.js";

const router = express.Router();

// GET /cloudflare/config
// Returns the current runtime config for the specified company.
router.get("/", (req, res) => {
  const companyName = companyFromHeader(req, res);
  if (!companyName) return;
  const c = getConfig(companyName);
  const config = {};
  for (const { section, keys } of CONFIG_SECTIONS) {
    config[section] = {};
    for (const key of keys) {
      // PROMPT_VARIABLES is an array of {key,value} — return it as such rather
      // than the `?? ""` string fallback used for scalar keys, so the Config
      // page can render an editor instead of a text input.
      config[section][key] = PROMPT_VARIABLE_KEYS.includes(key)
        ? (c[key] || [])
        : (c[key] ?? "");
    }
  }
  config.AUTH = { API_KEY_ENABLED: !!c.API_KEY };
  return res.json({ success: true, config });
});

// PUT /cloudflare/config
// Update runtime config values for a company.
router.put("/", async (req, res) => {
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
});

// POST /cloudflare/config/reset
// DESTRUCTIVE: wipes every tenant's database and resets all config to defaults.
// Requires an explicit confirmation field so a stray/replayed request cannot
// take out all companies in one unconfirmed call.
router.post("/reset", async (req, res) => {
  if (req.body?.confirm !== "reset-all-companies") {
    return res.status(400).json({
      success: false,
      error:
        'This deletes ALL companies and their persisted config. Re-send with body { "confirm": "reset-all-companies" } to proceed.',
    });
  }

  const config = await resetConfig();

  console.log("🗑 Config reset to env defaults");

  return res.json({
    success: true,
    message: "Config reset to env defaults.",
    config,
  });
});

export default router;
