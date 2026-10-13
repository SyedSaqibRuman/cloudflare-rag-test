// --------------------------
// KB-RESOURCE BINDING GUARD TESTS — deleting a provider_resource that a live
// knowledge base still binds (vector/graph/storage_resource_id) must fail
// with 409 CONFLICT naming the KBs, and the live vector-store delete must be
// refused BEFORE the provider API call. Exercised through a real express
// mount with stubbed repositories (no MySQL, no network).
// Run with: node --test mysql/__tests__/kb-resource-guard.test.js
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

// env.js freezes MYSQL_* at import time — set dummies BEFORE any gateway
// module import so the lazy pool is never touched (all repositories stubbed).
process.env.MYSQL_HOST = "127.0.0.1";
process.env.MYSQL_DATABASE = "gateway_test";
process.env.MYSQL_USER = "test";
process.env.MYSQL_PASSWORD = "test";
process.env.APP_ENCRYPTION_KEY = "cd".repeat(32);

const {
  CompanyRepository,
  CredentialRepository,
  ResourceRepository,
  KbRepository,
  AuditRepository,
} = await import("../repositories.js");
const CredentialService = await import("../services/credential-service.js");
const gatewayRouter = (await import("../gateway-router.js")).default;

const COMPANY = { id: 2, company_key: "acme" };

// Real encrypted Qdrant credential so the route's decrypt path runs real crypto.
const { blob: QDRANT_BLOB } = CredentialService.encryptCredential(
  { host: "https://qdrant.example:6333", api_key: "qd-key" },
  { host: true, api_key: true }
);

const QDRANT_CRED = {
  id: 24,
  company_id: 2,
  provider_id: 12,
  provider_key: "qdrant",
  credential_key: "qd-main",
  credential_name: "Qdrant Main",
  encrypted_credentials: QDRANT_BLOB,
  encryption_version: 1,
  is_active: 1,
};

// The provider_resource a KB is bound to.
const BOUND_RESOURCE = {
  id: 13,
  company_id: 2,
  credential_id: 24,
  provider_id: 12,
  resource_type: "vector_index",
  resource_key: "qdrant-java-textbook",
  resource_name: "java-textbook",
  external_resource_id: "java-textbook",
  config: {},
  status: "active",
  deleted_at: null,
};

// The binding KB row KbRepository.listByResource returns.
const BOUND_KB = { id: 27, kb_key: "java-textbook", kb_name: "Java-textbook", company_id: 2, vector_resource_id: 13, graph_resource_id: null, storage_resource_id: null };

/** Stub a repository method, returning a restore function. */
function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

