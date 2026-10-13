// --------------------------
// MODEL TESTER — batch "Test All" for a provider's catalog models.
// Runs a minimal live chat completion through the company's stored credential
// for EVERY model of the provider (optionally filtered by category / model
// ids), with a bounded worker pool and a per-model timeout so one hung model
// (e.g. a Cloudflare fine-tune UUID that 404s, or a capacity-limited free
// tier) can't stall the sweep. Each result carries a `freeTier` tag computed
// from pricing rows (0/0 prices) and common free-model key patterns, so the
// UI can list "free working models" after the run.
// Pure orchestration: the actual call is executeChat, injectable for tests.
// --------------------------
import * as Registry from "./provider-registry.js";
import { executeChat } from "./provider-executor.js";

export const DEFAULT_TEST_CONCURRENCY = 4;
export const DEFAULT_TEST_TIMEOUT_MS = 20_000;
export const TEST_MESSAGES = [{ role: "user", content: "ping" }];

/** Common free-model naming: OpenRouter's ":free" suffix, "<name>-free" /
 *  "…0731free" tails (bazaarlink-style free tiers — digits may butt against
 *  the "free" token), "free-" prefixes. A trailing letter ("freedom",
 *  "freetier") is NOT a free marker. */
const FREE_KEY_RE = /(^|[^a-zA-Z])free([^a-zA-Z].*)?$/i;

/** A model is tagged free-tier when its stored price is 0/0 or its key
 *  matches a common free-model naming pattern. */
export function isFreeTier(model) {
  const key = String(model?.model_key ?? model?.modelKey ?? "");
  const inP = model?.input_price_per_million;
  const outP = model?.output_price_per_million;
  const priceFree = inP != null && outP != null && Number(inP) === 0 && Number(outP) === 0;
  return priceFree || FREE_KEY_RE.test(key);
}

/** Race a promise against a timeout. The loser is abandoned (executeChat's
 *  fetch keeps running in the background — acceptable for a diagnostic sweep;
 *  the result just reports the timeout). */
function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms (${label})`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Normalize a model row to the snake_case shape the tester reads — the
 *  fetcher hands over camelCase normalized rows (modelKey), the registry
 *  serves snake_case (model_key). Accept both everywhere. */
function normalizeRow(m) {
  return {
    ...m,
    model_key: m.model_key ?? m.modelKey,
    model_name: m.model_name ?? m.modelName,
    id: m.id ?? null,
  };
}

/** Test ONE model. Never throws — a failed test is a result, not an error. */
async function testOne({ companyKey, providerKey, credentialId, model, timeoutMs, executeChatFn }) {
  const m = normalizeRow(model);
  const start = Date.now();
  try {
    const r = await withTimeout(
      executeChatFn({
        companyKey,
        providerKey,
        credentialId,
        model: m.model_key,
        messages: TEST_MESSAGES,
      }),
      timeoutMs,
      "no response"
    );
    return {
      modelId: m.id,
      modelKey: m.model_key,
      modelName: m.model_name || m.model_key,
      category: m.category,
      ok: true,
      statusCode: 200,
      latencyMs: r?.latencyMs ?? Date.now() - start,
      error: null,
      freeTier: isFreeTier(m),
    };
  } catch (err) {
    return {
      modelId: m.id,
      modelKey: m.model_key,
      modelName: m.model_name || m.model_key,
      category: m.category,
      ok: false,
      statusCode: err?.extra?.statusCode ?? err?.status ?? null,
      latencyMs: Date.now() - start,
      error: String(err?.message || err),
      freeTier: isFreeTier(m),
    };
  }
}

/**
 * Test every (or selected) catalog model of a provider through a company
 * credential, with a bounded worker pool.
 *
 * @param {Object} params
 * @param {string} params.companyKey   company whose credential executes the calls
 * @param {string} params.providerKey  provider whose catalog models are tested
 * @param {number} [params.credentialId]  pin a specific credential (optional)
 * @param {string} [params.category]   only test this category ("chat" | "embedding" | …); default: all
 * @param {number[]} [params.modelIds] restrict to these provider_models ids
 * @param {number} [params.concurrency] parallel calls (default 4)
 * @param {number} [params.timeoutMs]  per-model timeout (default 20s)
 * @param {Array<Object>} [params.models] inject the model list (tests); otherwise the registry
 * @param {Function} [params.executeChatFn] inject the executor (tests)
 * @returns {{ providerKey, summary: Object, results: Array }}
 */
export async function testProviderModels({
  companyKey,
  providerKey,
  credentialId,
  category,
  modelIds,
  concurrency = DEFAULT_TEST_CONCURRENCY,
  timeoutMs = DEFAULT_TEST_TIMEOUT_MS,
  models = null,
  executeChatFn = executeChat,
}) {
  if (!providerKey) throw new Error("providerKey is required");
  let list = models;
  if (list === null) {
    const catalog = await Registry.getModels(providerKey);
    if (catalog === null) throw new Error(`Unknown provider '${providerKey}'.`);
    list = catalog;
  }
  if (category) list = list.filter((m) => m.category === category);
  if (Array.isArray(modelIds) && modelIds.length) {
    const wanted = new Set(modelIds.map(Number));
    list = list.filter((m) => wanted.has(Number(m.id)));
  }

  const results = new Array(list.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const idx = cursor++;
      results[idx] = await testOne({ companyKey, providerKey, credentialId, model: list[idx], timeoutMs, executeChatFn });
    }
  };
  const lanes = Math.max(1, Math.min(concurrency, list.length || 1));
  await Promise.all(Array.from({ length: lanes }, worker));

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const timedOut = failed.filter((r) => /timeout after/.test(r.error || ""));
  const freeWorking = ok.filter((r) => r.freeTier);
  return {
    providerKey,
    summary: {
      total: results.length,
      ok: ok.length,
      failed: failed.length,
      timeouts: timedOut.length,
      freeWorking: freeWorking.length,
      avgLatencyMs: ok.length ? Math.round(ok.reduce((s, r) => s + r.latencyMs, 0) / ok.length) : null,
    },
    results,
    freeWorkingModels: freeWorking.map((r) => ({ modelKey: r.modelKey, modelName: r.modelName, latencyMs: r.latencyMs })),
  };
}
