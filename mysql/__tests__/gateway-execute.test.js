// --------------------------
// GATEWAY EXECUTE ROUTE TESTS — POST /gateway/companies/:key/execute/chat and
// /embeddings, exercised through a real express mount with stubbed repositories
// + fetch (no MySQL, no network). Same harness as gateway-credentials.test.js.
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

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
  AuditRepository,
} = await import("../repositories.js");
const Registry = await import("../services/provider-registry.js");
const CredentialService = await import("../services/credential-service.js");
const gatewayRouter = (await import("../gateway-router.js")).default;

const PROVIDER = {
  id: 1,
  provider_key: "openai",
  provider_name: "OpenAI",
  primary_service_category: "ai",
  default_api_base_url: "https://api.openai.com/v1",
  auth_type: "bearer_token",
  auth_header_name: "Authorization",
  is_active: 1,
};
const AUTH_FORM = [
  { field_name: "api_key", field_label: "API Key", field_type: "password", is_required: 1, is_encrypted: 1, validation_regex: "^sk-[A-Za-z0-9]{20,}$" },
];
const MODELS = [
  { model_key: "gpt-4o", category: "chat" },
  { model_key: "text-embedding-3-small", category: "embedding" },
];

const { blob: BLOB } = CredentialService.encryptCredential({ api_key: "sk-valid-12345678901234567890" }, { api_key: true });
const CRED_ROW = { id: 7, company_id: 2, provider_id: 1, credential_key: "openai-main", encrypted_credentials: BLOB };
const COMPANY = { id: 2, company_key: "acme" };

function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

async function seedRegistry({ provider = PROVIDER } = {}) {
  const restores = [
    stub(ProviderRepository, "list", async () => [provider]),
    stub(ProviderRepository, "capabilitiesByProviderIds", async () => []),
    stub(ProviderRepository, "authFormsByProviderIds", async () =>
      AUTH_FORM.map((r) => ({ ...r, provider_id: PROVIDER.id }))
    ),
    stub(ProviderRepository, "resourceTemplatesByProviderIds", async () => []),
    stub(ModelRepository, "listByProviderIds", async () => MODELS.map((r) => ({ ...r, provider_id: PROVIDER.id }))),
    stub(EndpointRepository, "listByProviderIds", async () => []),
  ];
  Registry.invalidateRegistry();
  await Registry.refreshRegistry();
  return () => {
    restores.forEach((r) => r());
    Registry.invalidateRegistry();
  };
}

/** Stub company/credential/audit + fetch (URL-dispatched so the test server works). */
function stubDeps({ fetchImpl } = {}) {
  const auditLog = [];
  const providerCalls = [];
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) => (key === COMPANY.company_key ? COMPANY : null)),
    stub(CredentialRepository, "resolve", async () => ({ id: CRED_ROW.id })),
    stub(CredentialRepository, "findWithEncrypted", async (id) => (Number(id) === CRED_ROW.id ? CRED_ROW : null)),
    stub(AuditRepository, "log", async (entry) => auditLog.push(entry)),
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (url.startsWith("http://127.0.0.1")) return originalFetch(url, opts);
    providerCalls.push({ url, opts });
    if (fetchImpl) return fetchImpl(url, opts);
    return { ok: true, status: 200, text: async () => "" };
  };
  return {
    auditLog,
    providerCalls,
    restore() {
      restores.forEach((r) => r());
      globalThis.fetch = originalFetch;
    },
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/gateway", gatewayRouter);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function req(server, method, urlPath, body) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { res, json };
}

// ------------------------------------------------------------------
// POST /gateway/companies/:key/execute/chat
// ------------------------------------------------------------------

test("execute/chat returns a normalized completion through the provider", async () => {
  const registryRestore = await seedRegistry();
  const deps = stubDeps({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "Hello from OpenAI!" } }], usage: { total_tokens: 9 } }),
    }),
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/execute/chat", {
      providerKey: "openai",
      messages: [{ role: "user", content: "Say hi" }],
    });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.providerKey, "openai");
    assert.equal(json.model, "gpt-4o");
    assert.equal(json.content, "Hello from OpenAI!");
    assert.equal(json.usage.total_tokens, 9);
    assert.equal(typeof json.latencyMs, "number");
    // Internal ids / raw payloads must not leak into the response.
    assert.equal(json.companyId, undefined);
    assert.equal(json.raw, undefined);
    assert.equal(deps.providerCalls.length, 1);
    assert.equal(deps.providerCalls[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(deps.providerCalls[0].opts.headers.Authorization, "Bearer sk-valid-12345678901234567890");
    assert.equal(deps.auditLog.length, 1);
    assert.equal(deps.auditLog[0].action, "provider.execute.chat");
  } finally {
    deps.restore();
    registryRestore();
    server.close();
  }
});

