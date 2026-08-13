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
  AuditRepository,
} = await import("../repositories.js");
const Registry = await import("../services/provider-registry.js");
const CredentialService = await import("../services/credential-service.js");
const gatewayRouter = (await import("../gateway-router.js")).default;

const PROVIDER = { id: 1, provider_key: "cloudflare", provider_name: "Cloudflare" };

// Auth-schema rows drive both the merge validation (validation_regex) and the
// encryption map (is_encrypted) — mirror what ProviderRepository.authForm()
// returns.
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
    stub(ProviderRepository, "capabilities", async () => []),
    stub(ProviderRepository, "authForm", async () => authForm),
    stub(ProviderRepository, "resourceTemplates", async () => []),
    stub(ModelRepository, "listByProvider", async () => []),
    stub(EndpointRepository, "list", async () => []),
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
    stub(ProviderRepository, "capabilities", async () => []),
    stub(ProviderRepository, "authForm", async () => []),
    stub(ProviderRepository, "resourceTemplates", async () => []),
    stub(ModelRepository, "listByProvider", async () => []),
    stub(EndpointRepository, "list", async () => []),
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
