// --------------------------
// GATEWAY CREDENTIAL ROUTE TESTS — the PUT /gateway/credentials/:id update
// endpoint, exercised through a real express mount with stubbed repositories
// (no MySQL, no network). The router imports `* as Registry` (a frozen ESM
// namespace), so the registry cache is seeded through the mutable repository
// objects it reads from + invalidateRegistry()/refreshRegistry(), exactly like
// gateway-resources.test.js. Encryption is REAL (a test APP_ENCRYPTION_KEY is
// set at the top), so the merge-and-re-encrypt path is exercised end to end.
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

// The router's `gate` middleware reads env.MYSQL_* at import time (env.js
// freezes them), so set dummies BEFORE any gateway module is imported. All
// repository methods are stubbed below, so the lazy pool is never touched.
process.env.MYSQL_HOST = "127.0.0.1";
process.env.MYSQL_DATABASE = "gateway_test";
process.env.MYSQL_USER = "test";
process.env.MYSQL_PASSWORD = "test";
// CredentialService reads APP_ENCRYPTION_KEY lazily — a 64-hex test key makes
// the encrypt/decrypt path real without touching production secrets.
process.env.APP_ENCRYPTION_KEY = "cd".repeat(32);

const {
  ProviderRepository,
  ModelRepository,
  EndpointRepository,
  CompanyRepository,
  CredentialRepository,
  ResourceRepository,
  AuditRepository,
} = await import("../repositories.js");
const Registry = await import("../services/provider-registry.js");
const CredentialService = await import("../services/credential-service.js");
const gatewayRouter = (await import("../gateway-router.js")).default;

const PROVIDER = { id: 1, provider_key: "cloudflare", provider_name: "Cloudflare" };

// Auth-schema rows drive both the merge validation (validation_regex) and the
// encryption map (is_encrypted) — mirror what the registry's authForm rows
// look like.
const AUTH_FORM = [
  {
    field_name: "api_token",
    field_label: "API Token",
    field_type: "password",
    is_required: 1,
    validation_regex: "^[A-Za-z0-9_-]{4,}$",
    is_encrypted: 1,
  },
];

// Real encrypted blob holding the "stored" secret, so the route's decrypt →
// merge → re-encrypt path runs against real crypto.
const { blob: STORED_BLOB } = CredentialService.encryptCredential(
  { api_token: "sk-old" },
  { api_token: true }
);

// Row shape findWithEncrypted() returns (config is JSON-parsed by mapRow).
const ROW = {
  id: 7,
  company_id: 2,
  provider_id: 1,
  environment_id: null,
  credential_key: "cf-main",
  credential_name: "CF Main",
  encrypted_credentials: STORED_BLOB,
  encryption_version: 1,
  config: null,
  priority: 100,
  is_default: 0,
  rotation_policy: "manual",
  auto_rotate_enabled: 0,
};

/** Stub a repository method, returning a restore function. */
function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

/** Seed the registry cache with a provider + auth form (see resources tests). */
async function seedRegistry({ provider = PROVIDER, authForm = AUTH_FORM } = {}) {
  const restores = [
    stub(ProviderRepository, "list", async () => [provider]),
    stub(ProviderRepository, "capabilitiesByProviderIds", async () => []),
    stub(ProviderRepository, "authFormsByProviderIds", async () =>
      (authForm || []).map((r) => ({ ...r, provider_id: provider.id }))
    ),
    stub(ProviderRepository, "resourceTemplatesByProviderIds", async () => []),
    stub(ModelRepository, "listByProviderIds", async () => []),
    stub(EndpointRepository, "listByProviderIds", async () => []),
  ];
  Registry.invalidateRegistry();
  await Registry.refreshRegistry();
  return () => {
    restores.forEach((r) => r());
    Registry.invalidateRegistry();
  };
}

/**
 * Happy-path stubs: the credential row resolves, the update succeeds, the
 * audit is captured, and the registry is seeded with the provider. Returns
 * { restores, auditLog, calls } where calls.updateArgs is captured for
 * assertions.
 */
