// --------------------------
// GATEWAY PROVIDER TEST ROUTE TESTS — POST /gateway/providers/:key/test,
// exercised through a real express mount with stubbed repositories + fetch
// (no MySQL, no network). Same harness as the other gateway route tests.
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
  CredentialRepository,
  ResourceRepository,
  AssistantRepository,
  AuditRepository,
  KbRepository,
} = await import("../repositories.js");
const Registry = await import("../services/provider-registry.js");
const gatewayRouter = (await import("../gateway-router.js")).default;

// deepseek has a declarative hand-written probe (GET /models, Bearer).
const DEEPSEEK = {
  id: 1,
  provider_key: "deepseek",
  provider_name: "DeepSeek",
  primary_service_category: "ai",
  default_api_base_url: "https://api.deepseek.com",
  auth_type: "bearer_token",
  auth_header_name: "Authorization",
  is_active: 1,
};
const DEEPSEEK_AUTH_FORM = [
  { field_name: "api_key", field_label: "DeepSeek API Key", field_type: "password", is_required: 1, is_encrypted: 1, validation_regex: "^sk-[A-Za-z0-9]{20,}$" },
];

// A wizard-created provider with a base URL but no auth form → connectivity check.
const ACNE_DB = {
  id: 2,
  provider_key: "acme-db",
  provider_name: "Acme DB",
  primary_service_category: "database",
  default_api_base_url: "https://db.acme.example",
  auth_type: "bearer_token",
  auth_header_name: "Authorization",
  is_active: 1,
};

// A catalog-only provider: no base URL, no auth form → nothing to test.
const CATALOG_ONLY = {
  id: 3,
  provider_key: "acme-vision",
  provider_name: "Acme Vision",
  primary_service_category: "image",
  default_api_base_url: null,
  auth_type: "bearer_token",
  auth_header_name: "Authorization",
  is_active: 1,
};

function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

async function seedRegistry({ provider, authForm = DEEPSEEK_AUTH_FORM }) {
  const restores = [
    stub(ProviderRepository, "list", async () => [provider]),
    stub(ProviderRepository, "capabilitiesByProviderIds", async () => []),
    stub(ProviderRepository, "authFormsByProviderIds", async () =>
      authForm.map((r) => ({ ...r, provider_id: provider.id }))
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

/** Stub fetch (URL-dispatched so the local test server works) + audit. */
function stubFetch({ fetchImpl } = {}) {
  const auditLog = [];
  const outbound = [];
  const auditRestore = stub(AuditRepository, "log", async (entry) => auditLog.push(entry));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (url.startsWith("http://127.0.0.1")) return originalFetch(url, opts);
    outbound.push({ url, opts });
    if (fetchImpl) return fetchImpl(url, opts);
    return { ok: true, status: 200, text: async () => "" };
  };
  return {
    auditLog,
    outbound,
    restore() {
      auditRestore();
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
// POST /gateway/providers/:key/test
// ------------------------------------------------------------------

test("provider test returns 404 for an unknown provider", async () => {
  const registryRestore = await seedRegistry({ provider: DEEPSEEK });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/providers/ghost/test", {
      fields: { api_key: "sk-abcdefghijklmnopqrstuvwx" },
    });
    assert.equal(res.status, 404);
    assert.match(json.error, /Unknown provider 'ghost'/);
  } finally {
    registryRestore();
    server.close();
  }
});

test("provider test validates supplied fields against the auth schema (format mode)", async () => {
  const registryRestore = await seedRegistry({ provider: DEEPSEEK });
  const fetchStub = stubFetch();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/providers/deepseek/test", {
      fields: { api_key: "not a valid key!" },
    });
    assert.equal(res.status, 200);
    assert.equal(json.status, "failed");
    assert.equal(json.success, false);
    assert.equal(json.mode, "format");
    assert.match(json.error, /does not match the expected format/);
    assert.ok(json.errors.api_key);
    assert.equal(json.latencyMs, null);
    // No network call should have happened — format fails before the probe.
    assert.equal(fetchStub.outbound.length, 0);
  } finally {
    fetchStub.restore();
    registryRestore();
    server.close();
  }
});

