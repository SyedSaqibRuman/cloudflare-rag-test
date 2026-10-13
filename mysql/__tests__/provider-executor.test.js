// --------------------------
// PROVIDER EXECUTOR TESTS — per-provider wire formats (URL/headers/body +
// response translation) and the executeChat/executeEmbeddings orchestration
// with stubbed repositories + fetch. No MySQL, no network.
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";

// env before any gateway module import (env.js freezes values at import time).
process.env.MYSQL_HOST = "127.0.0.1";
process.env.MYSQL_DATABASE = "gateway_test";
process.env.MYSQL_USER = "test";
process.env.MYSQL_PASSWORD = "test";
process.env.APP_ENCRYPTION_KEY = "cd".repeat(32);

const {
  ProviderRepository,
  ModelRepository,
  EndpointRepository,
  CompanyRepository,
  CredentialRepository,
} = await import("../repositories.js");
const Registry = await import("../services/provider-registry.js");
const CredentialService = await import("../services/credential-service.js");
const Executor = await import("../services/provider-executor.js");
const { getExecutor, executeChat, executeEmbeddings, ExecutorError, defaultModelFor, normalizeAccountId } = Executor;

// ------------------------------------------------------------------
// Fixtures + helpers
// ------------------------------------------------------------------

const OPENAI_PROVIDER = {
  id: 1,
  provider_key: "openai",
  provider_name: "OpenAI",
  primary_service_category: "ai",
  default_api_base_url: "https://api.openai.com/v1",
  auth_type: "bearer_token",
  auth_header_name: "Authorization",
  is_active: 1,
};
const OPENAI_AUTH_FORM = [
  { field_name: "api_key", field_label: "API Key", field_type: "password", is_required: 1, is_encrypted: 1 },
];
const OPENAI_MODELS = [
  { model_key: "gpt-4o", category: "chat" },
  { model_key: "text-embedding-3-small", category: "embedding" },
];

const { blob: OPENAI_BLOB } = CredentialService.encryptCredential({ api_key: "sk-test" }, { api_key: true });

function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

/** Seed the registry cache with a single provider (mirrors the route tests). */
async function seedRegistry({ provider = OPENAI_PROVIDER, authForm = OPENAI_AUTH_FORM, models = OPENAI_MODELS, endpoints = [] } = {}) {
  const restores = [
    stub(ProviderRepository, "list", async () => [provider]),
    stub(ProviderRepository, "capabilitiesByProviderIds", async () => []),
    stub(ProviderRepository, "authFormsByProviderIds", async () =>
      (authForm || []).map((r) => ({ ...r, provider_id: provider.id }))
    ),
    stub(ProviderRepository, "resourceTemplatesByProviderIds", async () => []),
    stub(ModelRepository, "listByProviderIds", async () =>
      (models || []).map((r) => ({ ...r, provider_id: provider.id }))
    ),
    stub(EndpointRepository, "listByProviderIds", async () =>
      (endpoints || []).map((r) => ({ ...r, provider_id: provider.id }))
    ),
  ];
  Registry.invalidateRegistry();
  await Registry.refreshRegistry();
  return () => {
    restores.forEach((r) => r());
    Registry.invalidateRegistry();
  };
}

const COMPANY = { id: 2, company_key: "acme" };
const CRED_ROW = { id: 7, company_id: 2, provider_id: 1, credential_key: "openai-main", encrypted_credentials: OPENAI_BLOB };

/** Stub repositories + fetch for executeChat/executeEmbeddings. Returns restores. */
function stubExecute({ fetchImpl, resolve = async () => ({ id: 7 }) } = {}) {
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) => (key === COMPANY.company_key ? COMPANY : null)),
    stub(CredentialRepository, "resolve", resolve),
    stub(CredentialRepository, "findWithEncrypted", async (id) => (Number(id) === CRED_ROW.id ? CRED_ROW : null)),
  ];
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (fetchImpl) return fetchImpl(url, opts);
    return { ok: true, status: 200, text: async () => "" };
  };
  return {
    calls,
    restore() {
      restores.forEach((r) => r());
      globalThis.fetch = originalFetch;
    },
  };
}

// ------------------------------------------------------------------
// Per-provider wire formats (pure)
// ------------------------------------------------------------------

