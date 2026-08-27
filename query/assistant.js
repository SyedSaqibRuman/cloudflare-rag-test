// --------------------------
// ASSISTANT RESOLUTION — selected chatbot assistant → pipeline overrides
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
 * @param {string} companyName
 * @returns {Promise<null | {
 *   assistantKey: string, assistantName?: string,
 *   systemPrompt?: string|null, variables?: Array<{key:string,value:string}>,
 *   model?: string|null, temperature?: number, maxTokens?: number,
 *   vectorIndex?: string|null, graphDatabase?: string|null,
 *   enableGraph?: boolean,
 * }>}
 */
export async function resolveAssistantOverrides(companyName) {
  const assistantKey = getSelectedAssistantKey(companyName);
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
      variables: assistant.assistant_variables?.length ? assistant.assistant_variables.map((v) => ({ key: String(v.key), value: String(v.value) })) : [],
      // Catalog model_key (e.g. @cf/... or gpt-4o). The pipeline only executes
      // @cf/ models today — the runnable gate lives in answer.js.
      model: assistant.model_key || null,
      temperature: assistant.temperature != null ? Number(assistant.temperature) : null,
      maxTokens: assistant.max_tokens != null ? Number(assistant.max_tokens) : null,
      vectorIndex: null,
      graphDatabase: null,
      enableGraph: Boolean(assistant.enable_graph_context),
    };

    // Primary KB → its vector index (the index the chatbot should search).
    // Mirrors the ingest resolution (kb.vector_external_id → config fallback).
    if (assistant.primary_kb_id) {
      const kb = await KbRepository.findById(assistant.primary_kb_id);
      if (kb) overrides.vectorIndex = kb.vector_external_id || null;
    }

    // Graph resource → its database name (overrides the config NEO4J_DATABASE).
    if (assistant.graph_resource_id) {
      const resource = await ResourceRepository.findById(assistant.graph_resource_id);
      if (resource?.config?.database_name) {
        overrides.graphDatabase = String(resource.config.database_name).trim();
      }
    }

    return overrides;
  } catch {
    return null; // best-effort — any failure means no assistant overrides
  }
}
