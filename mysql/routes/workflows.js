// --------------------------
// workflow routes (Clean Architecture: one router per resource group).
// CRUD + run/abort/history under /gateway/workflows.
// --------------------------
import express from "express";
import { WorkflowRepository } from "../repositories.js";
import * as WorkflowService from "../services/workflow-service.js";
import { runWorkflow, abortWorkflow, getRunStatus, listActiveRuns, scheduleWorkflow, unscheduleWorkflow, listScheduledWorkflows } from "../services/workflow-runner.js";
import { requireGatewayCompany } from "../services/company-scope.js";
import { wrap } from "./helpers.js";
import { parsePagination, paginate } from "./pagination.js";
import { actorFromReq } from "./shared-helpers.js";
import { NotFoundError } from "../../shared/errors.js";

const router = express.Router();

router.use("/workflows", requireGatewayCompany);

// GET /gateway/workflows
router.get(
  "/workflows",
  wrap(async (req, res) => {
    const workflows = await WorkflowRepository.listByCompany(req.company.id);
    const pagination = parsePagination(req);
    return paginate(res, workflows, pagination, "workflows", "/gateway/workflows");
  })
);

// POST /gateway/workflows
router.post(
  "/workflows",
  wrap(async (req, res) => {
    const { workflowId, workflowKey } = await WorkflowService.saveWorkflow(
      req.company,
      req.body || {},
      actorFromReq(req)
    );
    return res.status(201).json({
      success: true,
      message: `Workflow '${workflowKey}' created.`,
      workflowId,
      workflowKey,
    });
  })
);

// GET /gateway/workflows/:key
router.get(
  "/workflows/:key",
  wrap(async (req, res) => {
    const workflow = await WorkflowRepository.findByKey(req.company.id, req.params.key);
    if (!workflow) throw new NotFoundError(`Workflow '${req.params.key}' not found.`);
    return res.json({ success: true, workflow });
  })
);

// PUT /gateway/workflows/:key
router.put(
  "/workflows/:key",
  wrap(async (req, res) => {
    const { workflowId, workflowKey } = await WorkflowService.updateWorkflow(
      req.company,
      req.params.key,
      req.body || {},
      actorFromReq(req)
    );
    return res.json({
      success: true,
      message: `Workflow '${workflowKey}' updated.`,
      workflowId,
      workflowKey,
    });
  })
);

// DELETE /gateway/workflows/:key (soft delete)
router.delete(
  "/workflows/:key",
  wrap(async (req, res) => {
    await WorkflowService.removeWorkflow(req.company, req.params.key, actorFromReq(req));
    return res.json({ success: true, message: `Workflow '${req.params.key}' deleted.` });
  })
);

// POST /gateway/workflows/:key/run — manual trigger
router.post(
  "/workflows/:key/run",
  wrap(async (req, res) => {
    const workflow = await WorkflowRepository.findByKey(req.company.id, req.params.key);
    if (!workflow) throw new NotFoundError(`Workflow '${req.params.key}' not found.`);

    const run = await runWorkflow({
      workflowKey: workflow.workflow_key,
      companyName: req.company.company_key,
      definition: workflow.definition,
    });

    return res.json({
      success: true,
      runId: run.runId,
      status: run.status,
      steps: run.steps,
      durationMs: run.durationMs,
    });
  })
);

// POST /gateway/workflows/:key/abort — abort a running workflow
router.post(
  "/workflows/:key/abort",
  wrap(async (req, res) => {
    const { runId } = req.body || {};
    if (!runId) return res.status(400).json({ success: false, error: "runId is required." });

    const aborted = abortWorkflow(runId);
    if (!aborted) {
      return res.status(404).json({ success: false, error: "Run not found or not running." });
    }
    return res.json({ success: true, message: `Run '${runId}' aborted.` });
  })
);