async function stubHappy({ row = ROW } = {}) {
  const auditLog = [];
  const calls = { updateArgs: null };
  const registryRestore = await seedRegistry();
  const restores = [
    registryRestore,
    stub(CredentialRepository, "findWithEncrypted", async (id) =>
      Number(id) === row.id ? row : null
    ),
    stub(CredentialRepository, "update", async (id, input) => {
      calls.updateArgs = { id, input };
      return true;
    }),
    stub(CompanyRepository, "environments", async () => [
      { id: 5, env_key: "prod" },
      { id: 6, env_key: "staging" },
    ]),
    // The RAG-sync hook looks the company up by id — stub it so the sync's
    // updateCompany('acme', …) resolves against the (empty) runtime config and
    // bails with "Company not found" instead of touching MySQL.
    stub(CompanyRepository, "findById", async (id) => (Number(id) === row.company_id ? { id: 2, company_key: "acme" } : null)),
    stub(AuditRepository, "log", async (entry) => {
      auditLog.push(entry);
    }),
  ];
  return { restores, auditLog, calls };
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
// POST /gateway/credentials/model-access/bulk — 9Router Disable All
// ------------------------------------------------------------------

test("model-access bulk disables every grant of the company's provider and audits", async () => {
  const registryRestore = await seedRegistry();
  const auditLog = [];
  const restores = [
    registryRestore,
    stub(CompanyRepository, "findByKey", async (key) => (key === "acme" ? { id: 2, company_key: "acme" } : null)),
    stub(ResourceRepository, "setModelAccessByProvider", async (companyId, providerId, opts) => {
      assert.equal(companyId, 2);
      assert.equal(providerId, 1);
      assert.equal(opts.enabled, false);
      return 3;
    }),
    stub(AuditRepository, "log", async (entry) => auditLog.push(entry)),
  ];
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/credentials/model-access/bulk", {
      companyKey: "acme",
      providerKey: "cloudflare",
      enabled: false,
    });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.affected, 3);
    assert.match(json.message, /Disabled 3/);
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "model_access.bulk_updated");
    assert.deepEqual(auditLog[0].afterState, { provider_key: "cloudflare", enabled: false, affected_grants: 3 });
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("model-access bulk returns 400 when companyKey or providerKey is missing", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/credentials/model-access/bulk", {
      providerKey: "cloudflare",
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /companyKey and providerKey are required/);
  } finally {
    server.close();
  }
});

// ------------------------------------------------------------------
// PUT /gateway/credentials/:id — guards
// ------------------------------------------------------------------

test("PUT credential returns 404 for an unknown credential", async () => {
  const restoreFind = stub(CredentialRepository, "findWithEncrypted", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/credentials/999", {
      credentialName: "X",
    });
    assert.equal(res.status, 404);
    assert.match(json.error, /Credential not found/);
  } finally {
    restoreFind();
    server.close();
  }
});

test("PUT credential rejects an empty credentialName with 400", async () => {
  const restoreFind = stub(CredentialRepository, "findWithEncrypted", async () => ROW);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/credentials/7", {
      credentialName: "   ",
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /credentialName cannot be empty/);
  } finally {
    restoreFind();
    server.close();
  }
});

test("PUT credential rejects an unknown environment with 400", async () => {
  const restoreFind = stub(CredentialRepository, "findWithEncrypted", async () => ROW);
  const restoreEnvs = stub(CompanyRepository, "environments", async () => [
    { id: 5, env_key: "prod" },
  ]);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/credentials/7", {
      environmentKey: "staging",
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown environment 'staging'/);
  } finally {
    restoreFind();
    restoreEnvs();
    server.close();
  }
});

