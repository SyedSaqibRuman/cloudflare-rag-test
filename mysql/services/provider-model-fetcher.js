// --------------------------
// PROVIDER MODEL FETCHER
// Fetches the live model list from a provider's /models endpoint (OpenAI-
// compatible shape) and upserts the models into the catalog. Uses the
// provider's stored credential (via provider-executor's resolution) so the
// admin never re-types keys. Best-effort: a provider without a /models
// endpoint returns { fetched: 0, models: [] }.
// --------------------------
import { ModelRepository } from "../repositories.js";
import * as Registry from "./provider-registry.js";
import * as Executor from "./provider-executor.js";
import { genericModelsUrl } from "../routes/probes.js";

export const MODEL_CATEGORIES = ["chat", "embedding", "reranker", "image", "tts", "stt", "vision"];

/** Normalize a model list from the provider into catalog upsert shape.
 *  Tolerates the per-provider field dialects seen in the wild:
 *  - key:    id (OpenAI/Anthropic/Ollama) | model_key | name (Gemini `models/…`)
 *  - name:   display_name (Anthropic) | name | model_name | id
 *  - flags:  supports_* | streaming / tools / vision shorthands (catalog-importer style)
 */
export function normalizeModels(models = [], category = "chat") {
  return models
    .filter((m) => m && (m.id || m.model_key || m.name))
    .map((m) => {
      const key = String(m.id || m.model_key || m.name).trim();
      const name = String(m.display_name || m.name || m.model_name || m.id || m.model_key || key).trim();
      const owned = m.owned_by || m.ownedBy || m.owner || null;
      const context = m.max_context_window ?? m.context_window ?? m.max_context ?? null;
      const output = m.max_output_tokens ?? m.max_tokens ?? null;
      return {
        modelKey: key,
        modelName: name,
        modelFamily: owned,
        category,
        supportsStreaming: !!(m.supports_streaming ?? m.streaming ?? false),
        supportsFunctionCalling: !!(m.supports_function_calling ?? m.tools ?? false),
        supportsVision: !!(m.supports_vision ?? m.vision ?? false),
        maxContextWindow: context ? Number(context) || null : null,
        maxOutputTokens: output ? Number(output) || null : null,
      };
    })
    .filter((m) => m.modelKey && m.modelName);
}

/**
 * If the provider has a `models` listing endpoint, fetch it live using the
 * company's stored credential (or unsaved `fields`), normalize to catalog
 * rows, and upsert them. Returns { fetched, providerKey, models } where
 * models is the normalized array; `fetched` counts how many landed in the DB.
 * Throws ExecutorError on network/HTTP issues so the route can surface them.
 */
export async function fetchProviderModels({ companyKey, providerKey, credentialId = null }) {
  const { provider, fields } = await Executor.resolveCredentialFields(companyKey, {
    credentialId,
    providerKey,
  });

  // Cloudflare / Neo4j / non-LLM providers have no /models — skip cleanly.
  const base = String(provider.default_api_base_url || "").trim();
  if (!base) return { fetched: 0, providerKey, models: [], skipped: true };

  const executor = Executor.getExecutor(provider.provider_key);
  let url;
  try {
    url = executor.modelsUrl
      ? executor.modelsUrl(provider, fields)
      : genericModelsUrl(base);
  } catch {
    return { fetched: 0, providerKey, models: [], skipped: true };
  }
  if (!url) return { fetched: 0, providerKey, models: [], skipped: true };

  // Providers with query-param auth (Gemini key=) embed the key in URL.
  const headers = executor.modelsHeaders
    ? executor.modelsHeaders(provider, fields)
    : Executor.buildAuthHeaders(provider, fields);

  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    const err = new Error(`Provider returned HTTP ${res.status}.`);
    err.status = 502;
    throw err;
  }
  const json = await res.json().catch(() => ({}));
  const raw = Array.isArray(json) ? json : json.data || json.models || [];
  if (!Array.isArray(raw)) return { fetched: 0, providerKey, models: [], skipped: true };

  // Chat-model heuristics: many /models listings mix embeddings; the catalog
  // keeps everything and the UI filters by category badges. Upsert all.
  const models = normalizeModels(raw);
  if (!models.length) return { fetched: 0, providerKey, models: [], skipped: true };

  for (const m of models) {
    // ModelRepository.upsert is a single atomic statement (ON DUPLICATE KEY) —
    // no transaction needed.
    await ModelRepository.upsert(provider.id, m);
  }

  Registry.invalidateRegistry();
  return { fetched: models.length, providerKey, models };
}