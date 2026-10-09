// --------------------------
// ASSISTANT RESOLUTION — selected assistant → pipeline overrides
// When a company has ASSISTANT_KEY set in its config store, the ask pipeline
// resolves that assistant (gateway MySQL row) and uses its persona settings —
// system prompt, model, temperature, primary KB's vector index, and graph
// resource — instead of the raw company defaults. Best-effort by design: any
// failure (no MySQL configured, unknown/inactive assistant, DB error) yields
// null overrides and the pipeline falls back to the company config. Never an
// ask error.
//
// The MySQL repositories are lazy-imported inside the resolver so this module
// loads with zero node_modules (query/ tests run against builtins only).
// --------------------------
import { getCompanyConfig } from "../config/index.js";

/** Only these model prefixes are runtime-callable today (Workers AI adapter). */
const RUNNABLE_MODEL_RE = /^@(cf|cloudflare)\//;

/**
 * The company's selected assistant key from its config store, or null.
 * Synchronous, no MySQL — this is the fast gate that skips the resolver.
 */
export function getSelectedAssistantKey(companyName) {
  const config = getCompanyConfig(companyName);
  const key = config?.ASSISTANT_KEY;
  return key && String(key).trim() ? String(key).trim() : null;
}

/** True when a catalog model key is one the runtime can actually execute. */
export function isRunnableModel(modelKey) {
  return Boolean(modelKey && RUNNABLE_MODEL_RE.test(String(modelKey).trim()));
}

/**
 * Resolve the selected assistant into pipeline overrides.
 *
 * `opts.assistantKey` is a REQUEST-SCOPED override (e.g. an `assistantKey` field on
 * POST /ask). It wins over the company's stored ASSISTANT_KEY for this call only —
 * nothing is written to the config store, so two concurrent requests can select
 * different assistants without clobbering each other or persisting an
 * unauthenticated injection. Omit it to use the company default.
 *
 * @param {string} companyName
 * @param {{assistantKey?: string|null}} [opts]
 * @returns {Promise<null | {
 *   assistantKey: string, assistantName?: string,
 *   systemPrompt?: string|null, variables?: Array<{key:string,value:string}>,
 *   model?: string|null, temperature?: number, maxTokens?: number,
 *   vectorIndex?: string|null, embeddingModel?: string|null,
 *   graphDatabase?: string|null, enableGraph?: boolean,
 * }>}
 */