test("execute/chat rotates across credentials when the provider has round robin enabled", async () => {
  // Same harness as the happy path, but the provider row carries
  // round_robin_enabled=1 and listByCompany returns two ACTIVE candidate
  // credentials (different api_key secrets). The executor must pick one of
  // the candidates (never CredentialRepository.resolve) and call the
  // provider with that credential's secret.
  const rrProvider = { ...PROVIDER, round_robin_enabled: 1 };
  const registryRestore = await seedRegistry({ provider: rrProvider });
  const auditLog = [];
  const providerCalls = [];
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) => (key === COMPANY.company_key ? COMPANY : null)),
    stub(CredentialRepository, "resolve", async () => {
      throw new Error("resolve() must not be called when round robin is enabled");
    }),
    stub(CredentialRepository, "listByCompany", async () => [
      { id: 10, credential_key: "openai-a", provider_key: "openai", is_active: 1 },
      { id: 11, credential_key: "openai-b", provider_key: "openai", is_active: 1 },
    ]),
    stub(CredentialRepository, "findWithEncrypted", async (id) => {
      const secret = Number(id) === 10 ? "sk-aaaa-12345678901234567890" : "sk-bbbb-12345678901234567890";
      const { blob } = CredentialService.encryptCredential({ api_key: secret }, { api_key: true });
      return { id: Number(id), company_id: 2, provider_id: 1, credential_key: `openai-${id}`, encrypted_credentials: blob };
    }),
    stub(AuditRepository, "log", async (entry) => auditLog.push(entry)),
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (url.startsWith("http://127.0.0.1")) return originalFetch(url, opts);
    providerCalls.push({ url, opts });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" } }] }),
    };
  };
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/execute/chat", {
      providerKey: "openai",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(providerCalls.length, 1);
    const auth = providerCalls[0].opts.headers.Authorization;
    assert.ok(
      auth === "Bearer sk-aaaa-12345678901234567890" || auth === "Bearer sk-bbbb-12345678901234567890",
      `expected one of the rotated credentials' secrets, got ${auth}`
    );
    assert.equal(auditLog.length, 1);
  } finally {
    restores.forEach((r) => r());
    globalThis.fetch = originalFetch;
    registryRestore();
    server.close();
  }
});

test("execute/chat returns 404 when no credential exists for the provider", async () => {
  const registryRestore = await seedRegistry();
  const deps = stubDeps();
  deps.restore();
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) => (key === COMPANY.company_key ? COMPANY : null)),
    stub(CredentialRepository, "resolve", async () => null),
  ];
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/execute/chat", {
      providerKey: "openai",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(res.status, 404);
    assert.match(json.error, /No active credential/);
  } finally {
    restores.forEach((r) => r());
    registryRestore();
    server.close();
  }
});

test("execute/chat returns 400 for an unknown provider", async () => {
  const registryRestore = await seedRegistry();
  // Only the company lookup is needed here — the provider check happens next.
  const restoreCompany = stub(CompanyRepository, "findByKey", async (key) =>
    key === COMPANY.company_key ? COMPANY : null
  );
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/execute/chat", {
      providerKey: "ghost",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown provider 'ghost'/);
  } finally {
    restoreCompany();
    registryRestore();
    server.close();
  }
});

test("execute/chat returns 502 with the provider's error message on a failed upstream call", async () => {
  const registryRestore = await seedRegistry();
  const deps = stubDeps({
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "Incorrect API key provided" } }),
    }),
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/execute/chat", {
      providerKey: "openai",
      messages: [{ role: "user", content: "hi" }],
    });
    assert.equal(res.status, 502);
    assert.equal(json.success, false);
    assert.equal(json.error, "Incorrect API key provided");
  } finally {
    deps.restore();
    registryRestore();
    server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/companies/:key/execute/embeddings
// ------------------------------------------------------------------

test("execute/embeddings returns vector arrays", async () => {
  const registryRestore = await seedRegistry();
  const deps = stubDeps({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }),
    }),
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/execute/embeddings", {
      providerKey: "openai",
      texts: ["hello world"],
    });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.model, "text-embedding-3-small");
    assert.deepEqual(json.embeddings, [[0.1, 0.2]]);
    assert.equal(deps.providerCalls[0].url, "https://api.openai.com/v1/embeddings");
    assert.equal(deps.auditLog[0].action, "provider.execute.embeddings");
  } finally {
    deps.restore();
    registryRestore();
    server.close();
  }
});