/** Stub globalThis.fetch, recording every non-local call. */
function stubFetch(respond) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).startsWith("http://127.0.0.1")) return originalFetch(url, opts);
    calls.push({ url: String(url), method: opts.method || "GET" });
    const hit = respond(url, opts) || { status: 200, body: {} };
    return new Response(JSON.stringify(hit.body), {
      status: hit.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
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

async function req(server, method, urlPath) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}${urlPath}`, { method, headers: { "content-type": "application/json" } });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { res, json };
}

/** Common stubs: company + qdrant credential resolve, audit captured. */
function stubBase({ listByResourceImpl } = {}) {
  const auditLog = [];
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) => (key === COMPANY.company_key ? COMPANY : null)),
    stub(CredentialRepository, "listByCompany", async () => [QDRANT_CRED]),
    stub(AuditRepository, "log", async (entry) => auditLog.push(entry)),
    stub(
      KbRepository,
      "listByResource",
      listByResourceImpl || (async (id) => (Number(id) === BOUND_RESOURCE.id ? [BOUND_KB] : []))
    ),
  ];
  return { restores, auditLog };
}

// ------------------------------------------------------------------
// DELETE /gateway/resources/:id (registry delete)
// ------------------------------------------------------------------

test("registry delete is refused with 409 when a KB binds the resource", async () => {
  const removeCalls = [];
  const { restores } = stubBase();
  restores.push(stub(ResourceRepository, "findById", async (id) => (Number(id) === 13 ? BOUND_RESOURCE : null)));
  restores.push(stub(ResourceRepository, "remove", async (id) => removeCalls.push(id)));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/resources/13");
    assert.equal(res.status, 409);
    assert.equal(json.success, false);
    assert.match(json.error, /java-textbook/);
    assert.match(json.error, /vector resource/);
    assert.deepEqual(removeCalls, [], "resource must NOT be removed while a KB binds it");
  } finally {
    server.close();
    restores.forEach((r) => r());
  }
});

test("registry delete succeeds when no KB binds the resource", async () => {
  const removeCalls = [];
  const { restores, auditLog } = stubBase({ listByResourceImpl: async () => [] });
  restores.push(stub(ResourceRepository, "findById", async (id) => (Number(id) === 13 ? BOUND_RESOURCE : null)));
  restores.push(stub(ResourceRepository, "remove", async (id) => removeCalls.push(id)));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/resources/13");
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(removeCalls, [13]);
    assert.equal(auditLog.filter((a) => a.action === "resource.deleted").length, 1);
  } finally {
    server.close();
    restores.forEach((r) => r());
  }
});
// ------------------------------------------------------------------
// DELETE /gateway/companies/:key/vector/resources/:provider/:name (live delete)
// ------------------------------------------------------------------

test("live vector delete is refused with 409 BEFORE the provider API call", async () => {
  const removeCalls = [];
  const { restores } = stubBase();
  restores.push(stub(ResourceRepository, "listByCompany", async () => [BOUND_RESOURCE]));
  restores.push(stub(ResourceRepository, "remove", async (id) => removeCalls.push(id)));
  const f = stubFetch(() => ({ status: 200, body: {} }));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(
      server,
      "DELETE",
      "/gateway/companies/acme/vector/resources/qdrant/java-textbook"
    );
    assert.equal(res.status, 409);
    assert.match(json.error, /java-textbook/);
    assert.match(json.error, /Re-point or delete the KB/);
    // The live store must still exist — no qdrant.example request was made.
    assert.equal(f.calls.filter((c) => c.url.includes("qdrant.example")).length, 0);
    assert.deepEqual(removeCalls, [], "registry rows must NOT be unregistered either");
  } finally {
    server.close();
    restores.forEach((r) => r());
    f.restore();
  }
});

test("live vector delete proceeds when no KB binds the store", async () => {
  const removeCalls = [];
  const { restores } = stubBase({ listByResourceImpl: async () => [] });
  restores.push(stub(ResourceRepository, "listByCompany", async () => [BOUND_RESOURCE]));
  restores.push(stub(ResourceRepository, "remove", async (id) => removeCalls.push(id)));
  const f = stubFetch((url, opts) =>
    url.includes("qdrant.example") && opts.method === "DELETE" ? { status: 200, body: {} } : { status: 404, body: {} }
  );
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(
      server,
      "DELETE",
      "/gateway/companies/acme/vector/resources/qdrant/java-textbook"
    );
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(removeCalls, [13]);
    assert.equal(
      f.calls.filter((c) => c.url.includes("qdrant.example:6333/collections/java-textbook") && c.method === "DELETE").length,
      1
    );
  } finally {
    server.close();
    restores.forEach((r) => r());
    f.restore();
  }
});

// ------------------------------------------------------------------
// DELETE /gateway/credentials/:id (connection delete)
// ------------------------------------------------------------------

test("credential delete is refused with 409 when its resource is KB-bound", async () => {
  const removeCalls = [];
  const { restores } = stubBase();
  restores.push(stub(CredentialRepository, "findWithEncrypted", async (id) => (Number(id) === 24 ? QDRANT_CRED : null)));
  restores.push(stub(CredentialRepository, "remove", async (id) => removeCalls.push(id)));
  restores.push(stub(ResourceRepository, "listByCompany", async () => [BOUND_RESOURCE]));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/credentials/24");
    assert.equal(res.status, 409);
    assert.match(json.error, /java-textbook/);
    assert.deepEqual(removeCalls, [], "credential must NOT be removed while a KB binds its resource");
  } finally {
    server.close();
    restores.forEach((r) => r());
  }
});
