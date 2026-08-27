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


export default router;