test("PUT credential rejects a secret that fails the provider validation regex", async () => {
  const { restores } = await stubHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/credentials/7", {
      fields: { api_token: "bad token!" },
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Invalid credential fields/);
    assert.ok(json.errors, "validation errors object should be returned");
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

// ------------------------------------------------------------------
// PUT /gateway/credentials/:id — success paths
// ------------------------------------------------------------------

test("PUT credential updates metadata only, preserves the stored blob, and audits credential.updated", async () => {
  const { restores, auditLog, calls } = await stubHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/credentials/7", {
      credentialName: "CF Main v2",
      environmentKey: "prod",
      isDefault: true,
    });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.match(json.message, /updated/);
    assert.doesNotMatch(json.message, /re-encrypted/);
    assert.equal(calls.updateArgs.id, 7);
    assert.equal(calls.updateArgs.input.credentialName, "CF Main v2");
    assert.equal(calls.updateArgs.input.environmentId, 5);
    assert.equal(calls.updateArgs.input.isDefault, true);
    // No secret fields were provided — the stored blob must be left untouched
    // (the repository's update() treats undefined as "keep the stored blob").
    assert.equal(calls.updateArgs.input.encryptedCredentials, undefined);
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "credential.updated");
    assert.equal(auditLog[0].entityType, "credential");
    assert.equal(auditLog[0].entityId, 7);
    assert.equal(auditLog[0].isSensitive, false);
    assert.deepEqual(auditLog[0].beforeState, {
      credential_key: "cf-main",
      credential_name: "CF Main",
      environment_id: null,
      is_default: false,
    });
    assert.deepEqual(auditLog[0].afterState, {
      credential_key: "cf-main",
      credential_name: "CF Main v2",
      environment_id: 5,
      is_default: true,
    });
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("PUT credential with secrets refuses when the provider is not in the registry (no plaintext downgrade)", async () => {
  // Seed an EMPTY registry (refresh succeeds, but providerKeyById resolves
  // null) so the route must 400 rather than re-encrypt with an empty map.
  const restores = [
    stub(ProviderRepository, "list", async () => []),
    stub(ProviderRepository, "capabilitiesByProviderIds", async () => []),
    stub(ProviderRepository, "authFormsByProviderIds", async () => []),
    stub(ProviderRepository, "resourceTemplatesByProviderIds", async () => []),
    stub(ModelRepository, "listByProviderIds", async () => []),
    stub(EndpointRepository, "listByProviderIds", async () => []),
  ];
  Registry.invalidateRegistry();
  await Registry.refreshRegistry();
  const restoreFind = stub(CredentialRepository, "findWithEncrypted", async () => ROW);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/credentials/7", {
      fields: { api_token: "sk-new" },
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown provider for credential/);
  } finally {
    restoreFind();
    restores.forEach((r) => r());
    Registry.invalidateRegistry();
    server.close();
  }
});

test("PUT credential merges new secret values over the stored blob and re-encrypts", async () => {
  const { restores, auditLog, calls } = await stubHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/credentials/7", {
      credentialName: "CF Main v2",
      fields: { api_token: "sk-new" },
    });
    assert.equal(res.status, 200);
    assert.match(json.message, /re-encrypted/);
    // The updated blob must decrypt back to the MERGED plaintext (new value
    // wins, the old stored value is gone) — no secrets in the response.
    const merged = CredentialService.decryptCredential(calls.updateArgs.input.encryptedCredentials);
    assert.deepEqual(merged, { api_token: "sk-new" });
    assert.equal(auditLog[0].isSensitive, true);
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("PUT credential can clear the environment with an empty environmentKey", async () => {
  const rowWithEnv = { ...ROW, environment_id: 5 };
  const { restores, calls } = await stubHappy({ row: rowWithEnv });
  const server = await listen(makeApp());
  try {
    const { res } = await req(server, "PUT", "/gateway/credentials/7", {
      environmentKey: "",
    });
    assert.equal(res.status, 200);
    assert.equal(calls.updateArgs.input.environmentId, null);
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/companies/:key/connections/test — pre-save "Check" flow
// (9Router-style test-before-connect). Read-only: never persists, never
// audits, never touches the credential tables.
// ------------------------------------------------------------------

// The credentials router imports PROBES statically — stub the shared map's
// entries directly (same object reference) so no network happens.
const PROBES = (await import("../routes/probes.js")).PROBES;

const COMPANY = { id: 2, company_key: "acme" };

/** Registry + company + probe stubs for the connections/test endpoint. */
async function stubTestRoute({ probe } = {}) {
  const registryRestore = await seedRegistry();
  const probeRestore = stub(PROBES, "cloudflare", probe ?? (async () => ({ ok: true, latencyMs: 42 })));
  const companyRestore = stub(CompanyRepository, "findByKey", async (key) =>
    key === COMPANY.company_key ? COMPANY : null
  );
  return () => {
    registryRestore();
    probeRestore();
    companyRestore();
  };
}

test("connections/test returns 404 for an unknown company", async () => {
  const restore = await stubTestRoute();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/ghost/connections/test", {
      providerKey: "cloudflare",
      fields: { api_token: "sk-valid-1234" },
    });
    assert.equal(res.status, 404);
    assert.match(json.error, /Company 'ghost' not found/);
  } finally {
    restore();
    server.close();
  }
});

