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
import { resolveAssistantOverrides } from "../../query/assistant.js";

import { companyFromHeader } from "./helpers.js";

const router = express.Router();

// GET /cloudflare/prompt
router.get("/", async (req, res) => {
  const companyName = companyFromHeader(req, res);
  if (!companyName) return;
  const config = getConfig(companyName);
  const assistant = await resolveAssistantOverrides(companyName).catch(() => null);
  const template = config.SYSTEM_PROMPT || "";
  const resolved = resolvePromptVariables(template, config, { assistantName: assistant?.assistantName || null });
  return res.json({
    success: true,
    prompt: {
      template,
      resolved,
      variables: {
        CONSULTANT_NAME: assistant?.assistantName || config.CONSULTANT_NAME,
        COMPANY_NAME: config.COMPANY_NAME,
        CONTACT_US_URL: config.CONTACT_US_URL,
        LOCATIONS_URL: config.LOCATIONS_URL,
        SERVICES_URL: config.SERVICES_URL,
        BASE_URL: config.BASE_URL,
      },
    },
  });
});

// PUT /cloudflare/prompt
router.put("/", async (req, res) => {
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
  const assistant = await resolveAssistantOverrides(companyName).catch(() => null);
  const resolved = resolvePromptVariables(template.trim(), config, { assistantName: assistant?.assistantName || null });
  console.log("✅ System prompt updated");

  return res.json({
    success: true,
    message: "System prompt updated.",
    prompt: {
      template: template.trim(),
      resolved,
    },
  });
});

// POST /cloudflare/prompt/reset
router.post("/reset", async (req, res) => {
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
});

export default router;