test("default executor: OpenAI-compatible chat URL/headers/body + translation", () => {
  const ex = getExecutor("openai");
  const url = ex.chatUrl(OPENAI_PROVIDER, { api_key: "sk-1" }, "gpt-4o");
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  assert.deepEqual(ex.chatHeaders(OPENAI_PROVIDER, { api_key: "sk-1" }), {
    Authorization: "Bearer sk-1",
    "content-type": "application/json",
  });
  assert.deepEqual(ex.chatBody("gpt-4o", [{ role: "user", content: "hi" }], { temperature: 0.5 }), {
    model: "gpt-4o",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.5,
  });
  const translated = ex.translateChat({ choices: [{ message: { role: "assistant", content: "Hello!" } }], usage: { total_tokens: 3 } });
  assert.equal(translated.content, "Hello!");
  assert.equal(translated.usage.total_tokens, 3);
});

test("default executor: OpenAI-compatible embeddings", () => {
  const ex = getExecutor("openai");
  assert.equal(ex.embeddingsUrl(OPENAI_PROVIDER), "https://api.openai.com/v1/embeddings");
  assert.deepEqual(ex.embeddingsBody("text-embedding-3-small", ["a", "b"]), {
    model: "text-embedding-3-small",
    input: ["a", "b"],
  });
  assert.deepEqual(ex.translateEmbeddings({ data: [{ embedding: [0.1, 0.2] }] }), [[0.1, 0.2]]);
});

test("anthropic executor: /v1/messages with x-api-key + anthropic-version", () => {
  const provider = {
    default_api_base_url: "https://api.anthropic.com",
    auth_header_name: "x-api-key",
    authForm: [{ field_name: "api_key", is_encrypted: 1, field_type: "password" }],
  };
  const ex = getExecutor("anthropic");
  assert.equal(ex.chatUrl(provider, { api_key: "sk-ant-1" }, "claude-3-5-sonnet"), "https://api.anthropic.com/v1/messages");
  assert.deepEqual(ex.chatHeaders(provider, { api_key: "sk-ant-1" }), {
    "x-api-key": "sk-ant-1",
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  });
  const body = ex.chatBody("claude-3-5-sonnet", [{ role: "user", content: "hi" }], {});
  assert.equal(body.model, "claude-3-5-sonnet");
  assert.equal(body.max_tokens, 1024);
  assert.equal(body.messages[0].content, "hi");
  const translated = ex.translateChat({ content: [{ type: "text", text: "Hi there" }], usage: { input_tokens: 1 } });
  assert.equal(translated.content, "Hi there");
});

test("gemini executor: generateContent with ?key= and role mapping", () => {
  const provider = { default_api_base_url: "https://generativelanguage.googleapis.com/v1beta", auth_header_name: "key" };
  const ex = getExecutor("gemini");
  const url = ex.chatUrl(provider, { api_key: "AIza123" }, "gemini-2.5-flash");
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIza123");
  assert.deepEqual(ex.chatHeaders(provider, { api_key: "AIza123" }), { "content-type": "application/json" });
  const body = ex.chatBody("gemini-2.5-flash", [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }], { temperature: 0 });
  assert.deepEqual(body.contents, [
    { role: "user", parts: [{ text: "hi" }] },
    { role: "model", parts: [{ text: "yo" }] },
  ]);
  assert.deepEqual(body.generationConfig, { temperature: 0 });
  const translated = ex.translateChat({ candidates: [{ content: { parts: [{ text: "A" }, { text: "B" }] } }] });
  assert.equal(translated.content, "AB");
});

