// --------------------------
// WORKFLOW SERVICE
// Validation + ownership checks for tenant workflows.
// Mirrors assistant-service.js pattern.
// --------------------------
import {
  AssistantRepository,
  WorkflowRepository,
  AuditRepository,
} from "../repositories.js";

export const WORKFLOW_KEY_RE = /^[a-z0-9-]+$/;

import crypto from "crypto";
import { AppError } from "../../shared/errors.js";

export class HttpError extends AppError {
  constructor(status, message) {
    super(message, status);
  }
}

/**
 * Generate a webhook token for a workflow.
 * @returns {{ token: string, secret: string }}
 */
export function generateWebhookToken() {
  const secret = crypto.randomBytes(32).toString("hex");
  const hmac = crypto.createHmac("sha256", secret).update("webhook").digest("hex");
  return { token: hmac, secret };
}

function isPosInt(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

// Valid step types for the workflow definition.
const VALID_STEP_TYPES = new Set([
  "assistant", "http", "ingest", "notify", "delay", "condition", "loop",
]);

// Valid trigger types.
const VALID_TRIGGER_TYPES = new Set(["manual", "webhook", "schedule", "event"]);

/**
 * Validate workflow input.
 * @param {Object} input
 * @returns {{ ok: boolean, value?: Object, errors?: Object<string,string> }}
 */
export function validateWorkflowInput(input = {}) {
  const errors = {};

  if (!input.workflowKey?.trim()) {
    errors.workflowKey = "workflowKey is required.";
  } else if (!WORKFLOW_KEY_RE.test(input.workflowKey)) {
    errors.workflowKey = "workflowKey must match /^[a-z0-9-]+$/.";
  } else if (input.workflowKey.length < 3 || input.workflowKey.length > 63) {
    errors.workflowKey = "workflowKey must be 3-63 characters.";
  }

  if (!input.workflowName?.trim()) {
    errors.workflowName = "workflowName is required.";
  } else if (input.workflowName.trim().length > 200) {
    errors.workflowName = "workflowName must be at most 200 characters.";
  }

  if (input.triggerType && !VALID_TRIGGER_TYPES.has(input.triggerType)) {
    errors.triggerType = `triggerType must be one of: ${[...VALID_TRIGGER_TYPES].join(", ")}`;
  }

  if (input.definition) {
    const def = input.definition;
    if (!def.steps || !Array.isArray(def.steps)) {
      errors.definition = "definition.steps must be an array.";
    } else {
      for (let i = 0; i < def.steps.length; i++) {
        const step = def.steps[i];
        if (!step.type || !VALID_STEP_TYPES.has(step.type)) {
          errors.definition = `Step ${i + 1}: type must be one of: ${[...VALID_STEP_TYPES].join(", ")}`;
          break;
        }
      }
    }
  }

  if (input.primaryAssistantId !== undefined && input.primaryAssistantId !== null && !isPosInt(input.primaryAssistantId)) {
    errors.primaryAssistantId = "primaryAssistantId must be a positive integer when set.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      workflowKey: input.workflowKey.trim(),
      workflowName: input.workflowName.trim(),
      description: input.description?.trim() || null,
      definition: input.definition || { steps: [] },
      primaryAssistantId: input.primaryAssistantId ? Number(input.primaryAssistantId) : null,
      triggerType: input.triggerType || "manual",
      triggerConfig: input.triggerConfig || null,
      status: input.status || "draft",
      isActive: input.isActive !== false,
    },
  };
}

// ------------------------------------------------------------------
// OWNERSHIP CHECKS
// ------------------------------------------------------------------

async function checkAssistant(companyId, assistantId) {
  if (!assistantId) return null;
  const assistant = await AssistantRepository.findById(assistantId);
  if (!assistant) return { error: `Unknown primaryAssistantId '${assistantId}'.` };
  if (Number(assistant.company_id) !== Number(companyId)) {
    return { error: `Assistant '${assistantId}' does not belong to this company.` };
  }
  return null;
}

// ------------------------------------------------------------------
// WORKFLOW WRITERS
// ------------------------------------------------------------------