test("connections/test returns 400 for an unknown provider", async () => {
  const restore = await stubTestRoute();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/connections/test", {
      providerKey: "ghost",
      fields: { api_token: "sk-valid-1234" },
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown provider 'ghost'/);
  } finally {
    restore();
    server.close();
  }
});

test("connections/test rejects fields failing the auth schema (format-level)", async () => {
  const restore = await stubTestRoute();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/connections/test", {
      providerKey: "cloudflare",
      fields: { api_token: "bad token!" },
    });
    // Format failures return 200 with status failed — the modal shows the error
    // inline without a network probe having run.
    assert.equal(res.status, 200);
    assert.equal(json.status, "failed");
    assert.equal(json.success, false);
    assert.match(json.error, /does not match the expected format/);
    assert.ok(json.errors, "per-field errors map should be returned");
    assert.equal(json.latencyMs, null);
  } finally {
    restore();
    server.close();
  }
});

test("connections/test reports success when the live probe passes", async () => {
  const restore = await stubTestRoute({ probe: async () => ({ ok: true, latencyMs: 33 }) });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/connections/test", {
      providerKey: "cloudflare",
      fields: { api_token: "sk-valid-1234" },
    });
    assert.equal(res.status, 200);
    assert.equal(json.status, "success");
    assert.equal(json.success, true);
    assert.equal(json.latencyMs, 33);
    assert.equal(json.error, null);
  } finally {
    restore();
    server.close();
  }
});

test("connections/test reports the probe error when the live probe fails", async () => {
  const restore = await stubTestRoute({ probe: async () => ({ ok: false, error: "Invalid API token." }) });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/connections/test", {
      providerKey: "cloudflare",
      fields: { api_token: "sk-valid-1234" },
    });
    assert.equal(res.status, 200);
    assert.equal(json.status, "failed");
    assert.equal(json.success, false);
    assert.equal(json.error, "Invalid API token.");
  } finally {
    restore();
    server.close();
  }
});

test("connections/test surfaces a soft-fail warning from the probe", async () => {
  const restore = await stubTestRoute({
    probe: async () => ({ ok: true, latencyMs: 5, warning: "Connected, but quota exhausted." }),
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/connections/test", {
      providerKey: "cloudflare",
      fields: { api_token: "sk-valid-1234" },
    });
    assert.equal(res.status, 200);
    assert.equal(json.status, "success");
    assert.equal(json.success, true);
    assert.equal(json.latencyMs, 5);
    assert.equal(json.warning, "Connected, but quota exhausted.");
  } finally {
    restore();
    server.close();
  }
});

test("connections/test runs the schema-driven generic probe for providers without a hand-written probe", async () => {
  // A wizard-created LLM provider (base URL + auth header + key field, no
  // PROBES entry) must get a live GET {base}/models check. fetch is dispatched
  // by URL so the local test server keeps working.
  const genericProvider = {
    id: 9,
    provider_key: "acme-ai",
    provider_name: "Acme AI",
    primary_service_category: "ai",
    default_api_base_url: "https://api.acme.example/v1",
    auth_type: "bearer_token",
    auth_header_name: "Authorization",
  };
  const genericAuthForm = [
    {
      field_name: "api_key",
      field_label: "API Key",
      field_type: "password",
      is_required: 1,
      is_encrypted: 1,
      validation_regex: "^[A-Za-z0-9_-]{4,}$",
    },
  ];
  const registryRestore = await seedRegistry({ provider: genericProvider, authForm: genericAuthForm });
  const companyRestore = stub(CompanyRepository, "findByKey", async (key) =>
    key === COMPANY.company_key ? COMPANY : null
  );
  const originalFetch = globalThis.fetch;
  const probeCalls = [];
  globalThis.fetch = async (url, opts) => {
    if (url.startsWith("http://127.0.0.1")) return originalFetch(url, opts);
    probeCalls.push({ url, opts });
    return { ok: true, status: 200, text: async () => "" };
  };
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/connections/test", {
      providerKey: "acme-ai",
      fields: { api_key: "sk-valid-1234" },
    });
    assert.equal(res.status, 200);
    assert.equal(json.status, "success");
    assert.equal(json.success, true);
    assert.equal(probeCalls.length, 1);
    assert.equal(probeCalls[0].url, "https://api.acme.example/v1/models");
    assert.equal(probeCalls[0].opts.headers.Authorization, "Bearer sk-valid-1234");
    assert.equal(typeof json.latencyMs, "number");
  } finally {
    globalThis.fetch = originalFetch;
    registryRestore();
    companyRestore();
    server.close();
  }
});