test("provider test runs the live probe with supplied fields (probe mode)", async () => {
  const registryRestore = await seedRegistry({ provider: DEEPSEEK });
  const fetchStub = stubFetch({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "[]" }),
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/providers/deepseek/test", {
      fields: { api_key: "sk-abcdefghijklmnopqrstuvwx" },
    });
    assert.equal(res.status, 200);
    assert.equal(json.status, "success");
    assert.equal(json.success, true);
    assert.equal(json.mode, "probe");
    assert.equal(json.error, null);
    assert.equal(typeof json.latencyMs, "number");
    assert.equal(fetchStub.outbound.length, 1);
    assert.equal(fetchStub.outbound[0].url, "https://api.deepseek.com/models");
    assert.equal(fetchStub.outbound[0].opts.headers.Authorization, "Bearer sk-abcdefghijklmnopqrstuvwx");
    // Audited as provider.test
    assert.equal(fetchStub.auditLog.length, 1);
    assert.equal(fetchStub.auditLog[0].action, "provider.test");
    assert.equal(fetchStub.auditLog[0].afterState.provider_key, "deepseek");
    assert.equal(fetchStub.auditLog[0].afterState.mode, "probe");
  } finally {
    fetchStub.restore();
    registryRestore();
    server.close();
  }
});

test("provider test falls back to a base-URL connectivity check without a probe", async () => {
  const registryRestore = await seedRegistry({ provider: ACNE_DB, authForm: [] });
  const fetchStub = stubFetch({
    // A 404 on the root still proves the host is up.
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => "" }),
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/providers/acme-db/test", {});
    assert.equal(res.status, 200);
    assert.equal(json.status, "success");
    assert.equal(json.mode, "connectivity");
    assert.equal(json.error, null);
    assert.equal(fetchStub.outbound.length, 1);
    assert.equal(fetchStub.outbound[0].url, "https://db.acme.example");
  } finally {
    fetchStub.restore();
    registryRestore();
    server.close();
  }
});

