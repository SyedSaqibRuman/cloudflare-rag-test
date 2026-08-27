// --------------------------
// PROVIDER EXECUTOR
// The gateway's execution layer (9Router open-sse/executors equivalent):
// actually CALLS a provider through a stored credential. Each provider gets
// an executor that knows its wire format — request URL/headers/body plus a
// response translator back to an OpenAI-style shape. Providers without a
// dedicated executor fall back to the OpenAI-compatible default. No SQL, no
// state — pure functions over { provider, fields, model, messages }, plus
// credential resolution helpers for the routes.
// --------------------------
import { randomUUID } from "node:crypto";
import { CompanyRepository, CredentialRepository } from "../repositories.js";
import * as Registry from "./provider-registry.js";
import * as CredentialService from "./credential-service.js";
import { parseProviderErrorMessage, pickKeyField } from "../routes/probes.js";

/** Error with an HTTP status — the route `wrap` helper maps it automatically. */
export class ExecutorError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ------------------------------------------------------------------
// Shared builders
// ------------------------------------------------------------------

/** The secret that authenticates with the provider (auth-schema key field,
 *  falling back to the conventional api_key / api_token names). */
export function extractKey(provider, fields) {
  const keyField = pickKeyField(provider.authForm || []);
  if (keyField && fields[keyField.field_name]) return fields[keyField.field_name];
  return fields.api_key || fields.api_token || "";
}

/** Auth header object from the provider's configured header name.
 *  `Authorization` gets the Bearer prefix; `key` (Gemini) is query-param and
 *  returns no header (its executor embeds the key in the URL). */
export function buildAuthHeaders(provider, fields) {
  const key = extractKey(provider, fields);
  const header = String(provider.auth_header_name || "Authorization").trim();
  if (header.toLowerCase() === "authorization") return { Authorization: `Bearer ${key}` };
  if (header.toLowerCase() === "key") return {};
  return { [header]: key };
}

/** The raw account id, with a leading `accounts/` path prefix stripped — the
 *  dashboard URL (`dash.cloudflare.com/accounts/<id>`) is the most common
 *  copy/paste source, and pasting the whole path double-writes it into the
 *  endpoint template (`/accounts/accounts/<id>`). Also drops whitespace. */
