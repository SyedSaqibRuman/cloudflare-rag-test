// --------------------------
// SYSTEM PROMPT ROUTES (/cloudflare/prompt)
// --------------------------
import express from "express";

import {
  getConfig,
  updateConfig,
  resetPrompt,
  resolvePromptVariables,
  validateConfigKey,
} from "../../config/index.js";

import { companyFromHeader } from "./helpers.js";

const router = express.Router();

// GET /cloudflare/prompt
router.get("/", (req, res) => {
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
router.put("/", async (req, res) => {
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

    const result = await updateConfig({ SYSTEM_PROMPT: template.trim() }, companyName);
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
router.post("/reset", async (req, res) => {
  try {
    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const result = await resetPrompt(companyName);
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
