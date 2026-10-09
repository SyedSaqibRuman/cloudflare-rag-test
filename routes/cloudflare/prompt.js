// --------------------------
// SYSTEM PROMPT ROUTES (/cloudflare/prompt)
// --------------------------
import express from "express";

import {
  getConfig,
  updateConfig,
  resetPrompt,
  resolvePromptVariables,
  getPromptVariableMap,
  validateConfigKey,
} from "../../config/index.js";
import { resolveAssistantOverrides } from "../../query/assistant.js";
import { collectPlaceholders } from "../../shared/prompt-variables.js";

import { companyFromHeader } from "./helpers.js";

const router = express.Router();

// GET /cloudflare/prompt
//
// `variables` is the merged CUSTOM variable map (company PROMPT_VARIABLES +
// the selected assistant's assistant_variables, assistant winning) — there are
// no built-in variables any more. `companyVariables` / `assistantVariables`
// expose each tier separately so the portal can show which values an assistant
// is overriding. `missing` lists placeholders the template uses that no tier
// defines; they stay literal in `resolved` so the gap is visible.
router.get("/", async (req, res) => {
  const companyName = companyFromHeader(req, res);
  if (!companyName) return;
  const config = getConfig(companyName);
  const assistant = await resolveAssistantOverrides(companyName).catch(() => null);
  const template = config.SYSTEM_PROMPT || "";
  const resolved = resolvePromptVariables(template, config, {
    assistantName: assistant?.assistantName || null,
    variables: assistant?.variables || [],
  });
  return res.json({
    success: true,
    prompt: {
      template,
      resolved,
      variables: getPromptVariableMap(config, assistant?.variables),
      companyVariables: config.PROMPT_VARIABLES || [],
      assistantVariables: assistant?.variables || [],
      missing: collectPlaceholders(resolved),
    },
  });
});

// PUT /cloudflare/prompt
//
// Body: { template, variables? }. `variables` (an array of {key,value}) is
// optional: when present it is saved as the company's PROMPT_VARIABLES tier in
// the same write, so the portal can save the template and its variable
// definitions atomically. When absent, the existing company variables are kept.
router.put("/", async (req, res) => {
  const template = req.body.template || req.body.value;
  if (!template || typeof template !== "string" || !template.trim()) {
    return res.status(400).json({ success: false, error: "template must be a non-empty string." });
  }

  const err = validateConfigKey("SYSTEM_PROMPT", template);
  if (err) {
    return res.status(400).json({ success: false, error: err });
  }

  const patch = { SYSTEM_PROMPT: template.trim() };
  if (req.body.variables !== undefined) {
    const varErr = validateConfigKey("PROMPT_VARIABLES", req.body.variables);
    if (varErr) {
      return res.status(400).json({ success: false, error: varErr });
    }
    patch.PROMPT_VARIABLES = req.body.variables;
  }

  const companyName = companyFromHeader(req, res);
  if (!companyName) return;

  const result = await updateConfig(patch, companyName);
  if (result.errors?.length) {
    return res.status(400).json({ success: false, errors: result.errors });
  }

  const config = getConfig(companyName);
  const assistant = await resolveAssistantOverrides(companyName).catch(() => null);
  const resolved = resolvePromptVariables(template.trim(), config, {
    assistantName: assistant?.assistantName || null,
    variables: assistant?.variables || [],
  });
  console.log("✅ System prompt updated");

  return res.json({
    success: true,
    message: "System prompt updated.",
    prompt: {
      template: template.trim(),
      resolved,
      variables: getPromptVariableMap(config, assistant?.variables),
      companyVariables: config.PROMPT_VARIABLES || [],
      assistantVariables: assistant?.variables || [],
      missing: collectPlaceholders(resolved),
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