export function normalizeAccountId(raw) {
  return String(raw || "").trim().replace(/^accounts\//i, "");
}

/** True when a base URL already carries the /accounts segment — appending
 *  another one would produce /accounts/accounts/<id> (a Cloudflare 404). */
function baseHasAccountsSegment(base) {
  return /\/accounts\/?$/i.test(base);
}

/** Cloudflare Workers AI URL. Precedence:
 *  1. the credential's saved base_url (per-credential override — this is the
 *     "API Base URL" auth-schema field the admin edits; it was previously
 *     ignored, so the catalog default silently won),
 *  2. the catalog's workers_ai endpoint template ({account_id} substituted),
 *  3. the provider's default_api_base_url.
 *  The run path (/accounts/{account_id}/ai/run) is appended unless the base
 *  already ends in /accounts, then /{model} is appended. */
export function cloudflareRunUrl(provider, fields, model) {
  const accountId = normalizeAccountId(fields.account_id);
  const endpoint = (provider.endpoints || []).find((e) => e.endpoint_key === "workers_ai");
  let url;
  const override = String(fields.base_url || "").trim().replace(/\/+$/, "");
  if (override) {
    url = baseHasAccountsSegment(override)
      ? `${override}/${accountId}/ai/run`
      : `${override}/accounts/${accountId}/ai/run`;
  } else if (endpoint?.endpoint_url) {
    url = endpoint.endpoint_url.replace(/\{account_id\}/g, accountId);
  } else {
    const base = String(provider.default_api_base_url || "").replace(/\/+$/, "");
    url = baseHasAccountsSegment(base)
      ? `${base}/${accountId}/ai/run`
      : `${base}/accounts/${accountId}/ai/run`;
  }
  return `${url.replace(/\/+$/, "")}/${model}`;
}

function openaiCompatibleChatUrl(provider) {
  const base = String(provider.default_api_base_url || "").replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

function openaiCompatibleEmbeddingsUrl(provider) {
  const base = String(provider.default_api_base_url || "").replace(/\/+$/, "");
  return `${base}/embeddings`;
}

// ------------------------------------------------------------------
// Per-provider executors
// ------------------------------------------------------------------
const EXECUTORS = {
  // OpenAI-compatible default (openai, deepseek, groq, mistral, nvidia, …)
  default: {
    chatUrl: (provider) => openaiCompatibleChatUrl(provider),
    chatHeaders: (provider, fields) => ({
      ...buildAuthHeaders(provider, fields),
      "content-type": "application/json",
    }),
    chatBody: (model, messages, options) => ({ model, messages, ...options }),
    translateChat: (json) => {
      const choice = json?.choices?.[0];
      return {
        content: choice?.message?.content ?? null,
        role: choice?.message?.role ?? "assistant",
        usage: json?.usage ?? null,
        raw: json,
      };
    },
    embeddingsUrl: (provider) => openaiCompatibleEmbeddingsUrl(provider),
    embeddingsHeaders: (provider, fields) => buildAuthHeaders(provider, fields),
    embeddingsBody: (model, texts) => ({ model, input: texts }),
    translateEmbeddings: (json) => (json?.data || []).map((d) => d.embedding),
  },

  // Anthropic wire format: /v1/messages with x-api-key + anthropic-version.
  anthropic: {
    chatUrl: (provider) => `${String(provider.default_api_base_url || "").replace(/\/+$/, "")}/v1/messages`,
    chatHeaders: (provider, fields) => ({
      "x-api-key": extractKey(provider, fields),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    }),
    chatBody: (model, messages, options) => ({
      model,
      max_tokens: options.max_tokens ?? 1024,
      messages: messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? ""),
      })),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    }),
    translateChat: (json) => ({
      content: (json?.content || []).map((p) => p.text || "").join("") || null,
      role: "assistant",
      usage: json?.usage ?? null,
      raw: json,
    }),
  },

  // Gemini: generateContent with ?key= query param; role "model" for assistant.
  gemini: {
    chatUrl: (provider, fields, model) =>
      `${String(provider.default_api_base_url || "").replace(/\/+$/, "")}/models/${model}:generateContent?key=${encodeURIComponent(fields.api_key || "")}`,
    chatHeaders: () => ({ "content-type": "application/json" }),
    chatBody: (model, messages, options) => ({
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.content ?? "") }],
      })),
      ...(options.temperature !== undefined ? { generationConfig: { temperature: options.temperature } } : {}),
    }),
    translateChat: (json) => {
      const candidate = json?.candidates?.[0];
      return {
        content: candidate?.content?.parts?.map((p) => p.text || "").join("") ?? null,
        role: "assistant",
        usage: json?.usageMetadata ?? null,
        raw: json,
      };
    },
  },

  // Ollama (cloud + local): POST /api/chat (OpenAI-ish body, ollama response
  // shape) and /api/embed for embeddings. Same executor serves both `ollama`
  // and `ollama-local` (base URL differs, wire format is identical).
  ollama: {
    chatUrl: (provider) => `${String(provider.default_api_base_url || "").replace(/\/+$/, "")}/api/chat`,
    chatHeaders: (provider, fields) => ({
      ...buildAuthHeaders(provider, fields),
      "content-type": "application/json",
    }),
    chatBody: (model, messages, options) => {
      const body = { model, messages, stream: false };
      // Ollama keeps sampling params under `options` (temperature, num_predict,
      // top_p, ...) — mirror `options` through; top-level extras are dropped so
      // the server doesn't reject unknown fields.
      const { temperature, max_tokens, top_p, ...rest } = options || {};
      const opts = {};
      if (temperature !== undefined) opts.temperature = temperature;
      if (top_p !== undefined) opts.top_p = top_p;
      if (max_tokens !== undefined) opts.num_predict = max_tokens;
      if (Object.keys(opts).length) body.options = opts;
      if (Object.keys(rest).length) Object.assign(body, rest);
      return body;
    },
    translateChat: (json) => ({
      content: json?.message?.content ?? null,
      role: json?.message?.role ?? "assistant",
      usage:
        json?.prompt_eval_count != null || json?.eval_count != null
          ? {
              prompt_tokens: json.prompt_eval_count ?? 0,
              completion_tokens: json.eval_count ?? 0,
              total_tokens: (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0),
            }
          : null,
      raw: json,
    }),
    embeddingsUrl: (provider) => `${String(provider.default_api_base_url || "").replace(/\/+$/, "")}/api/embed`,
    embeddingsHeaders: (provider, fields) => buildAuthHeaders(provider, fields),
    embeddingsBody: (model, texts) => ({ model, input: texts }),
    translateEmbeddings: (json) => {
      if (Array.isArray(json?.embeddings)) return json.embeddings;
      // Legacy /api/embeddings shape: { embedding: [...] } for a single input.
      if (Array.isArray(json?.embedding)) return [json.embedding];
      return [];
    },
  },

  // Command Code: custom AI-SDK v5 endpoint (/alpha/generate) that ALWAYS
  // streams NDJSON (one JSON event per line, no `data:` prefix). The response
  // is not JSON, so this executor implements translateChatRaw and the
  // executeChat flow feeds it the raw body.
  commandcode: {
    chatUrl: (provider) => `${String(provider.default_api_base_url || "").replace(/\/+$/, "")}/generate`,
    chatHeaders: (provider, fields) => ({
      ...buildAuthHeaders(provider, fields),
      "content-type": "application/json",
      "x-command-code-version": "0.25.7",
      "x-cli-environment": "cli",
      "x-session-id": randomUUID(),
    }),
    chatBody: (model, messages, options) => ({ model, messages, ...options, stream: true }),
    // NDJSON line parser: accumulate text-delta events; surface error events.
    translateChatRaw: (text) => {
      let content = "";
      let usage = null;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "[DONE]") continue;
        const json = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
        if (!json) continue;
        let ev;
        try {
          ev = JSON.parse(json);
        } catch {
          continue;
        }
        if (!ev?.type) continue;
        if (ev.type === "text-delta") {
          content += ev.text || ev.delta || "";
        } else if (ev.type === "error") {
          const errVal = ev.error ?? ev.message ?? "Command Code returned an error.";
          throw new ExecutorError(502, typeof errVal === "string" ? errVal : JSON.stringify(errVal));
        } else if (ev.type === "finish-step" || ev.type === "finish") {
          const u = ev.usage || ev.totalUsage;
          if (u && (u.inputTokens != null || u.outputTokens != null)) {
            usage = {
              prompt_tokens: u.inputTokens ?? 0,
              completion_tokens: u.outputTokens ?? 0,
              total_tokens: u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
            };
          }
        }
      }
      return { content: content || null, role: "assistant", usage, raw: text };
    },
  },

  // OpenAI Responses API: POST /responses with { model, input, instructions }.
  // Used by perplexity-agent (api key), grok-cli and codex (oauth tokens).
  openaiResponses: {
    chatUrl: (provider) => `${String(provider.default_api_base_url || "").replace(/\/+$/, "")}/responses`,
    chatHeaders: (provider, fields) => ({
      ...buildAuthHeaders(provider, fields),
      "content-type": "application/json",
    }),
    chatBody: (model, messages, options) => {
      // System message maps to the Responses API's `instructions` field.
      const first = messages[0];
      const hasSystem = first?.role === "system";
      const input = hasSystem ? messages.slice(1) : messages;
      const body = {
        model,
        input: input.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") })),
        stream: false,
        ...options,
      };
      if (hasSystem) body.instructions = String(first.content ?? "");
      return body;
    },
    translateChat: (json) => {
      const content = (json?.output || [])
        .filter((item) => item?.type === "message")
        .flatMap((item) => item.content || [])
        .map((part) => part?.text || "")
        .join("");
      return {
        content: content || null,
        role: "assistant",
        usage: json?.usage ?? null,
        raw: json,
      };
    },
  },

  // Cloudflare Workers AI: /accounts/{account_id}/ai/run/{model}.
  cloudflare: {
    chatUrl: (provider, fields, model) => cloudflareRunUrl(provider, fields, model),
    chatHeaders: (provider, fields) => ({
      ...buildAuthHeaders(provider, fields),
      "content-type": "application/json",
    }),
    chatBody: (model, messages, options) => ({ model, messages, ...options }),
    translateChat: (json) => ({
      content: json?.result?.response ?? json?.result?.text ?? null,
      role: "assistant",
      usage: null,
      raw: json,
    }),
    embeddingsUrl: (provider, fields, model) => cloudflareRunUrl(provider, fields, model),
    embeddingsHeaders: (provider, fields) => buildAuthHeaders(provider, fields),
    embeddingsBody: (model, texts) => ({ text: texts }),
    translateEmbeddings: (json) => (json?.result?.data || []).map((d) => d.embedding),
  },
};

