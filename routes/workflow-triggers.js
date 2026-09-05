// --------------------------
// PUBLIC WORKFLOW TRIGGERS
// Webhook endpoint for triggering workflows without admin auth.
// Mounted at /webhooks in app.js.
// --------------------------
import express from "express";
import { requireGatewayCompany } from "../mysql/services/company-scope.js";
import { wrap } from "../mysql/routes/helpers.js";
import { NotFoundError } from "../shared/errors.js";
import crypto from "crypto";

const router = express.Router();

// All webhook routes require a valid company header.
router.use(requireGatewayCompany);

/**
 * Verify the webhook token from the Authorization header.
 * Token format: Bearer <hex-encoded-hmac>
 */
function verifyWebhookToken(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return false;
  try {
    const provided = Buffer.from(parts[1], "hex");
    const expected = crypto.createHmac("sha256", secret).update("webhook").digest();
    return crypto.timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

// POST /webhooks/:companyKey/:workflowKey — trigger a workflow via webhook
router.post(
  "/:companyKey/:workflowKey",
  wrap(async (req, res) => {
    const { WorkflowRepository } = await import("../mysql/repositories.js");
    const { runWorkflow } = await import("../mysql/services/workflow-runner.js");

    const workflow = await WorkflowRepository.findByKey(
      req.company.id,
      req.params.workflowKey
    );
    if (!workflow) {
      throw new NotFoundError(`Workflow '${req.params.workflowKey}' not found.`);
    }

    // Verify webhook trigger is enabled.
    if (workflow.trigger_type !== "webhook") {
      return res.status(400).json({
        success: false,
        error: "Workflow does not have webhook trigger enabled.",
      });
    }

    // Verify the webhook token.
    const triggerConfig = workflow.trigger_config || {};
    const webhookSecret = triggerConfig.webhook_secret;
    if (webhookSecret) {
      const authHeader = req.headers.authorization;
      if (!verifyWebhookToken(authHeader, webhookSecret)) {
        return res.status(401).json({
          success: false,
          error: "Invalid webhook token.",
        });
      }
    }

    // Run the workflow.
    const run = await runWorkflow({
      workflowKey: workflow.workflow_key,
      companyName: req.company.company_key,
      definition: workflow.definition,
    });

    return res.json({
      success: true,
      runId: run.runId,
      status: run.status,
      steps: run.steps?.length || 0,
      durationMs: run.durationMs,
    });
  })
);

// GET /webhooks/:companyKey/:workflowKey — health check for webhook endpoint
router.get(
  "/:companyKey/:workflowKey",
  wrap(async (req, res) => {
    const { WorkflowRepository } = await import("../mysql/repositories.js");

    const workflow = await WorkflowRepository.findByKey(
      req.company.id,
      req.params.workflowKey
    );
    if (!workflow) {
      throw new NotFoundError(`Workflow '${req.params.workflowKey}' not found.`);
    }

    return res.json({
      success: true,
      workflow: workflow.workflow_key,
      triggerType: workflow.trigger_type,
      status: workflow.status,
      steps: workflow.definition?.steps?.length || 0,
    });
  })
);

export default router;
