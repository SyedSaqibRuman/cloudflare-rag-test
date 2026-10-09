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
import { testProviderModels } from "./model-tester.js";
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
/**
 * Outage guard for the verified sync: when EVERY (or ~every) advertised chat
 * model times out with zero responders and no hard failures, the provider is
 * almost certainly down — not "all models dead". NVIDIA's developer endpoint
 * flaps in waves (observed repeatedly), and a wave must not be read as a
 * verdict. A meaningful share of hard failures (404s, 5xx — anything that got
 * an actual answer) proves the endpoint is up, so the sweep is conclusive.
 * @param {{ok:number, timeouts:number, failed:number}} summary  tester summary
 *        (timeouts ⊆ failed — failed counts every non-OK result)
 * @param {number} advertised  advertised chat-model count
 * @returns {boolean} true when the sweep is inconclusive
 */
export function isSweepInconclusive(summary, advertised) {
  if (!advertised || summary.ok > 0) return false;
  const hardFails = (summary.failed ?? 0) - (summary.timeouts ?? 0);
  if (hardFails / advertised >= 0.1) return false;
  return (summary.timeouts ?? 0) / advertised >= 0.8;
}

export async function fetchProviderModels({ companyKey, providerKey, credentialId = null, verify = true }) {
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

  // Verified sync (default): the provider's own /models list is NOT the truth
  // — NVIDIA advertises chat models whose inference functions no longer exist
  // (Function '<uuid>': Not found). Probe every advertised chat model with the
  // batch tester and only upsert models that actually respond; embedding-class
  // models are upserted untested (a chat ping is the wrong probe for them).
  // Timeout/capacity failures are NOT dead — the model is dropped from this
  // sync but will be offered again on the next fetch.
  let verified = models;
  let verification = null;
  if (verify) {
    const chatKeys = new Set(
      models.filter((m) => m.category === "chat").map((m) => m.modelKey)
    );
    const sweep = await testProviderModels({
      companyKey,
      providerKey,
      credentialId,
      category: "chat",
      models: models
        .filter((m) => m.category === "chat")
        .map((m) => ({ ...m, id: null })),
    });
    const responding = new Set(sweep.results.filter((r) => r.ok).map((r) => r.modelKey));
    // Outage guard: all-timeouts ≠ all-dead. During a provider outage window
    // skip the chat upserts entirely and report inconclusive — the catalog is
    // untouched (fetch is upsert-only anyway) and the user retries later.
    const inconclusive = isSweepInconclusive(sweep.summary, chatKeys.size);
    verified = models.filter((m) => (m.category !== "chat" || responding.has(m.modelKey)) && !inconclusive);
    verification = {
      chatAdvertised: chatKeys.size,
      chatResponding: sweep.summary.ok,
      chatDropped: inconclusive ? 0 : chatKeys.size - sweep.summary.ok,
      timeouts: sweep.summary.timeouts,
      inconclusive,
      results: sweep.results.map((r) => ({ modelKey: r.modelKey, ok: r.ok, statusCode: r.statusCode, error: r.error })),
    };
  }

  for (const m of verified) {
    // ModelRepository.upsert is a single atomic statement (ON DUPLICATE KEY) —
    // no transaction needed.
    await ModelRepository.upsert(provider.id, m);
  }

  Registry.invalidateRegistry();
  return {
    fetched: verified.length,
    providerKey,
    models: verified,
    verification,
    dropped: verification
      ? models.filter((m) => !verified.includes(m)).map((m) => m.modelKey)
      : [],
  };
}