test("cloudflare executor: workers_ai endpoint template with account_id", () => {
  const provider = {
    provider_key: "cloudflare_worker_ai",
    default_api_base_url: "https://api.cloudflare.com/client/v4",
    auth_header_name: "Authorization",
    endpoints: [{ endpoint_key: "workers_ai", endpoint_url: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run" }],
    authForm: [{ field_name: "api_token", is_encrypted: 1, field_type: "password" }],
  };
  const ex = getExecutor("cloudflare_worker_ai");
  const url = ex.chatUrl(provider, { api_token: "t-1", account_id: "cf-42" }, "@cf/meta/llama-3.1-8b-instruct");
  assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/cf-42/ai/run/@cf/meta/llama-3.1-8b-instruct");
});

test("cloudflare executor: strips the accounts/ prefix the dashboard URL pastes in", () => {
  const provider = {
    provider_key: "cloudflare_worker_ai",
    default_api_base_url: "https://api.cloudflare.com/client/v4",
    auth_header_name: "Authorization",
    endpoints: [{ endpoint_key: "workers_ai", endpoint_url: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run" }],
    authForm: [{ field_name: "api_token", is_encrypted: 1, field_type: "password" }],
  };
  const ex = getExecutor("cloudflare_worker_ai");
  // The full dashboard path (dash.cloudflare.com/accounts/<id>) pasted into the
  // Account ID field must not double-write /accounts/accounts/<id> in the URL.
  const url = ex.chatUrl(
    provider,
    { api_token: "t-1", account_id: "accounts/e9f4830e0a470de442eb3af9615840c5" },
    "@cf/moondream/moondream3.1-9b-a2b"
  );
  assert.equal(
    url,
    "https://api.cloudflare.com/client/v4/accounts/e9f4830e0a470de442eb3af9615840c5/ai/run/@cf/moondream/moondream3.1-9b-a2b"
  );
  // Case-insensitive + whitespace tolerance, and plain ids pass through.
  assert.equal(normalizeAccountId("  Accounts/cf-9 "), "cf-9");
  assert.equal(normalizeAccountId("cf-42"), "cf-42");
  assert.equal(normalizeAccountId(undefined), "");
  assert.deepEqual(ex.chatHeaders(provider, { api_token: "t-1" }), {
    Authorization: "Bearer t-1",
    "content-type": "application/json",
  });
  assert.equal(ex.translateChat({ result: { response: "Cloudflare says hi" } }).content, "Cloudflare says hi");
  const emb = ex.translateEmbeddings({ result: { data: [{ embedding: [1, 2] }] } });
  assert.deepEqual(emb, [[1, 2]]);
});

test("cloudflare executor: credential base_url override wins over the catalog default", () => {
  // No workers_ai endpoint row, and the provider default_api_base_url ALREADY
  // ends in /accounts (the live catalog row for cloudflare_worker_ai). The
  // credential's saved "API Base URL" field (fields.base_url) must be honored
  // and the /accounts segment must not be doubled.
  const provider = {
    provider_key: "cloudflare_worker_ai",
    default_api_base_url: "https://api.cloudflare.com/client/v4/accounts",
    auth_header_name: "Authorization",
    endpoints: [],
    authForm: [{ field_name: "api_token", is_encrypted: 1, field_type: "password" }],
  };
  const ex = getExecutor("cloudflare_worker_ai");
  // 1. Saved base_url is the plain /client/v4 root → executor appends the path.
  const withRoot = ex.chatUrl(
    provider,
    { api_token: "t-1", account_id: "cf-42", base_url: "https://api.cloudflare.com/client/v4" },
    "@cf/meta/llama-3.1-8b-instruct"
  );
  assert.equal(withRoot, "https://api.cloudflare.com/client/v4/accounts/cf-42/ai/run/@cf/meta/llama-3.1-8b-instruct");
  // 2. Saved base_url already ends in /accounts → never /accounts/accounts.
  const withAccounts = ex.chatUrl(
    provider,
    { api_token: "t-1", account_id: "cf-42", base_url: "https://api.cloudflare.com/client/v4/accounts" },
    "@cf/meta/llama-3.1-8b-instruct"
  );
  assert.equal(withAccounts, "https://api.cloudflare.com/client/v4/accounts/cf-42/ai/run/@cf/meta/llama-3.1-8b-instruct");
  // 3. No override → the /accounts-suffixed default must not be doubled either.
  const noOverride = ex.chatUrl(
    provider,
    { api_token: "t-1", account_id: "cf-42" },
    "@cf/meta/llama-3.1-8b-instruct"
  );
  assert.equal(noOverride, "https://api.cloudflare.com/client/v4/accounts/cf-42/ai/run/@cf/meta/llama-3.1-8b-instruct");
});

test("defaultModelFor picks the first model of the requested category", () => {
  const provider = { models: OPENAI_MODELS };
  assert.equal(defaultModelFor(provider, "chat"), "gpt-4o");
  assert.equal(defaultModelFor(provider, "embedding"), "text-embedding-3-small");
  assert.equal(defaultModelFor({ models: [] }), null);
});

test("ollama executor: /api/chat body (sampling under `options`) + response translation", () => {
  const provider = { default_api_base_url: "https://ollama.com", auth_header_name: "Authorization" };
  const ex = getExecutor("ollama");
  assert.equal(ex.chatUrl(provider, {}, "gpt-oss:120b"), "https://ollama.com/api/chat");
  const body = ex.chatBody("gpt-oss:120b", [{ role: "user", content: "hi" }], {
    temperature: 0.7,
    max_tokens: 512,
    top_p: 0.9,
  });
  assert.deepEqual(body, {
    model: "gpt-oss:120b",
    messages: [{ role: "user", content: "hi" }],
    stream: false,
    options: { temperature: 0.7, top_p: 0.9, num_predict: 512 },
  });
  const translated = ex.translateChat({
    model: "gpt-oss:120b",
    message: { role: "assistant", content: "Ollama says hi" },
    prompt_eval_count: 4,
    eval_count: 3,
  });
  assert.equal(translated.content, "Ollama says hi");
  assert.deepEqual(translated.usage, { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 });
  assert.equal(ex.translateChat({ message: {} }).usage, null);
});

test("ollama executor: /api/embed embeddings (new + legacy shapes)", () => {
  const provider = { default_api_base_url: "http://localhost:11434", auth_header_name: "Authorization" };
  const ex = getExecutor("ollama-local");
  assert.equal(ex.embeddingsUrl(provider), "http://localhost:11434/api/embed");
  assert.deepEqual(ex.embeddingsBody("llama3", ["a", "b"]), { model: "llama3", input: ["a", "b"] });
  assert.deepEqual(ex.translateEmbeddings({ embeddings: [[0.1], [0.2]] }), [[0.1], [0.2]]);
  assert.deepEqual(ex.translateEmbeddings({ embedding: [0.5, 0.6] }), [[0.5, 0.6]]);
});

test("commandcode executor: /alpha/generate with AI-SDK headers + forced stream", () => {
  const provider = {
    default_api_base_url: "https://api.commandcode.ai/alpha",
    auth_header_name: "Authorization",
    authForm: [{ field_name: "api_key", is_encrypted: 1, field_type: "password" }],
  };
  const ex = getExecutor("commandcode");
  assert.equal(ex.chatUrl(provider, {}, "deepseek/deepseek-v4-pro"), "https://api.commandcode.ai/alpha/generate");
  const headers = ex.chatHeaders(provider, { api_key: "user_abc" });
  assert.equal(headers.Authorization, "Bearer user_abc");
  assert.equal(headers["x-command-code-version"], "0.25.7");
  assert.equal(headers["x-cli-environment"], "cli");
  assert.match(headers["x-session-id"], /^[0-9a-f-]{36}$/);
  const body = ex.chatBody("deepseek/deepseek-v4-pro", [{ role: "user", content: "hi" }], { temperature: 0 });
  assert.equal(body.stream, true); // the endpoint only streams NDJSON
  assert.equal(body.model, "deepseek/deepseek-v4-pro");
});

test("commandcode executor: translateChatRaw accumulates text-delta NDJSON events", () => {
  const ex = getExecutor("commandcode");
  const ndjson = [
    JSON.stringify({ type: "start" }),
    JSON.stringify({ type: "text-start", id: "t1" }),
    JSON.stringify({ type: "text-delta", text: "Hello" }),
    JSON.stringify({ type: "text-delta", text: ", world!" }),
    JSON.stringify({ type: "finish-step", finishReason: "stop", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } }),
    JSON.stringify({ type: "finish", totalUsage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } }),
  ].join("\n");
  const translated = ex.translateChatRaw(ndjson);
  assert.equal(translated.content, "Hello, world!");
  assert.deepEqual(translated.usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
});

test("commandcode executor: translateChatRaw surfaces error events as 502", () => {
  const ex = getExecutor("commandcode");
  const ndjson = [
    JSON.stringify({ type: "start" }),
    JSON.stringify({ type: "error", error: "Invalid API key" }),
  ].join("\n");
  assert.throws(
    () => ex.translateChatRaw(ndjson),
    (err) => err instanceof ExecutorError && err.status === 502 && /Invalid API key/.test(err.message)
  );
});

test("openai-responses executor: /responses with instructions + input mapping", () => {
  const provider = { default_api_base_url: "https://api.perplexity.ai/v1", auth_header_name: "Authorization" };
  const ex = getExecutor("perplexity-agent");
  assert.equal(ex.chatUrl(provider, {}, "perplexity/sonar"), "https://api.perplexity.ai/v1/responses");
  const body = ex.chatBody(
    "perplexity/sonar",
    [
      { role: "system", content: "You are terse." },
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo" },
    ],
    { temperature: 0 }
  );
  assert.equal(body.instructions, "You are terse.");
  assert.equal(body.stream, false);
  assert.deepEqual(body.input, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "yo" },
  ]);
  assert.equal(body.temperature, 0);
  const translated = ex.translateChat({
    id: "resp_1",
    output: [
      { type: "reasoning", content: [{ type: "reasoning_text", text: "think" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello" }, { type: "output_text", text: "!" }] },
    ],
    usage: { input_tokens: 3, output_tokens: 2 },
  });
  assert.equal(translated.content, "Hello!");
  assert.equal(translated.usage.output_tokens, 2);
});

test("openai-responses executor: no system message → no instructions field", () => {
  const ex = getExecutor("grok-cli");
  const body = ex.chatBody("grok-4.5", [{ role: "user", content: "hi" }], {});
  assert.equal(body.instructions, undefined);
  assert.deepEqual(body.input, [{ role: "user", content: "hi" }]);
});

// ------------------------------------------------------------------
// executeChat / executeEmbeddings orchestration
// ------------------------------------------------------------------

test("executeChat: OpenAI default model + Bearer auth + response translation", async () => {
  const registryRestore = await seedRegistry();
  const harness = stubExecute({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { role: "assistant", content: "Hello!" } }], usage: { total_tokens: 5 } }),
    }),
  });
  try {
    const result = await executeChat({ companyKey: "acme", providerKey: "openai", messages: [{ role: "user", content: "hi" }] });
    assert.equal(result.providerKey, "openai");
    assert.equal(result.model, "gpt-4o"); // catalog default
    assert.equal(result.content, "Hello!");
    assert.equal(result.credentialId, 7);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(harness.calls[0].opts.headers.Authorization, "Bearer sk-test");
    assert.equal(typeof result.latencyMs, "number");
  } finally {
    harness.restore();
    registryRestore();
  }
});