// cloudflare_worker_ai is the dedicated Workers AI provider row — same wire format.
EXECUTORS.cloudflare_worker_ai = EXECUTORS.cloudflare;

// ollama-local speaks the exact same /api/chat + /api/embed wire format.
EXECUTORS["ollama-local"] = EXECUTORS.ollama;

// Providers whose gateway endpoint is the OpenAI Responses API.
EXECUTORS["perplexity-agent"] = EXECUTORS.openaiResponses;
EXECUTORS["grok-cli"] = EXECUTORS.openaiResponses;
EXECUTORS.codex = EXECUTORS.openaiResponses;

/** Resolve the executor for a provider_key (default = OpenAI-compatible). */
export function getExecutor(providerKey) {
  return EXECUTORS[providerKey] || EXECUTORS.default;
}

/** First catalog model for a category (chat/embedding), else the first model. */
export function defaultModelFor(provider, category = "chat") {
  const models = provider?.models || [];
  const match = models.find((m) => m.category === category) || models[0];
  return match?.model_key || null;
}

// ------------------------------------------------------------------
// Credential resolution
// ------------------------------------------------------------------

/**
 * Resolve a company + provider + credential and decrypt its fields.
 * Two lookup modes:
 *  - credentialId: fetch the exact credential (must belong to the company)
 *  - providerKey (+ optional credentialKey/environmentKey): resolve the best
 *    credential for the company+provider via CredentialRepository.resolve()
 * @returns {{ company, provider, credential, fields }}
 */
