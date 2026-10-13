// --------------------------
// API KEY MANAGEMENT ROUTES (/cloudflare/companies/:name/apikey)
// Gates /ask and /ask-stream only.
// --------------------------
import express from "express";

import {
  getCompany,
  setCompanyApiKey,
  generateApiKey,
} from "../../config/index.js";

const router = express.Router();

// POST /cloudflare/companies/:name/apikey
// Generate (or rotate) the company's API key. The key is returned exactly once.
router.post("/:name/apikey", async (req, res) => {
  const apiKey = generateApiKey();
  const result = await setCompanyApiKey(req.params.name, apiKey);
  if (result.error) {
    return res.status(400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, apiKey, message: "API key generated. It will only be shown this once." });
});

// DELETE /cloudflare/companies/:name/apikey
// Revoke the company's API key (ask/ask-stream become open again).
router.delete("/:name/apikey", async (req, res) => {
  const result = await setCompanyApiKey(req.params.name, null);
  if (result.error) {
    return res.status(400).json({ success: false, error: result.error });
  }
  return res.json({ success: true, message: `API key revoked for '${req.params.name}'.` });
});

// GET /cloudflare/companies/:name/apikey
// Check whether the company has an API key set (never returns the key itself).
router.get("/:name/apikey", (req, res) => {
  const config = getCompany(req.params.name);
  if (!config) {
    return res.status(404).json({ success: false, error: `Company '${req.params.name}' not found.` });
  }
  return res.json({ success: true, hasApiKey: !!config.API_KEY });
});

export default router;
