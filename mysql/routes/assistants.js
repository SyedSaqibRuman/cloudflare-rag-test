// --------------------------
// assistants routes (Clean Architecture: one router per resource group).
// Extracted verbatim from the former mysql/gateway-router.js monolith.
// --------------------------
import express from "express";
import {
  AssistantRepository,
} from "../repositories.js";
import * as AssistantService from "../services/assistant-service.js";
import { requireGatewayCompany } from "../services/company-scope.js";
import { wrap } from "./helpers.js";
import { parsePagination, paginate } from "./pagination.js";
import { actorFromReq } from "./shared-helpers.js";
import { NotFoundError } from "../../shared/errors.js";

const router = express.Router();

router.use("/assistants", requireGatewayCompany);

// GET /gateway/assistants
router.get(
  "/assistants",
  wrap(async (req, res) => {
    const assistants = await AssistantRepository.listByCompany(req.company.id);
    const pagination = parsePagination(req);
    return paginate(res, assistants, pagination, "assistants", "/gateway/assistants");
  })
);

// POST /gateway/assistants
// Body: { assistantKey, assistantName, credentialId, modelId?, primaryKbId?,
//         kbIds?, systemPrompt?, temperature?, maxTokens?,
//         enableFunctionCalling?, enableStreaming?, isPublic? }
router.post(
  "/assistants",
  wrap(async (req, res) => {
    const { assistantId, assistantKey } = await AssistantService.saveAssistant(
      req.company,
      req.body || {},
      actorFromReq(req)
    );
    return res.status(201).json({
      success: true,
      message: `Assistant '${assistantKey}' created.`,
      assistantId,
      assistantKey,
    });
  })
);

// GET /gateway/assistants/:key
router.get(
  "/assistants/:key",
  wrap(async (req, res) => {
    const assistant = await AssistantRepository.findByKey(req.company.id, req.params.key);
    if (!assistant) throw new NotFoundError(`Assistant '${req.params.key}' not found.`);
    return res.json({ success: true, assistant });
  })
);

// PUT /gateway/assistants/:key (assistantKey is the route identity — not editable)
router.put(
  "/assistants/:key",
  wrap(async (req, res) => {
    const { assistantId, assistantKey } = await AssistantService.updateAssistant(
      req.company,
      req.params.key,
      req.body || {},
      actorFromReq(req)
    );
    return res.json({
      success: true,
      message: `Assistant '${assistantKey}' updated.`,
      assistantId,
      assistantKey,
    });
  })
);

// DELETE /gateway/assistants/:key (soft delete)
router.delete(
  "/assistants/:key",
  wrap(async (req, res) => {
    await AssistantService.removeAssistant(req.company, req.params.key, actorFromReq(req));
    return res.json({ success: true, message: `Assistant '${req.params.key}' deleted.` });
  })
);

// POST /gateway/assistants/:key/test — run a test question through the pipeline
router.post(
  "/assistants/:key/test",
  wrap(async (req, res) => {
    const assistant = await AssistantRepository.findByKey(req.company.id, req.params.key);
    if (!assistant) throw new NotFoundError(`Assistant '${req.params.key}' not found.`);
    if (!assistant.is_active) {
      return res.status(400).json({ success: false, error: "Assistant is inactive." });
    }
    const { question, history } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ success: false, error: "question is required." });
    }
    // Dynamically import to avoid circular deps and keep query/ tests zero-dep
    const { askQuestion } = await import("../../query/answer.js");
    const companyName = req.company.company_key;
    // Temporarily set ASSISTANT_KEY in the company config so the pipeline resolves this assistant
    const { getCompanyConfig, updateConfig } = await import("../../config/index.js");
    const prevKey = getCompanyConfig(companyName)?.ASSISTANT_KEY;
    await updateConfig({ ASSISTANT_KEY: assistant.assistant_key }, companyName);
    try {
      const result = await askQuestion(String(question).trim(), history || [], companyName);
      return res.json({
        success: true,
        answer: result.answer,
        sources: result.sources || [],
        cached: result.cached || false,
      });
    } finally {
      // Restore previous ASSISTANT_KEY
      const restore = prevKey ? { ASSISTANT_KEY: prevKey } : {};
      await updateConfig(restore, companyName);
    }
  })
);

// POST /gateway/assistants/:key/duplicate — clone with a new key
router.post(
  "/assistants/:key/duplicate",
  wrap(async (req, res) => {
    const source = await AssistantRepository.findByKey(req.company.id, req.params.key);
    if (!source) throw new NotFoundError(`Assistant '${req.params.key}' not found.`);
    const { newKey, newName } = req.body || {};
    if (!newKey || !String(newKey).trim()) {
      return res.status(400).json({ success: false, error: "newKey is required." });
    }
    const { assistantId, assistantKey } = await AssistantService.saveAssistant(
      req.company,
      {
        assistantKey: newKey.trim(),
        assistantName: newName?.trim() || `${source.assistant_name} (copy)`,
        credentialId: source.credential_id,
        modelId: source.model_id,
        primaryKbId: source.primary_kb_id,
        kbIds: source.kb_ids,
        systemPrompt: source.system_prompt,
        variables: source.assistant_variables,
        temperature: source.temperature,
        maxTokens: source.max_tokens,
        enableFunctionCalling: Boolean(source.enable_function_calling),
        enableStreaming: Boolean(source.enable_streaming),
        tools: source.tools,
        enableGraphContext: Boolean(source.enable_graph_context),
        graphResourceId: source.graph_resource_id,
        isPublic: Boolean(source.is_public),
      },
      actorFromReq(req)
    );
    return res.status(201).json({
      success: true,
      message: `Assistant duplicated as '${assistantKey}'.`,
      assistantId,
      assistantKey,
    });
  })
);

// POST /gateway/assistants/:key/publish — make assistant public
router.post(
  "/assistants/:key/publish",
  wrap(async (req, res) => {
    const assistant = await AssistantRepository.findByKey(req.company.id, req.params.key);
    if (!assistant) throw new NotFoundError(`Assistant '${req.params.key}' not found.`);
    await AssistantRepository.update(assistant.id, { isPublic: true });
    return res.json({ success: true, message: `Assistant '${req.params.key}' is now public.` });
  })
);

// POST /gateway/assistants/:key/unpublish — make assistant private
router.post(
  "/assistants/:key/unpublish",
  wrap(async (req, res) => {
    const assistant = await AssistantRepository.findByKey(req.company.id, req.params.key);
    if (!assistant) throw new NotFoundError(`Assistant '${req.params.key}' not found.`);
    await AssistantRepository.update(assistant.id, { isPublic: false });
    return res.json({ success: true, message: `Assistant '${req.params.key}' is now private.` });
  })
);


export default router;