test("connections/test skips the probe for providers without one (format-only)", async () => {
  // Seed a provider WITHOUT a probe: weaviate has no PROBES entry and no
  // default_api_base_url, so neither the hand-written nor the generic probe
  // applies — format validation passes, no network, status is success.
  const noProbeProvider = { id: 3, provider_key: "weaviate", provider_name: "Weaviate" };
  const registryRestore = await seedRegistry({ provider: noProbeProvider });
  const companyRestore = stub(CompanyRepository, "findByKey", async (key) =>
    key === COMPANY.company_key ? COMPANY : null
  );
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/connections/test", {
      providerKey: "weaviate",
      fields: { api_token: "sk-valid-1234" },
    });
    assert.equal(res.status, 200);
    assert.equal(json.status, "success");
    assert.equal(json.latencyMs, null);
    assert.equal(json.error, null);
  } finally {
    registryRestore();
    companyRestore();
    server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/credentials/test-batch — 9Router "Test All" flow.
// Runs the same decrypt → schema-validate → live-probe pipeline per active
// credential and returns a summary + per-credential results.
// ------------------------------------------------------------------
const BATCH_ROW = {
  id: 11,
  company_id: 2,
  provider_id: 1,
  provider_key: "cloudflare",
  credential_key: "cf-main",
  credential_name: "CF Main",
  encrypted_credentials: STORED_BLOB,
  is_active: 1,
};

async function stubBatch({ rows = [BATCH_ROW], probe } = {}) {
  const auditLog = [];
  const registryRestore = await seedRegistry();
  const probeRestore = stub(PROBES, "cloudflare", probe ?? (async () => ({ ok: true, latencyMs: 42 })));
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) =>
      key === COMPANY.company_key ? COMPANY : null
    ),
    stub(CredentialRepository, "listByCompany", async () => rows),
    stub(CredentialRepository, "recordVerification", async () => {}),
    stub(AuditRepository, "log", async (entry) => {
      auditLog.push(entry);
    }),
  ];
  return {
    restore: () => {
      registryRestore();
      probeRestore();
      restores.forEach((r) => r());
    },
    auditLog,
  };
}

test("test-batch returns 400 when companyKey is missing", async () => {
  const { restore } = await stubBatch();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/credentials/test-batch", { group: "apikey" });
    assert.equal(res.status, 400);
    assert.match(json.error, /companyKey is required/);
  } finally {
    restore();
    server.close();
  }
});

test("test-batch returns 404 for an unknown company", async () => {
  const { restore } = await stubBatch();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/credentials/test-batch", {
      companyKey: "ghost",
      group: "apikey",
    });
    assert.equal(res.status, 404);
    assert.match(json.error, /Company 'ghost' not found/);
  } finally {
    restore();
    server.close();
  }
});

test("test-batch verifies each active credential and summarizes the run", async () => {
  const { restore, auditLog } = await stubBatch();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/credentials/test-batch", {
      companyKey: "acme",
      group: "apikey",
    });
    assert.equal(res.status, 200);
    assert.equal(json.mode, "apikey");
    assert.deepEqual(json.summary, { total: 1, passed: 1, failed: 0 });
    assert.equal(json.results.length, 1);
    assert.equal(json.results[0].credentialId, 11);
    assert.equal(json.results[0].credentialName, "CF Main");
    assert.equal(json.results[0].providerKey, "cloudflare");
    assert.equal(json.results[0].valid, true);
    assert.equal(json.results[0].latencyMs, 42);
    assert.equal(json.results[0].diagnosis, null);
    // Every run is recorded + audited, like the single verify endpoint.
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "credential.verified.success");
  } finally {
    restore();
    server.close();
  }
});