test("executeChat: explicit model wins over the catalog default", async () => {
  const registryRestore = await seedRegistry();
  const harness = stubExecute();
  try {
    const result = await executeChat({
      companyKey: "acme",
      providerKey: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(result.model, "gpt-4o-mini");
    assert.match(harness.calls[0].opts.body, /gpt-4o-mini/);
  } finally {
    harness.restore();
    registryRestore();
  }
});

test("executeChat: resolves by credentialId", async () => {
  const registryRestore = await seedRegistry();
  const harness = stubExecute();
  try {
    const result = await executeChat({ companyKey: "acme", credentialId: 7, messages: [{ role: "user", content: "hi" }] });
    assert.equal(result.credentialId, 7);
  } finally {
    harness.restore();
    registryRestore();
  }
});

test("executeChat: resolves by providerKey + credentialKey (fetches the encrypted blob)", async () => {
  const registryRestore = await seedRegistry();
  const harness = stubExecute();
  // listByCompany rows have no encrypted blob — the executor must re-fetch
  // via findWithEncrypted so decryption works.
  const listRestore = stub(CredentialRepository, "listByCompany", async () => [
    { id: 7, credential_key: "openai-main", provider_key: "openai" },
  ]);
  try {
    const result = await executeChat({
      companyKey: "acme",
      providerKey: "openai",
      credentialKey: "openai-main",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(result.credentialId, 7);
    // fetch stub returns an empty body → non-JSON → translate yields null content
    assert.equal(result.content, null);
  } finally {
    listRestore();
    harness.restore();
    registryRestore();
  }
});

test("executeChat: unknown credentialKey returns 404", async () => {
  const registryRestore = await seedRegistry();
  const harness = stubExecute();
  const listRestore = stub(CredentialRepository, "listByCompany", async () => []);
  try {
    await assert.rejects(
      () =>
        executeChat({
          companyKey: "acme",
          providerKey: "openai",
          credentialKey: "nope",
          messages: [{ role: "user", content: "hi" }],
        }),
      (err) => err instanceof ExecutorError && err.status === 404 && /'nope' not found/.test(err.message)
    );
  } finally {
    listRestore();
    harness.restore();
    registryRestore();
  }
});

test("executeChat: provider 401 surfaces the provider's error message", async () => {
  const registryRestore = await seedRegistry();
  const harness = stubExecute({
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "Incorrect API key provided" } }),
    }),
  });
  try {
    await assert.rejects(
      () => executeChat({ companyKey: "acme", providerKey: "openai", messages: [{ role: "user", content: "hi" }] }),
      (err) => err instanceof ExecutorError && err.status === 502 && /Incorrect API key provided/.test(err.message)
    );
  } finally {
    harness.restore();
    registryRestore();
  }
});