export async function resolveCredentialFields(companyKey, { credentialId, providerKey, credentialKey, environmentKey = null } = {}) {
  const company = await CompanyRepository.findByKey(companyKey);
  if (!company) throw new ExecutorError(404, `Company '${companyKey}' not found.`);

  let provider;
  let row;
  if (credentialId) {
    row = await CredentialRepository.findWithEncrypted(credentialId);
    if (!row) throw new ExecutorError(404, "Credential not found.");
    if (row.company_id !== company.id) throw new ExecutorError(404, "Credential not found for this company.");
    const key = await Registry.providerKeyById(row.provider_id);
    provider = key ? await Registry.getProvider(key) : null;
    if (!provider) throw new ExecutorError(404, `Provider for credential '${row.credential_key}' is not in the catalog.`);
  } else {
    if (!providerKey) throw new ExecutorError(400, "providerKey or credentialId is required.");
    provider = await Registry.getProvider(providerKey);
    if (!provider) throw new ExecutorError(400, `Unknown provider '${providerKey}'.`);
    if (credentialKey) {
      // listByCompany rows carry NO encrypted blob — re-fetch with the blob.
      const byKey = await CredentialRepository.listByCompany(company.id);
      const match = byKey.find((c) => c.credential_key === credentialKey) || null;
      if (!match) throw new ExecutorError(404, `Credential '${credentialKey}' not found for company '${companyKey}'.`);
      row = await CredentialRepository.findWithEncrypted(match.id);
    } else if (provider.round_robin_enabled) {
      // 9Router Round Robin: rotate chat requests across the company's ACTIVE
      // credentials for this provider instead of always resolving the single
      // "best" one. Deterministic per company+provider+day: each day starts
      // at a different credential, so traffic spreads over time and a dead
      // credential isn't hammered by every request. Falls back to the plain
      // resolve() when there's only one active credential.
      const candidates = (await CredentialRepository.listByCompany(company.id, { includeInactive: true }))
        .filter((c) => c.provider_key === providerKey && c.is_active)
        .sort((a, b) => a.id - b.id);
      if (candidates.length > 1) {
        const start = new Date();
        const bucket = Math.floor(start.getTime() / 86_400_000);
        const slot = (company.id * 2654435761 + provider.id * 40503 + bucket) >>> 0;
        const chosen = candidates[slot % candidates.length];
        row = await CredentialRepository.findWithEncrypted(chosen.id);
      } else {
        const resolved = await CredentialRepository.resolve(company.id, provider.id, environmentKey);
        if (!resolved) {
          throw new ExecutorError(404, `No active credential for provider '${providerKey}' in company '${companyKey}'. Create one first.`);
        }
        row = await CredentialRepository.findWithEncrypted(resolved.id);
      }
    } else {
      const resolved = await CredentialRepository.resolve(company.id, provider.id, environmentKey);
      if (!resolved) {
        throw new ExecutorError(404, `No active credential for provider '${providerKey}' in company '${companyKey}'. Create one first.`);
      }
      row = await CredentialRepository.findWithEncrypted(resolved.id);
    }
  }

  let fields;
  try {
    fields = CredentialService.decryptCredential(row.encrypted_credentials);
  } catch (err) {
    throw new ExecutorError(500, `Failed to decrypt credential '${row.credential_key}': ${err.message}`);
  }

  return { company, provider, credential: row, fields };
}

