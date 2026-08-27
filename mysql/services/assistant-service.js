// --------------------------
// ASSISTANT SERVICE
// Validation + ownership checks for tenant assistants (assistants).
// Mirrors kb-service.js (F4 pattern): validation is pure and DB-free; all SQL
// lives in the repositories. Writers throw errors carrying a `status` so the
// router can map them to 4xx.
// --------------------------
import {
  CredentialRepository,
  ModelRepository,
  ResourceRepository,
  KbRepository,
  AssistantRepository,
  AuditRepository,
} from "../repositories.js";

export const ASSISTANT_KEY_RE = /^[a-z0-9-]+$/;

// Backward-compatible HttpError — extends AppError so the error handler
// middleware recognizes it and the test suite's `instanceof HttpError` checks pass.
import { AppError } from "../../shared/errors.js";

export class HttpError extends AppError {
  constructor(status, message) {
    super(message, status);
  }
}

function isPosInt(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

/**
 * Validate assistant input. Normalizes defaults for optional fields.
 * @param {Object} input
 * @returns {{ ok: boolean, value?: Object, errors?: Object<string,string> }}
 */
export function validateAssistantInput(input = {}) {
  const errors = {};

  if (!input.assistantKey?.trim()) {
    errors.assistantKey = "assistantKey is required.";
  } else if (!ASSISTANT_KEY_RE.test(input.assistantKey)) {
    errors.assistantKey = "assistantKey must match /^[a-z0-9-]+$/.";
  } else if (input.assistantKey.length < 3 || input.assistantKey.length > 63) {
    errors.assistantKey = "assistantKey must be 3-63 characters.";
  }

  if (!input.assistantName?.trim()) {
    errors.assistantName = "assistantName is required.";
  } else if (input.assistantName.trim().length > 200) {
    errors.assistantName = "assistantName must be at most 200 characters.";
  }

  if (input.credentialId === undefined || input.credentialId === null || !isPosInt(input.credentialId)) {
    errors.credentialId = "credentialId is required and must be a positive integer.";
  }

  for (const field of ["modelId", "primaryKbId", "graphResourceId"]) {
    const v = input[field];
    if (v !== undefined && v !== null && v !== "" && !isPosInt(v)) {
      errors[field] = `${field} must be a positive integer when set.`;
    }
  }

  if (input.kbIds !== undefined && input.kbIds !== null) {
    if (!Array.isArray(input.kbIds)) {
      errors.kbIds = "kbIds must be an array of positive integers.";
    } else if (!input.kbIds.every((id) => isPosInt(id))) {
      errors.kbIds = "kbIds must be an array of positive integers.";
    }
  }

  if (input.systemPrompt !== undefined && input.systemPrompt !== null && input.systemPrompt.length > 65535) {
    errors.systemPrompt = "systemPrompt must be at most 65535 characters.";
  }

  if (input.variables !== undefined && input.variables !== null) {
    if (!Array.isArray(input.variables)) {
      errors.variables = "variables must be an array of {key, value} objects.";
    } else {
      for (const v of input.variables) {
        if (!v?.key || !String(v.key).trim()) {
          errors.variables = "Each variable must have a non-empty key.";
          break;
        }
        if (typeof v.value !== "string") {
          errors.variables = "Each variable value must be a string.";
          break;
        }
      }
    }
  }

  if (input.temperature !== undefined && input.temperature !== null) {
    const t = Number(input.temperature);
    if (!Number.isFinite(t) || t < 0 || t > 2) {
      errors.temperature = "temperature must be a number 0-2.";
    }
  }

  if (input.maxTokens !== undefined && input.maxTokens !== null) {
    if (!Number.isInteger(Number(input.maxTokens)) || Number(input.maxTokens) < 1 || Number(input.maxTokens) > 1000000) {
      errors.maxTokens = "maxTokens must be an integer 1-1000000.";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      assistantKey: input.assistantKey.trim(),
      assistantName: input.assistantName.trim(),
      description: input.description?.trim() || null,
      credentialId: Number(input.credentialId),
      modelId: input.modelId ? Number(input.modelId) : null,
      systemPrompt: input.systemPrompt?.trim() || null,
      variables: input.variables == null ? [] : Array.isArray(input.variables) ? input.variables.map((v) => ({ key: String(v.key).trim(), value: String(v.value) })) : [],
      temperature: input.temperature === undefined || input.temperature === null ? 0.7 : Number(input.temperature),
      maxTokens: input.maxTokens === undefined || input.maxTokens === null ? 4096 : Number(input.maxTokens),
      enableFunctionCalling: input.enableFunctionCalling !== false,
      enableStreaming: input.enableStreaming !== false,
      tools: input.tools ?? null,
      primaryKbId: input.primaryKbId ? Number(input.primaryKbId) : null,
      kbIds: input.kbIds == null ? null : Array.isArray(input.kbIds) ? input.kbIds.map(Number) : [],
      enableGraphContext: Boolean(input.enableGraphContext),
      graphResourceId: input.graphResourceId ? Number(input.graphResourceId) : null,
      isActive: input.isActive !== false,
      isPublic: Boolean(input.isPublic),
    },
  };
}

// ------------------------------------------------------------------
// OWNERSHIP CHECKS (shared by saveAssistant / updateAssistant)
// ------------------------------------------------------------------

/**
 * The credential must belong to this company; if a model is set it must belong
 * to that same credential's provider (the model pool the credential unlocks).
 * @returns {Promise<null | { error: string }>}
 */
async function checkCredential(companyId, credentialId, modelId) {
  const credential = await CredentialRepository.findById(credentialId);
  if (!credential) return { error: `Unknown credentialId '${credentialId}'.` };
  if (Number(credential.company_id) !== Number(companyId)) {
    return { error: `Credential '${credentialId}' does not belong to this company.` };
  }
  if (modelId) {
    const model = await ModelRepository.findById(modelId);
    if (!model) return { error: `Unknown modelId '${modelId}'.` };
    if (Number(model.provider_id) !== Number(credential.provider_id)) {
      return { error: `Model '${model.model_key}' does not belong to the credential's provider '${credential.provider_id}'.` };
    }
  }
  return null;
}

/** Verify every kbId (plus the primaryKbId) resolves to a KB owned by this company. */
async function checkKbOwnership(companyId, kbIds, primaryKbId = null) {
  const ids = new Set([...(kbIds || []), ...(primaryKbId ? [primaryKbId] : [])]);
  for (const kbId of ids) {
    const kb = await KbRepository.findById(kbId);
    if (!kb) return { error: `Unknown kbId '${kbId}'.` };
    if (Number(kb.company_id) !== Number(companyId)) {
      return { error: `Knowledge base '${kbId}' does not belong to this company.` };
    }
  }
  return null;
}

/** Verify a graph resource (if set) belongs to this company. */
async function checkGraphResource(companyId, resourceId) {
  if (!resourceId) return null;
  const resource = await ResourceRepository.findById(resourceId);
  if (!resource) return { error: `Unknown graphResourceId '${resourceId}'.` };
  if (Number(resource.company_id) !== Number(companyId)) {
    return { error: `Resource '${resourceId}' does not belong to this company.` };
  }
  return null;
}

/** All ownership checks + a resolved model_key for the denormalized column. */
async function checkOwnership(companyId, value) {
  const credentialErr = await checkCredential(companyId, value.credentialId, value.modelId);
  if (credentialErr) return credentialErr;
  const kbErr = await checkKbOwnership(companyId, value.kbIds, value.primaryKbId);
  if (kbErr) return kbErr;
  const graphErr = await checkGraphResource(companyId, value.graphResourceId);
  if (graphErr) return graphErr;
  return null;
}

async function resolveModelKey(modelId) {
  if (!modelId) return null;
  const model = await ModelRepository.findById(modelId);
  return model ? model.model_key : null;
}

// ------------------------------------------------------------------
// ASSISTANT WRITERS
// ------------------------------------------------------------------

/**
 * Create an assistant for a company. Enforces uk_company_assistant uniqueness
 * and the company's max_assistants capacity gate, then persists + audits.
 * @param {Object} company  CompanyRepository row (from requireGatewayCompany)
 * @param {Object} input
 * @param {Object} [actor]
 * @returns {Promise<{assistantId: number, assistantKey: string}>}
 */
export async function saveAssistant(company, input, actor = {}) {
  const check = validateAssistantInput(input);
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const value = check.value;

  if (await AssistantRepository.findByKey(company.id, value.assistantKey)) {
    throw new HttpError(409, `Assistant '${value.assistantKey}' already exists.`);
  }

  const count = (await AssistantRepository.listByCompany(company.id, { includeInactive: true })).length;
  if (company.max_assistants != null && count >= Number(company.max_assistants)) {
    throw new HttpError(409, `Company assistant limit reached (${company.max_assistants}).`);
  }

  const ownershipError = await checkOwnership(company.id, value);
  if (ownershipError) throw new HttpError(400, ownershipError.error);

  const modelKey = await resolveModelKey(value.modelId);
  const assistantId = await AssistantRepository.create(company.id, { ...value, modelKey });
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "assistant.created",
    entityType: "assistant",
    entityId: assistantId,
    afterState: { assistant_key: value.assistantKey },
    reason: actor.reason ?? "admin action",
  });
  return { assistantId, assistantKey: value.assistantKey };
}