test("test-batch marks failures with a 9Router-style diagnosis code", async () => {
  const { restore } = await stubBatch({
    probe: async () => ({ ok: false, error: "Invalid API token." }),
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/credentials/test-batch", {
      companyKey: "acme",
      group: "apikey",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(json.summary, { total: 1, passed: 0, failed: 1 });
    assert.equal(json.results[0].valid, false);
    assert.equal(json.results[0].diagnosis, "AUTH");
    assert.equal(json.results[0].error, "Invalid API token.");
  } finally {
    restore();
    server.close();
  }
});

test("test-batch filters by section group (oauth group excludes apikey creds)", async () => {
  const { restore } = await stubBatch();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/credentials/test-batch", {
      companyKey: "acme",
      group: "oauth",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(json.summary, { total: 0, passed: 0, failed: 0 });
    assert.deepEqual(json.results, []);
  } finally {
    restore();
    server.close();
  }
});

test("test-batch can target a single provider via providerKey", async () => {
  const { restore } = await stubBatch();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/credentials/test-batch", {
      companyKey: "acme",
      providerKey: "cloudflare",
    });
    assert.equal(res.status, 200);
    assert.equal(json.mode, "provider");
    assert.deepEqual(json.summary, { total: 1, passed: 1, failed: 0 });
  } finally {
    restore();
    server.close();
  }
});

// ------------------------------------------------------------------
// PUT /gateway/credentials/:id — isActive toggle (9Router disable switch)
// ------------------------------------------------------------------