export async function saveWorkflow(company, input, actor = {}) {
  const check = validateWorkflowInput(input);
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const value = check.value;

  if (await WorkflowRepository.findByKey(company.id, value.workflowKey)) {
    throw new HttpError(409, `Workflow '${value.workflowKey}' already exists.`);
  }

  if (value.primaryAssistantId) {
    const assistantErr = await checkAssistant(company.id, value.primaryAssistantId);
    if (assistantErr) throw new HttpError(400, assistantErr.error);
  }

  // Auto-generate webhook secret for webhook triggers.
  if (value.triggerType === "webhook" && !value.triggerConfig?.webhook_secret) {
    const { secret } = generateWebhookToken();
    value.triggerConfig = { ...value.triggerConfig, webhook_secret: secret };
  }

  // Validate schedule expression for schedule triggers.
  if (value.triggerType === "schedule") {
    const cronExpr = value.triggerConfig?.cron;
    if (!cronExpr) {
      throw new HttpError(400, "triggerConfig.cron is required for schedule triggers.");
    }
    const cron = (await import("node-cron")).default;
    if (!cron.validate(cronExpr)) {
      throw new HttpError(400, `Invalid cron expression: ${cronExpr}`);
    }
  }

  const workflowId = await WorkflowRepository.create(company.id, value);
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "workflow.created",
    entityType: "workflow",
    entityId: workflowId,
    afterState: { workflow_key: value.workflowKey },
    reason: actor.reason ?? "admin action",
  });
  return { workflowId, workflowKey: value.workflowKey };
}

export async function updateWorkflow(company, workflowKey, input, actor = {}) {
  const existing = await WorkflowRepository.findByKey(company.id, workflowKey);
  if (!existing) throw new HttpError(404, `Workflow '${workflowKey}' not found.`);

  const merged = {
    workflowName: existing.workflow_name,
    description: existing.description,
    definition: existing.definition,
    primaryAssistantId: existing.primary_assistant_id,
    triggerType: existing.trigger_type,
    triggerConfig: existing.trigger_config,
    status: existing.status,
    isActive: Boolean(existing.is_active),
    ...input,
  };
  merged.workflowKey = existing.workflow_key;

  const check = validateWorkflowInput(merged);
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const value = check.value;

  if (value.primaryAssistantId) {
    const assistantErr = await checkAssistant(company.id, value.primaryAssistantId);
    if (assistantErr) throw new HttpError(400, assistantErr.error);
  }

  // Auto-generate webhook secret if switching to webhook trigger.
  if (value.triggerType === "webhook" && !value.triggerConfig?.webhook_secret) {
    const { secret } = generateWebhookToken();
    value.triggerConfig = { ...value.triggerConfig, webhook_secret: secret };
  }

  // Validate schedule expression for schedule triggers.
  if (value.triggerType === "schedule") {
    const cronExpr = value.triggerConfig?.cron;
    if (!cronExpr) {
      throw new HttpError(400, "triggerConfig.cron is required for schedule triggers.");
    }
    const cron = (await import("node-cron")).default;
    if (!cron.validate(cronExpr)) {
      throw new HttpError(400, `Invalid cron expression: ${cronExpr}`);
    }
  }

  await WorkflowRepository.update(existing.id, value);
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "workflow.updated",
    entityType: "workflow",
    entityId: existing.id,
    beforeState: { workflow_key: existing.workflow_key, status: existing.status },
    afterState: { workflow_key: value.workflowKey, status: value.status },
    reason: actor.reason ?? "admin action",
  });
  return { workflowId: existing.id, workflowKey: existing.workflow_key };
}

export async function removeWorkflow(company, workflowKey, actor = {}) {
  const existing = await WorkflowRepository.findByKey(company.id, workflowKey);
  if (!existing) throw new HttpError(404, `Workflow '${workflowKey}' not found.`);

  await WorkflowRepository.remove(existing.id);
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "workflow.deleted",
    entityType: "workflow",
    entityId: existing.id,
    afterState: { workflow_key: existing.workflow_key },
    reason: actor.reason ?? "admin action",
  });
}
