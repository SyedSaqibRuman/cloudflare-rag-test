import express from "express";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import { askQuestion, askQuestionStream } from "../query/index.js";
import { createStreamTransport } from "../query/stream-contract.js";
import { clearCompanyCache } from "../query/cache.js";
import { getCompanyConfig } from "../config/index.js";
import { companyFromRequest, companyOriginCheck } from "../utils/request-context.js";

// --------------------------
// ASK ROUTES (POST /ask, POST /ask-stream)
// Owns the HTTP contract for the ask endpoints: company gate, per-company
// API-key gate, AI-tier rate limit, validation, SSE framing, and abort
// wiring. app.js just mounts the router — the transport contract lives in
// query/stream-contract.js, the pipeline lives in query/answer.js.
// --------------------------

// Strict limit for AI-powered endpoints: lower than the global baseline
// because each call costs a Cloudflare Workers AI request.
// Exported so other AI-costing routes (/test) can share the same tier.
export const aiLimiter = rateLimit({
  standardHeaders: true,
  legacyHeaders: true,
  validate: { trustProxy: false },
  windowMs: 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: "AI query limit reached. Please wait before sending another question.",
  },
});

// --------------------------
// COMPANY GATE
// Extract x-company-name header and attach to request.
// Required on /ask and /ask-stream — returns 400 if missing.
// --------------------------
export function requireCompany(req, res, next) {
  const { companyName, error } = companyFromRequest(req);
  if (error) {
    return res.status(400).json({ success: false, error });
  }
  req.companyName = companyName;
  next();
}

// --------------------------
// ASK API KEY GATE
// When a company has an API key set (see POST /cloudflare/companies/:name/apikey),
// /ask and /ask-stream require it via the x-api-key header (or Authorization: Bearer).
// Browser requests must also originate from the company's domain: <company>.com or a subdomain.
// Companies without a key stay open (backwards compatible).
// --------------------------
export function requireAskApiKey(req, res, next) {
  const config = getCompanyConfig(req.companyName);
  const expected = config?.API_KEY;
  if (!expected) return next();

  const header = req.headers["x-api-key"];
  const bearer =
    req.headers.authorization && req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "";
  const provided = String(header || bearer || "");

  if (!provided || provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return res.status(401).json({ success: false, error: "Invalid or missing API key." });
  }

  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    const check = companyOriginCheck(origin, req.companyName);
    if (!check.ok) return res.status(check.status).json({ success: false, error: check.error });
  }
  next();
}

// --------------------------
// POST /ask (JSON response)
// --------------------------
export async function askJsonHandler(pipeline, req, res) {
  // Abort the (paid) AI call when the client disconnects mid-request —
  // mirrors the stream path's abort handling.
  const abortController = new AbortController();
  req.on("close", () => abortController.abort());
  try {
    const { question, history = [] } = req.body;

    if (!question?.trim()) {
      return res.status(400).json({ success: false, error: "Question is required" });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({ success: false, error: "History must be an array" });
    }

    const result = await pipeline.askQuestion(question, history, req.companyName, {
      signal: abortController.signal,
    });
    // Client gone before the answer landed — nothing to write to.
    if (abortController.signal.aborted || res.destroyed) return;
    return res.json({ success: true, ...result });
  } catch (err) {
    if (abortController.signal.aborted) return;
    console.error("❌ /ask Error:", err);
    return res.status(500).json({ success: false, error: "Internal Server Error" });
  }
}

// --------------------------
// POST /ask-stream (SSE response)
// --------------------------
export async function askStreamHandler(pipeline, req, res) {
  let transport = null;
  try {
    const { question, history = [] } = req.body;

    // --------------------------
    // 🔹 VALIDATION
    // --------------------------
    if (!question?.trim()) {
      return res.status(400).json({ success: false, error: "Question is required" });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({ success: false, error: "History must be an array" });
    }

    // --------------------------
    // 🔹 SSE HEADERS
    // --------------------------
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable proxy buffering (Nginx)
    res.flushHeaders?.();

    // --------------------------
    // 🔹 ABORT HANDLING
    // --------------------------
    const abortController = new AbortController();
    transport = createStreamTransport({
      write: (frame) => res.write(frame),
      externalSignal: abortController.signal,
    });

    res.on("close", () => {
      transport.close();
      abortController.abort();

      console.log("ℹ️ SSE connection closed");
    });

    // --------------------------
    // 🔹 EXECUTE STREAM
    // --------------------------
    await pipeline.askQuestionStream(question, history, transport, req.companyName);

    // --------------------------
    // 🔹 FINISH STREAM
    // --------------------------
    // The pipeline already calls transport.finish() on the success path
    // (which sends [DONE] and marks the transport closed). The HTTP response
    // must still be ended — res.end() is unconditional — otherwise the
    // connection hangs open after the answer completes.
    if (!transport.isClosed()) {
      transport.finish();
    }
    res.end();
  } catch (err) {
    console.error("❌ Stream API Error:", err.message);

    try {
      if (!res.headersSent) {
        res.setHeader("Content-Type", "text/event-stream");
      }

      if (!res.destroyed) {
        if (transport && !transport.isClosed()) {
          transport.sendError(err.message);
        }
        res.end();
      }
    } catch (innerErr) {
      console.error("❌ Stream error recovery failed:", innerErr.message);
      try { res.destroy(); } catch { /* best effort */ }
    }
  }
}

// --------------------------
// POST /ask/reset — conversation reset for one company
// Clears the in-memory answer cache for this company so the next question
// re-runs the full RAG pipeline (no cached answers, no stale context). Gated
// by the same company + per-company API-key middleware as /ask. Not behind the
// AI limiter: it's a cheap in-memory purge, not an AI call.
// --------------------------
export function resetCacheHandler(req, res) {
  const removed = clearCompanyCache(req.companyName);
  return res.json({ success: true, cleared: removed });
}

// --------------------------
// ROUTER
// --------------------------
export function createAskRouter({ pipeline = { askQuestion, askQuestionStream } } = {}) {
  const router = express.Router();
  router.post("/ask", requireCompany, requireAskApiKey, aiLimiter, (req, res) => askJsonHandler(pipeline, req, res));
  router.post("/ask-stream", requireCompany, requireAskApiKey, aiLimiter, (req, res) => askStreamHandler(pipeline, req, res));
  router.post("/ask/reset", requireCompany, requireAskApiKey, resetCacheHandler);
  return router;
}