export async function resolveAssistantOverrides(companyName, opts = {}) {
  const explicit = typeof opts.assistantKey === "string" ? opts.assistantKey.trim() : "";
  const assistantKey = explicit || getSelectedAssistantKey(companyName);
  if (!assistantKey) return null;

  try {
    const { CompanyRepository, AssistantRepository, KbRepository, ResourceRepository } = await import(
      "../mysql/repositories.js"
    );

    const company = await CompanyRepository.findByKey(companyName);
    if (!company) return null;

    const assistant = await AssistantRepository.findByKey(company.id, assistantKey);
    if (!assistant || !assistant.is_active) return null;

    const overrides = {
      assistantKey,
      assistantName: assistant.assistant_name || null,
      systemPrompt: assistant.system_prompt || null,
      // Per-assistant guardrails — override the company's config keys at ask
      // time (guardrail prompt > company GUARDRAIL_PROMPT > built-in;
      // blocked_patterns fully replace the pattern tier — see shared/
      // blocked-patterns.js — while blocked_topics add on top).
      guardrailPrompt: assistant.guardrail_prompt || null,
      blockedTopics: assistant.blocked_topics || null,
      blockedPatterns: assistant.blocked_patterns || null,
      variables: assistant.assistant_variables?.length ? assistant.assistant_variables.map((v) => ({ key: String(v.key), value: String(v.value) })) : [],
      // Catalog model_key (e.g. @cf/... or gpt-4o). Runnable through Workers AI
      // when @cf|@cloudflare prefixed; otherwise executed through the gateway
      // provider executor via the execution block below.
      model: assistant.model_key || null,
      temperature: assistant.temperature != null ? Number(assistant.temperature) : null,
      maxTokens: assistant.max_tokens != null ? Number(assistant.max_tokens) : null,
      vectorIndex: null,
      graphDatabase: null,
      enableGraph: Boolean(assistant.enable_graph_context),
      // Function calling support — tools array is JSON-parsed from the DB column.
      enableFunctionCalling: Boolean(assistant.enable_function_calling),
      tools: assistant.tools ? (typeof assistant.tools === 'string' ? JSON.parse(assistant.tools) : assistant.tools) : null,
    };

    // Primary KB → its vector index (the index the assistant should search).
    // Mirrors the ingest resolution (kb.vector_external_id → config fallback).
    // Also extract the embedding model for cache key isolation (ADR-012).
    if (assistant.primary_kb_id) {
      const kb = await KbRepository.findById(assistant.primary_kb_id);
      if (kb) {
        overrides.vectorIndex = kb.vector_external_id || null;
        // Embedding model: KB's binding → company config fallback.
        if (kb.embedding_model_provider && kb.embedding_model_id) {
          const { ModelRepository } = await import("../mysql/repositories.js");
          const model = await ModelRepository.findById(kb.embedding_model_id);
          if (model) overrides.embeddingModel = model.model_key || null;
        }
      }
    }

    // Graph resource → its database name (overrides the config NEO4J_DATABASE).
    if (assistant.graph_resource_id) {
      const resource = await ResourceRepository.findById(assistant.graph_resource_id);
      if (resource?.config?.database_name) {
        overrides.graphDatabase = String(resource.config.database_name).trim();
      }
    }

    // Non-Workers-AI execution binding: the assistant's own credential + model.
    // The ask pipeline runs generation through the gateway provider executor
    // when the catalog model is not an @cf|@cloudflare key (best-effort — a
    // missing/unresolvable credential leaves execution null and the pipeline
    // falls back to the company's Workers AI model).
    if (assistant.model_key && !isRunnableModel(assistant.model_key) && assistant.credential_id) {
      overrides.execution = {
        credentialId: assistant.credential_id,
        providerKey: assistant.provider_key || null,
      };
    }

    return overrides;
  } catch {
    return null; // best-effort — any failure means no assistant overrides
  }
}/**
 * Check if the assistant's credential allows the assigned model.
 * Uses credential_model_access table — the authorization gate.
 *
 * GRANTS-AWARE DENIAL: the gate denies ONLY when the credential has explicit
 * model-access grants configured and the assistant's model is not among them
 * (or is disabled/quota-exhausted). A credential with ZERO grants means no
 * per-model policy exists — everything is allowed, matching the Config page's
 * model pickers which never create grants implicitly. Without this, an
 * assistant whose model actually executes (provider-agnostic ask runtime)
 * would be blanked by "No access grant found" on every question.
 * @param {string} companyName
 * @param {object} assistant — resolved assistant overrides (must have assistantKey)
 * @returns {Promise<{ allowed: boolean, reason?: string } | null>}
 */
export async function checkModelAccess(companyName, assistant) {
  if (!assistant?.assistantKey) return null;

  try {
    const { CompanyRepository, AssistantRepository, CredentialRepository, ResourceRepository } = await import(
      "../mysql/repositories.js"
    );
    const company = await CompanyRepository.findByKey(companyName);
    if (!company) return null;
    const full = await AssistantRepository.findByKey(company.id, assistant.assistantKey);
    if (!full || !full.credential_id || !full.model_id) return null;
    const result = await CredentialRepository.checkModelAccess(full.credential_id, full.model_id);
    if (result?.allowed) return result;
    const grants = await ResourceRepository.listModelAccess(full.credential_id);
    if (!grants.length) return { allowed: true, unmanaged: true };
    return result;
  } catch {
    return null; // best-effort — DB errors should not block the ask path
  }
}