test("executeChat: rejects an unknown company / provider / missing credential", async () => {
  const registryRestore = await seedRegistry();
  const harness = stubExecute();
  try {
    await assert.rejects(
      () => executeChat({ companyKey: "ghost", providerKey: "openai", messages: [] }),
      (err) => err instanceof ExecutorError && err.status === 404
    );
    // Restore company stub → unknown provider
    const orig = CompanyRepository.findByKey;
    CompanyRepository.findByKey = async (key) => (key === "acme" ? COMPANY : null);
    await assert.rejects(
      () => executeChat({ companyKey: "acme", providerKey: "ghost", messages: [{ role: "user", content: "hi" }] }),
      (err) => err instanceof ExecutorError && err.status === 400
    );
    CompanyRepository.findByKey = orig;
  } finally {
    harness.restore();
    registryRestore();
  }
});

test("executeChat: empty messages rejected with 400", async () => {
  const registryRestore = await seedRegistry();
  const harness = stubExecute();
  try {
    await assert.rejects(
      () => executeChat({ companyKey: "acme", providerKey: "openai", messages: [] }),
      (err) => err instanceof ExecutorError && err.status === 400 && /messages/.test(err.message)
    );
  } finally {
    harness.restore();
    registryRestore();
  }
});

test("executeChat: commandcode NDJSON response flows through translateChatRaw", async () => {
  const CMD_PROVIDER = {
    id: 9,
    provider_key: "commandcode",
    provider_name: "Command Code",
    primary_service_category: "ai",
    default_api_base_url: "https://api.commandcode.ai/alpha",
    auth_type: "custom",
    auth_header_name: "Authorization",
    is_active: 1,
  };
  const CMD_AUTH = [{ field_name: "api_key", field_label: "Key", field_type: "password", is_required: 1, is_encrypted: 1 }];
  const CMD_MODELS = [{ model_key: "deepseek/deepseek-v4-pro", category: "chat" }];
  const { blob: CMD_BLOB } = CredentialService.encryptCredential({ api_key: "user_x" }, { api_key: true });
  const CMD_CRED = { id: 11, company_id: 2, provider_id: 9, credential_key: "cmd", encrypted_credentials: CMD_BLOB };
  const ndjson = [
    JSON.stringify({ type: "start" }),
    JSON.stringify({ type: "text-delta", text: "From Command Code" }),
    JSON.stringify({ type: "finish", finishReason: "stop" }),
  ].join("\n");

  const registryRestore = await seedRegistry({
    provider: CMD_PROVIDER,
    authForm: CMD_AUTH,
    models: CMD_MODELS,
  });
  const restores = [
    stub(CompanyRepository, "findByKey", async (k) => (k === "acme" ? COMPANY : null)),
    stub(CredentialRepository, "resolve", async () => ({ id: 11 })),
    stub(CredentialRepository, "findWithEncrypted", async (id) => (Number(id) === 11 ? CMD_CRED : null)),
  ];
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => ndjson };
  };
  try {
    const result = await executeChat({
      companyKey: "acme",
      providerKey: "commandcode",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(result.providerKey, "commandcode");
    assert.equal(result.model, "deepseek/deepseek-v4-pro");
    assert.equal(result.content, "From Command Code");
    assert.equal(calls[0].url, "https://api.commandcode.ai/alpha/generate");
    assert.equal(JSON.parse(calls[0].opts.body).stream, true);
  } finally {
    restores.forEach((r) => r());
    globalThis.fetch = originalFetch;
    registryRestore();
  }
});

test("executeEmbeddings: OpenAI-compatible embeddings call", async () => {
  const registryRestore = await seedRegistry();
  const harness = stubExecute({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }),
    }),
  });
  try {
    const result = await executeEmbeddings({ companyKey: "acme", providerKey: "openai", texts: ["a", "b"] });
    assert.equal(result.model, "text-embedding-3-small");
    assert.deepEqual(result.embeddings, [[0.1, 0.2], [0.3, 0.4]]);
    assert.equal(harness.calls[0].url, "https://api.openai.com/v1/embeddings");
  } finally {
    harness.restore();
    registryRestore();
  }
});
