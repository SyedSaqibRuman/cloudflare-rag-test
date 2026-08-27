// --------------------------
// EXECUTE ROUTES — run a live provider call through a stored credential
// (9Router executor equivalent, exposed as gateway endpoints). Chat returns
// the provider's completion in a normalized OpenAI-style shape; embeddings
// return the vector arrays. Credentials are resolved by credentialId OR
// providerKey (+ optional credentialKey/environmentKey).
// --------------------------
import express from "express";
import { AuditRepository } from "../repositories.js";
import * as Executor from "../services/provider-executor.js";
import { wrap } from "./helpers.js";
import { actorFromReq } from "./shared-helpers.js";

const router = express.Router();

async function audit(entry) {
  try {
    await AuditRepository.log(entry);
  } catch (err) {
    // audit is best-effort — never mask the execute result
    console.warn("Audit logging failed:", err.message);
  }
}

// POST /gateway/companies/:key/execute/chat
// Body: { credentialId? | providerKey + credentialKey? + environmentKey?,
//         model?, messages: [{ role, content }], options? }
router.post(
  "/companies/:key/execute/chat",
  wrap(async (req, res) => {
    const { credentialId, providerKey, credentialKey, environmentKey, model, messages, options } =
      req.body || {};
    const result = await Executor.executeChat({
      companyKey: req.params.key,
      credentialId,
      providerKey,
      credentialKey,
      environmentKey,
      model,
      messages,
      options,
    });
    await audit({
      companyId: result.companyId,
      ...actorFromReq(req),
      action: "provider.execute.chat",
      entityType: "credential",
      entityId: result.credentialId,
      afterState: { provider_key: result.providerKey, model: result.model },
      reason: "admin action",
      isSensitive: false,
    });
    const { companyId: _companyId, raw: _raw, ...safe } = result;
    return res.json({ success: true, ...safe });
  })
);

// POST /gateway/companies/:key/execute/embeddings
// Body: { credentialId? | providerKey + credentialKey? + environmentKey?,
//         model?, texts: string[] }
router.post(
  "/companies/:key/execute/embeddings",
  wrap(async (req, res) => {
    const { credentialId, providerKey, credentialKey, environmentKey, model, texts } = req.body || {};
    const result = await Executor.executeEmbeddings({
      companyKey: req.params.key,
      credentialId,
      providerKey,
      credentialKey,
      environmentKey,
      model,
      texts,
    });
    await audit({
      companyId: result.companyId,
      ...actorFromReq(req),
      action: "provider.execute.embeddings",
      entityType: "credential",
      entityId: result.credentialId,
      afterState: { provider_key: result.providerKey, model: result.model },
      reason: "admin action",
      isSensitive: false,
    });
    const { companyId: _companyId, raw: _raw, ...safe } = result;
    return res.json({ success: true, ...safe });
  })
);

export default router;