/**
 * Update an assistant (assistantKey is not editable — it is the route identity).
 * Re-validates merged input, re-checks ownership, persists + audits.
 * @param {Object} company
 * @param {string} assistantKey
 * @param {Object} input
 * @param {Object} [actor]
 * @returns {Promise<{assistantId: number, assistantKey: string}>}
 */
export async function updateAssistant(company, assistantKey, input, actor = {}) {
  const existing = await AssistantRepository.findByKey(company.id, assistantKey);
  if (!existing) throw new HttpError(404, `Assistant '${assistantKey}' not found.`);

  const merged = {
    ...existing,
    assistantName: existing.assistant_name,
    description: existing.description,
    credentialId: existing.credential_id,
    modelId: existing.model_id,
    systemPrompt: existing.system_prompt,
    temperature: Number(existing.temperature),
    maxTokens: existing.max_tokens,
    enableFunctionCalling: Boolean(existing.enable_function_calling),
    enableStreaming: Boolean(existing.enable_streaming),
    tools: existing.tools,
    primaryKbId: existing.primary_kb_id,
    kbIds: existing.kb_ids == null ? null : Array.isArray(existing.kb_ids) ? existing.kb_ids : [],
    enableGraphContext: Boolean(existing.enable_graph_context),
    graphResourceId: existing.graph_resource_id,
    isActive: Boolean(existing.is_active),
    isPublic: Boolean(existing.is_public),
    ...input,
  };
  merged.assistantKey = existing.assistant_key; // never editable

  const check = validateAssistantInput(merged);
  if (!check.ok) throw new HttpError(400, "Validation failed: " + JSON.stringify(check.errors));

  const value = check.value;
  const ownershipError = await checkOwnership(company.id, value);
  if (ownershipError) throw new HttpError(400, ownershipError.error);

  const modelKey = await resolveModelKey(value.modelId);
  await AssistantRepository.update(existing.id, { ...value, modelKey });
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "assistant.updated",
    entityType: "assistant",
    entityId: existing.id,
    beforeState: { assistant_key: existing.assistant_key, model_id: existing.model_id },
    afterState: { assistant_key: value.assistantKey, model_id: value.modelId },
    reason: actor.reason ?? "admin action",
  });
  return { assistantId: existing.id, assistantKey: existing.assistant_key };
}

/**
 * Soft-delete an assistant + audit.
 * @param {Object} company
 * @param {string} assistantKey
 * @param {Object} [actor]
 * @returns {Promise<void>}
 */
export async function removeAssistant(company, assistantKey, actor = {}) {
  const existing = await AssistantRepository.findByKey(company.id, assistantKey);
  if (!existing) throw new HttpError(404, `Assistant '${assistantKey}' not found.`);

  await AssistantRepository.remove(existing.id);
  await AuditRepository.log({
    companyId: company.id,
    actorType: actor.actorType ?? "admin",
    actorId: actor.actorId ?? null,
    actorIp: actor.actorIp ?? null,
    requestId: actor.requestId ?? null,
    action: "assistant.deleted",
    entityType: "assistant",
    entityId: existing.id,
    afterState: { assistant_key: existing.assistant_key },
    reason: actor.reason ?? "admin action",
  });
}