// GET /gateway/workflows/:key/runs — list runs (persisted + active)
router.get(
  "/workflows/:key/runs",
  wrap(async (req, res) => {
    const workflow = await WorkflowRepository.findByKey(req.company.id, req.params.key);
    if (!workflow) throw new NotFoundError(`Workflow '${req.params.key}' not found.`);

    const { parsePagination, paginate } = await import("./pagination.js");
    const pagination = parsePagination(req);

    // Fetch persisted runs from MySQL.
    const { WorkflowRunRepository } = await import("../repositories.js");
    const dbRuns = await WorkflowRunRepository.listByWorkflow(workflow.id, {
      limit: pagination.perPage,
      offset: (pagination.page - 1) * pagination.perPage,
    });

    // Merge with in-memory active runs (may be running now).
    const activeRunsForCompany = listActiveRuns(req.company.company_key)
      .filter((r) => r.workflowKey === req.params.key)
      .map((r) => ({
        runId: r.runId,
        status: r.status,
        startedAt: r.startedAt,
        completedAt: r.completedAt || null,
        durationMs: r.durationMs || null,
        steps: r.steps,
        source: "active",
      }));

    return res.json({
      success: true,
      runs: [...activeRunsForCompany, ...dbRuns],
      pagination: { page: pagination.page, perPage: pagination.perPage },
    });
  })
);

// POST /gateway/workflows/:key/activate
router.post(
  "/workflows/:key/activate",
  wrap(async (req, res) => {
    const workflow = await WorkflowRepository.findByKey(req.company.id, req.params.key);
    if (!workflow) throw new NotFoundError(`Workflow '${req.params.key}' not found.`);

    await WorkflowRepository.update(workflow.id, { status: "active", isActive: true });
    return res.json({ success: true, message: `Workflow '${req.params.key}' activated.` });
  })
);

// POST /gateway/workflows/:key/pause
router.post(
  "/workflows/:key/pause",
  wrap(async (req, res) => {
    const workflow = await WorkflowRepository.findByKey(req.company.id, req.params.key);
    if (!workflow) throw new NotFoundError(`Workflow '${req.params.key}' not found.`);

    await WorkflowRepository.update(workflow.id, { status: "paused", isActive: false });
    return res.json({ success: true, message: `Workflow '${req.params.key}' paused.` });
  })
);

// POST /gateway/workflows/:key/schedule — schedule a workflow on a cron expression
router.post(
  "/workflows/:key/schedule",
  wrap(async (req, res) => {
    const workflow = await WorkflowRepository.findByKey(req.company.id, req.params.key);
    if (!workflow) throw new NotFoundError(`Workflow '${req.params.key}' not found.`);

    const { cron: cronExpr } = req.body || {};
    if (!cronExpr) {
      return res.status(400).json({ success: false, error: "cron expression is required." });
    }

    const result = await scheduleWorkflow({
      workflowKey: workflow.workflow_key,
      companyName: req.company.company_key,
      cron: cronExpr,
      definition: workflow.definition,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  })
);

// POST /gateway/workflows/:key/unschedule — stop a scheduled workflow
router.post(
  "/workflows/:key/unschedule",
  wrap(async (req, res) => {
    const result = unscheduleWorkflow(req.params.key, req.company.company_key);
    if (!result.success) {
      return res.status(404).json(result);
    }
    return res.json(result);
  })
);

// GET /gateway/workflows/schedules — list all scheduled workflows
router.get(
  "/workflows/schedules",
  wrap(async (req, res) => {
    const schedules = listScheduledWorkflows(req.company.company_key);
    return res.json({ success: true, schedules });
  })
);

// POST /gateway/workflows/:key/webhook-token — generate a new webhook token
router.post(
  "/workflows/:key/webhook-token",
  wrap(async (req, res) => {
    const workflow = await WorkflowRepository.findByKey(req.company.id, req.params.key);
    if (!workflow) throw new NotFoundError(`Workflow '${req.params.key}' not found.`);

    const { generateWebhookToken } = await import("../services/workflow-service.js");
    const { token, secret } = generateWebhookToken();

    // Store the secret in trigger_config.
    const triggerConfig = { ...(workflow.trigger_config || {}), webhook_secret: secret };
    await WorkflowRepository.update(workflow.id, { triggerConfig });

    return res.json({
      success: true,
      token,
      secret,
      webhookUrl: `/webhooks/${req.company.company_key}/${workflow.workflow_key}`,
    });
  })
);

export default router;