test("PUT credential toggles is_active when the body carries it", async () => {
  const { restores, calls } = await stubHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/credentials/7", {
      isActive: false,
    });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(calls.updateArgs.input.isActive, false);
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("PUT credential leaves is_active untouched when the body omits it", async () => {
  const { restores, calls } = await stubHappy();
  const server = await listen(makeApp());
  try {
    const { res } = await req(server, "PUT", "/gateway/credentials/7", {
      credentialName: "CF Main v2",
    });
    assert.equal(res.status, 200);
    // undefined → the repository's COALESCE(?, is_active) keeps the stored value.
    assert.equal(calls.updateArgs.input.isActive, undefined);
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

// ------------------------------------------------------------------
// diagnoseError — 9Router getConnectionErrorTag + per-provider vocabulary
// ------------------------------------------------------------------
const { diagnoseError } = await import("../routes/credentials.js");

test("diagnoseError returns null for an empty message", () => {
  assert.equal(diagnoseError(null), null);
  assert.equal(diagnoseError(""), null);
});

test("diagnoseError turns a 4xx/5xx code in the message into the literal tag (9Router getErrorCode)", () => {
  assert.equal(diagnoseError("API returned HTTP 429."), "429");
  assert.equal(diagnoseError("API returned HTTP 500."), "500");
  assert.equal(diagnoseError("API returned HTTP 502."), "502");
  assert.equal(diagnoseError("API returned HTTP 503."), "503");
  assert.equal(diagnoseError("API returned HTTP 400."), "400");
  // 401/403 map to AUTH, exactly like 9Router.
  assert.equal(diagnoseError("API returned HTTP 401."), "AUTH");
  assert.equal(diagnoseError("API returned HTTP 403."), "AUTH");
});

test("diagnoseError maps per-provider error vocabulary to 9Router buckets", () => {
  // OpenAI-style error.code / error.type tokens.
  assert.equal(diagnoseError("invalid_api_key: bad key", "openai"), "AUTH");
  assert.equal(diagnoseError("insufficient_quota on account", "openai"), "429");
  assert.equal(diagnoseError("rate_limit_exceeded", "groq"), "429");
  // Anthropic error.type tokens.
  assert.equal(diagnoseError("authentication_error", "anthropic"), "AUTH");
  assert.equal(diagnoseError("overloaded_error", "anthropic"), "429");
  assert.equal(diagnoseError("api_error", "kimi"), "5XX");
  // Gemini gRPC-style statuses.
  assert.equal(diagnoseError("unauthenticated", "gemini"), "AUTH");
  assert.equal(diagnoseError("permission_denied", "gemini"), "AUTH");
  assert.equal(diagnoseError("resource_exhausted", "gemini"), "429");
  // Cloudflare numeric auth codes.
  assert.equal(diagnoseError("9109: Invalid API Token", "cloudflare"), "AUTH");
});

// ------------------------------------------------------------------
// GET /gateway/companies/:key/credentials?includeStored=1 — the edit form's
// prefill source: NON-SECRET stored fields (account_id, base_url) come back
// decrypted under `fields`; password/secret values never serialize.
// ------------------------------------------------------------------
test("credentials list with includeStored returns non-secret fields only", async () => {
  const provider = {
    id: 1,
    provider_key: "cloudflare",
    provider_name: "Cloudflare",
    default_api_base_url: "https://api.cloudflare.com/client/v4",
  };
  // account_id is is_encrypted at rest but field_type text — an identifier,
  // not a secret; the edit form must see it. api_token is a password.
  const authForm = [
    { field_name: "api_token", field_label: "API Token", field_type: "password", is_required: 1, is_encrypted: 1 },
    { field_name: "account_id", field_label: "Account ID", field_type: "text", is_required: 1, is_encrypted: 1 },
    { field_name: "base_url", field_label: "API Base URL", field_type: "url", is_required: 0, is_encrypted: 0 },
  ];
  const { blob } = CredentialService.encryptCredential(
    {
      api_token: "sk-secret-token",
      account_id: "cf-42",
      base_url: "https://custom.example",
      // A legacy secret stored under a name the schema doesn't declare (the
      // generic "api_key" fallback) — must NEVER be exposed.
      api_key: "sk-legacy-secret",
    },
    { api_token: true, account_id: true, base_url: false, api_key: true }
  );
  const rows = [
    {
      id: 7,
      provider_id: 1,
      provider_key: "cloudflare",
      provider_name: "Cloudflare",
      environment_id: null,
      env_key: null,
      credential_key: "cf-main",
      credential_name: "CF Main",
      encrypted_credentials: blob,
      encryption_version: 1,
      is_active: 1,
      is_default: 0,
      last_verification_status: null,
      verification_error: null,
    },
  ];

  const registryRestore = await seedRegistry({ provider, authForm });
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) => (key === COMPANY.company_key ? COMPANY : null)),
    stub(CredentialRepository, "listByCompany", async (companyId, opts) => {
      assert.equal(opts.includeStored, true);
      return rows;
    }),
  ];
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/acme/credentials?includeStored=1");
    assert.equal(res.status, 200);
    const row = json.credentials[0];
    // Non-secret fields come back decrypted for the edit form.
    assert.deepEqual(row.fields, { account_id: "cf-42", base_url: "https://custom.example" });
    // Secrets never serialize — no api_token, no legacy api_key, no raw blob.
    assert.ok(!("api_token" in row.fields));
    assert.ok(!("api_key" in row.fields));
    assert.ok(!("encrypted_credentials" in row));
    assert.ok(!("encryption_version" in row));
  } finally {
    registryRestore();
    restores.forEach((r) => r());
    server.close();
  }
});

test("credentials list without includeStored returns no fields at all", async () => {
  const registryRestore = await seedRegistry();
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) => (key === COMPANY.company_key ? COMPANY : null)),
    stub(CredentialRepository, "listByCompany", async (companyId, opts) => {
      assert.equal(opts.includeStored, false);
      return [
        {
          id: 7,
          provider_id: 1,
          provider_key: "cloudflare",
          provider_name: "Cloudflare",
          credential_key: "cf-main",
          credential_name: "CF Main",
          is_active: 1,
        },
      ];
    }),
  ];
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/acme/credentials");
    assert.equal(res.status, 200);
    assert.ok(!("fields" in json.credentials[0]));
  } finally {
    registryRestore();
    restores.forEach((r) => r());
    server.close();
  }
});

test("diagnoseError falls back to generic message patterns, then ERR", () => {
  assert.equal(diagnoseError("Token invalid or revoked."), "AUTH");
  assert.equal(diagnoseError("Invalid x-api-key: sk-...", "anthropic"), "AUTH");
  assert.equal(diagnoseError("Too many requests — slow down", "openai"), "429");
  assert.equal(diagnoseError("Model not runnable on this provider"), "RUNTIME");
  assert.equal(diagnoseError("Network error: fetch failed"), "NET");
  assert.equal(diagnoseError("Something unexpected happened"), "ERR");
});