test("provider test reports a failed connectivity check when the base URL is unreachable", async () => {
  const registryRestore = await seedRegistry({ provider: ACNE_DB, authForm: [] });
  const fetchStub = stubFetch({
    fetchImpl: async () => {
      throw new Error("getaddrinfo ENOTFOUND db.acme.example");
    },
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/providers/acme-db/test", {});
    assert.equal(res.status, 200);
    assert.equal(json.status, "failed");
    assert.equal(json.success, false);
    assert.equal(json.mode, "connectivity");
    assert.match(json.error, /Base URL unreachable/);
  } finally {
    fetchStub.restore();
    registryRestore();
    server.close();
  }
});

// ------------------------------------------------------------------
// DELETE /gateway/providers/:key — hard delete with FK-RESTRICT purge
// (regression: the purge path used to reference CredentialRepository /
// ResourceRepository without importing them, crashing with
// "CredentialRepository is not defined" when deleting a referenced provider
// such as cloudflare_worker_ai).
// ------------------------------------------------------------------

/** Stub the FK-RESTRICT purge path: remove() throws, then listByProvider /
 *  removePermanent capture their inputs so the purge is assertable. */
async function stubReferencedDelete({ creds = [], resources = [], assistants = [] } = {}) {
  const calls = { purgedCreds: [], purgedResources: [], purgedAssistants: [] };
  const auditLog = [];
  // The route calls remove() twice — the first attempt hits the FK RESTRICT
  // (triggers the purge), the second (after the purge) succeeds.
  let firstRemove = true;
  const restores = [
    stub(ProviderRepository, "remove", async () => {
      if (firstRemove) {
        firstRemove = false;
        const err = new Error("Cannot delete or update a parent row: a foreign key constraint fails");
        err.code = "ER_ROW_IS_REFERENCED_2";
        throw err;
      }
      return true;
    }),
    stub(CredentialRepository, "listByProvider", async () => creds),
    stub(ResourceRepository, "listByProvider", async () => resources),
    stub(KbRepository, "clearResourceBinding", async () => []),
    stub(AssistantRepository, "listByCredentialIds", async (credentialIds) =>
      assistants.filter((a) => credentialIds.includes(a.credential_id))
    ),
    stub(AssistantRepository, "removePermanent", async (id) => {
      calls.purgedAssistants.push(id);
      return true;
    }),
    stub(CredentialRepository, "removePermanent", async (id) => {
      calls.purgedCreds.push(id);
      return true;
    }),
    stub(ResourceRepository, "removePermanent", async (id) => {
      calls.purgedResources.push(id);
      return true;
    }),
    stub(AuditRepository, "log", async (entry) => auditLog.push(entry)),
  ];
  return { restores, calls, auditLog };
}

test("DELETE provider purges soft-deleted credentials without force (no crash)", async () => {
  // The exact regression: a provider whose only referencing rows are already
  // soft-deleted must be deletable — the route lists credentials/resources to
  // purge them, so a missing import crashes the request.
  const registryRestore = await seedRegistry({ provider: DEEPSEEK });
  const { restores, calls, auditLog } = await stubReferencedDelete({
    creds: [{ id: 11, company_id: 2, credential_key: "ds-old", deleted_at: "2025-01-01" }],
    resources: [{ id: 22, deleted_at: "2025-01-01" }],
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/providers/deepseek");
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(calls.purgedCreds, [11]);
    assert.deepEqual(calls.purgedResources, [22]);
    // Both purge actions audited.
    assert.ok(auditLog.some((e) => e.action === "credential.deleted" && e.afterState.provider_key === "deepseek"));
    assert.ok(auditLog.some((e) => e.action === "resource.deleted"));
  } finally {
    restores.forEach((r) => r());
    registryRestore();
    server.close();
  }
});

test("DELETE provider refuses when an assistant references a purged credential (409)", async () => {
  // assistants.credential_id is a NOT-NULL RESTRICT FK — even a soft-deleted
  // credential can't be hard-deleted underneath a live assistant. Without
  // force the delete must refuse with a message naming the assistant.
  const registryRestore = await seedRegistry({ provider: DEEPSEEK });
  const { restores, calls } = await stubReferencedDelete({
    creds: [{ id: 11, company_id: 2, credential_key: "ds-old", deleted_at: "2025-01-01" }],
    assistants: [{ id: 33, company_id: 2, assistant_key: "sales-bot", deleted_at: null, credential_id: 11 }],
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/providers/deepseek");
    assert.equal(res.status, 409);
    assert.match(json.error, /assistant 'sales-bot'/);
    assert.match(json.error, /force=true/);
    // Nothing was purged — the refusal happens before any delete.
    assert.deepEqual(calls.purgedAssistants, []);
    assert.deepEqual(calls.purgedCreds, []);
  } finally {
    restores.forEach((r) => r());
    registryRestore();
    server.close();
  }
});

test("DELETE provider with force=true hard-deletes referencing assistants before purging credentials", async () => {
  // The production scenario: cloudflare_worker_ai's credential is referenced
  // by an assistant — force must remove the assistant (chatbots cascade),
  // then the credential, then the provider.
  const registryRestore = await seedRegistry({ provider: DEEPSEEK });
  const { restores, calls, auditLog } = await stubReferencedDelete({
    creds: [{ id: 11, company_id: 2, credential_key: "cf-main", deleted_at: null }],
    assistants: [{ id: 33, company_id: 2, assistant_key: "sales-bot", deleted_at: null, credential_id: 11 }],
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/providers/deepseek?force=true");
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    // Assistant removed before the credential it references.
    assert.deepEqual(calls.purgedAssistants, [33]);
    assert.deepEqual(calls.purgedCreds, [11]);
    assert.ok(auditLog.some((e) => e.action === "assistant.deleted" && e.afterState.assistant_key === "sales-bot" && e.afterState.forced === true));
  } finally {
    restores.forEach((r) => r());
    registryRestore();
    server.close();
  }
});

test("DELETE provider refuses active credentials without force (409)", async () => {
  const registryRestore = await seedRegistry({ provider: DEEPSEEK });
  const { restores } = await stubReferencedDelete({
    creds: [{ id: 11, company_id: 2, credential_key: "ds-main", deleted_at: null }],
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/providers/deepseek");
    assert.equal(res.status, 409);
    assert.match(json.error, /referenced by tenant credentials/);
  } finally {
    restores.forEach((r) => r());
    registryRestore();
    server.close();
  }
});

test("DELETE provider with force=true purges active credentials and resources", async () => {
  const registryRestore = await seedRegistry({ provider: DEEPSEEK });
  const { restores, calls, auditLog } = await stubReferencedDelete({
    creds: [{ id: 11, company_id: 2, credential_key: "ds-main", deleted_at: null }],
    resources: [{ id: 22, deleted_at: null }],
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/providers/deepseek?force=true");
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(calls.purgedCreds, [11]);
    assert.deepEqual(calls.purgedResources, [22]);
    assert.ok(auditLog.some((e) => e.afterState.forced === true));
  } finally {
    restores.forEach((r) => r());
    registryRestore();
    server.close();
  }
});

test("provider test with no probe and no base URL is a catalog-only success", async () => {
  const registryRestore = await seedRegistry({ provider: CATALOG_ONLY, authForm: [] });
  const fetchStub = stubFetch();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/providers/acme-vision/test", {});
    assert.equal(res.status, 200);
    assert.equal(json.status, "success");
    assert.equal(json.mode, "none");
    assert.equal(json.latencyMs, null);
    assert.match(json.warning, /catalog-only/);
    assert.equal(fetchStub.outbound.length, 0);
  } finally {
    fetchStub.restore();
    registryRestore();
    server.close();
  }
});
