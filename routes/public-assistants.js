// --------------------------
// PUBLIC ASSISTANT ROUTES
// Allows accessing published assistants (is_public=true) without admin auth.
// Used by external integrations and the ask-stream API.
// --------------------------
import express from "express";
import { requireGatewayCompany } from "../mysql/services/company-scope.js";
import { wrap } from "../mysql/routes/helpers.js";
import { NotFoundError } from "../shared/errors.js";

const router = express.Router();

// All public routes require a valid company header but NOT admin auth.
router.use(requireGatewayCompany);

// GET /gateway/public/assistants — list public assistants for a company
router.get(
  "/assistants",
  wrap(async (req, res) => {
    const { AssistantRepository } = await import("../mysql/repositories.js");
    const assistants = await AssistantRepository.listByCompany(req.company.id);
    // Only return public, active assistants with minimal info (no credentials).
    const publicAssistants = assistants
      .filter((a) => a.is_public && a.is_active)
      .map((a) => ({
        key: a.assistant_key,
        name: a.assistant_name,
        description: a.description || null,
        model: a.model_key || null,
        primaryKb: a.primary_kb_name || null,
      }));
    return res.json({ success: true, assistants: publicAssistants });
  })
);

// GET /gateway/public/assistants/:key — get a public assistant's public info
router.get(
  "/assistants/:key",
  wrap(async (req, res) => {
    const { AssistantRepository } = await import("../mysql/repositories.js");
    const assistant = await AssistantRepository.findByKey(req.company.id, req.params.key);
    if (!assistant || !assistant.is_public || !assistant.is_active) {
      throw new NotFoundError(`Assistant '${req.params.key}' not found or not public.`);
    }
    return res.json({
      success: true,
      assistant: {
        key: assistant.assistant_key,
        name: assistant.assistant_name,
        description: assistant.description || null,
        model: assistant.model_key || null,
        primaryKb: assistant.primary_kb_name || null,
        enableStreaming: Boolean(assistant.enable_streaming),
      },
    });
  })
);

// POST /gateway/public/assistants/:key/ask — ask a public assistant (non-streaming)
router.post(
  "/assistants/:key/ask",
  wrap(async (req, res) => {
    const { AssistantRepository } = await import("../mysql/repositories.js");
    const assistant = await AssistantRepository.findByKey(req.company.id, req.params.key);
    if (!assistant || !assistant.is_public || !assistant.is_active) {
      throw new NotFoundError(`Assistant '${req.params.key}' not found or not public.`);
    }

    const { question, history } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ success: false, error: "question is required." });
    }

    // The assistant is request-scoped: it is threaded into the pipeline as an
    // override, never written to the company's stored config (that write was a
    // persist-first DB mutation on an unauthenticated route, and its restore was
    // a no-op whenever the company had no prior ASSISTANT_KEY).
    const { askQuestion } = await import("../query/answer.js");
    const companyName = req.company.company_key;

    const result = await askQuestion(String(question).trim(), history || [], companyName, {
      assistantKey: assistant.assistant_key,
    });
    return res.json({
      success: true,
      answer: result.answer,
      sources: result.sources || [],
      cached: result.cached || false,
    });
  })
);

// POST /gateway/public/assistants/:key/stream — ask a public assistant (SSE streaming)
router.post(
  "/assistants/:key/stream",
  wrap(async (req, res) => {
    const { AssistantRepository } = await import("../mysql/repositories.js");
    const assistant = await AssistantRepository.findByKey(req.company.id, req.params.key);
    if (!assistant || !assistant.is_public || !assistant.is_active) {
      throw new NotFoundError(`Assistant '${req.params.key}' not found or not public.`);
    }

    const { question, history } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ success: false, error: "question is required." });
    }

    // Set up SSE headers.
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const { createStreamTransport } = await import("../query/stream-contract.js");
    const transport = createStreamTransport({ write: (chunk) => res.write(chunk) });

    // Request-scoped assistant — see the non-streaming route above.
    const { askQuestionStream } = await import("../query/answer.js");
    const companyName = req.company.company_key;

    try {
      await askQuestionStream(String(question).trim(), history || [], transport, companyName, {
        assistantKey: assistant.assistant_key,
      });
    } finally {
      res.end();
    }
  })
);

export default router;