// ------------------------------------------------------------------
// Execution
// ------------------------------------------------------------------

/** Run a chat completion through a company credential.
 *  @returns {{ providerKey, model, content, role, usage, latencyMs, raw }} */
export async function executeChat({ companyKey, credentialId, providerKey, credentialKey, environmentKey, model, messages, options = {} }) {
  const { company, provider, credential, fields } = await resolveCredentialFields(companyKey, {
    credentialId,
    providerKey,
    credentialKey,
    environmentKey,
  });
  const executor = getExecutor(provider.provider_key);
  const resolvedModel = model || defaultModelFor(provider, "chat");
  if (!resolvedModel) {
    throw new ExecutorError(400, `No model specified and provider '${provider.provider_key}' has no default chat model in the catalog.`);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ExecutorError(400, "messages must be a non-empty array of { role, content }.");
  }

  const url = executor.chatUrl(provider, fields, resolvedModel);
  const headers = executor.chatHeaders(provider, fields);
  const body = executor.chatBody(resolvedModel, messages, options);

  const start = Date.now();
  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (err) {
    throw new ExecutorError(502, `Network error calling ${provider.provider_key}: ${err.message}`);
  }
  const latencyMs = Date.now() - start;
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new ExecutorError(502, parseProviderErrorMessage(text, `Provider returned HTTP ${res.status}.`), {
      statusCode: res.status,
    });
  }

  // NDJSON / line-delimited formats (commandcode) aren't JSON — executors with
  // a translateChatRaw hook parse the raw body instead.
  const translated =
    typeof executor.translateChatRaw === "function"
      ? executor.translateChatRaw(text)
      : executor.translateChat(json || {});
  return {
    companyId: company.id,
    credentialId: credential.id,
    providerKey: provider.provider_key,
    model: resolvedModel,
    content: translated.content,
    role: translated.role,
    usage: translated.usage,
    latencyMs,
    raw: translated.raw,
  };
}

/** Run an embeddings request through a company credential.
 *  @returns {{ providerKey, model, embeddings: number[][], latencyMs, raw }} */
export async function executeEmbeddings({ companyKey, credentialId, providerKey, credentialKey, environmentKey, model, texts }) {
  const { company, provider, credential, fields } = await resolveCredentialFields(companyKey, {
    credentialId,
    providerKey,
    credentialKey,
    environmentKey,
  });
  const executor = getExecutor(provider.provider_key);
  const resolvedModel = model || defaultModelFor(provider, "embedding");
  if (!resolvedModel) {
    throw new ExecutorError(400, `No model specified and provider '${provider.provider_key}' has no default embedding model in the catalog.`);
  }
  if (!Array.isArray(texts) || texts.length === 0 || texts.some((t) => !String(t).trim())) {
    throw new ExecutorError(400, "texts must be a non-empty array of non-empty strings.");
  }

  const url = executor.embeddingsUrl(provider, fields, resolvedModel);
  const headers = { ...executor.embeddingsHeaders(provider, fields), "content-type": "application/json" };
  const body = executor.embeddingsBody(resolvedModel, texts);

  const start = Date.now();
  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (err) {
    throw new ExecutorError(502, `Network error calling ${provider.provider_key}: ${err.message}`);
  }
  const latencyMs = Date.now() - start;
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new ExecutorError(502, parseProviderErrorMessage(text, `Provider returned HTTP ${res.status}.`), {
      statusCode: res.status,
    });
  }

  const embeddings = executor.translateEmbeddings(json || {});
  return {
    companyId: company.id,
    credentialId: credential.id,
    providerKey: provider.provider_key,
    model: resolvedModel,
    embeddings,
    latencyMs,
    raw: json,
  };
}
