// --------------------------
// GATEWAY CLOUDFLARE RESOURCES ROUTE TESTS — the live CRUD endpoints
// (vector_index / object_bucket / sql_database / kv_namespace) against the
// Cloudflare REST API, exercised through a real express mount with stubbed
// repositories (no MySQL). Credential decryption is REAL (a test
// APP_ENCRYPTION_KEY is set at the top); globalThis.fetch is stubbed so
// api.cloudflare.com calls never leave the machine while the local test
// server keeps working.
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
process.env.APP_ENCRYPTION_KEY = "cd".repeat(32);

const { CompanyRepository, CredentialRepository, AuditRepository } = await import("../repositories.js");
const CredentialService = await import("../services/credential-service.js");
const gatewayRouter = (await import("../gateway-router.js")).default;

const COMPANY = { id: 2, company_key: "acme" };

// Real encrypted blob holding the stored Cloudflare credential, so the route's
// decrypt → REST path runs against real crypto.
const { blob: CF_BLOB } = CredentialService.encryptCredential(
  { account_id: "cf-42", api_token: "sk-cf-token" },
  { account_id: true, api_token: true }
);

const CF_ROW = {
  id: 7,
  company_id: 2,
  provider_id: 1,
  provider_key: "cloudflare",
  credential_key: "cf-main",
  credential_name: "CF Main",
  encrypted_credentials: CF_BLOB,
  encryption_version: 1,
  is_active: 1,
};

/** Stub a repository method, returning a restore function. */
function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

/**
 * Stub the Cloudflare REST layer: every api.cloudflare.com call is answered
 * by `respond` (url → { status, body }), and the request is recorded in
 * `calls` for assertions. Local test-server traffic passes through.
 */
function stubCfFetch(respond) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (url.startsWith("http://127.0.0.1")) return originalFetch(url, opts);
    calls.push({ url, method: opts.method || "GET", opts });
    const hit = respond(url);
    const status = hit?.status ?? 200;
    const body = hit?.body ?? { success: true, result: [] };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    calls,
    restore: () => {
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

/** Standard stubs: company resolves, credential resolves, audit captured. */
async function stubContext({ row = CF_ROW, company = COMPANY } = {}) {
  const auditLog = [];
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) =>
      key === company.company_key ? company : null
    ),
    stub(CredentialRepository, "listByCompany", async (companyId, opts) => {
      assert.equal(companyId, company.id);
      assert.equal(opts.includeStored, true);
      return [row];
    }),
    stub(AuditRepository, "log", async (entry) => auditLog.push(entry)),
  ];
  return { restores, auditLog };
}

// ------------------------------------------------------------------
// GET — list
// ------------------------------------------------------------------

test("cloudflare resources list normalizes Vectorize indexes", async () => {
  const cf = stubCfFetch(() => ({
    body: {
      success: true,
      result: [
        {
          id: "acme-index",
          name: "acme-index",
          created_on: "2025-01-01T00:00:00Z",
          config: { dimensions: 768, metric: "cosine" },
          vector_count: 12,
        },
      ],
    },
  }));
  const { restores } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/acme/cloudflare/resources/vector_index");
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(cf.calls.length, 1);
    assert.equal(cf.calls[0].url, "https://api.cloudflare.com/client/v4/accounts/cf-42/vectorize/v2/indexes");
    assert.equal(cf.calls[0].opts.headers.Authorization, "Bearer sk-cf-token");
    assert.deepEqual(json.resources[0], {
      id: "acme-index",
      name: "acme-index",
      dimensions: 768,
      metric: "cosine",
      vectorCount: 12,
      createdAt: "2025-01-01T00:00:00Z",
    });
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

test("cloudflare resources list unwraps R2's nested buckets result", async () => {
  const cf = stubCfFetch(() => ({
    body: {
      success: true,
      result: { buckets: [{ name: "acme-chunks", creation_date: "2025-02-01T00:00:00Z", location: "WEUR" }] },
    },
  }));
  const { restores } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/acme/cloudflare/resources/object_bucket");
    assert.equal(res.status, 200);
    assert.equal(cf.calls[0].url, "https://api.cloudflare.com/client/v4/accounts/cf-42/r2/buckets?per_page=100");
    assert.deepEqual(json.resources[0], {
      id: "acme-chunks",
      name: "acme-chunks",
      location: "WEUR",
      createdAt: "2025-02-01T00:00:00Z",
    });
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

test("cloudflare resources list normalizes D1 databases (uuid id)", async () => {
  const cf = stubCfFetch(() => ({
    body: {
      success: true,
      result: [
        {
          uuid: "db-abc",
          name: "acme-analytics",
          created_at: "2025-03-01T00:00:00Z",
          version: "beta",
          num_tables: 4,
          running_in_region: "weur",
        },
      ],
    },
  }));
  const { restores } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/acme/cloudflare/resources/sql_database");
    assert.equal(res.status, 200);
    assert.equal(cf.calls[0].url, "https://api.cloudflare.com/client/v4/accounts/cf-42/d1/database?per_page=100");
    assert.deepEqual(json.resources[0], {
      id: "db-abc",
      name: "acme-analytics",
      uuid: "db-abc",
      version: "beta",
      numTables: 4,
      region: "weur",
      createdAt: "2025-03-01T00:00:00Z",
    });
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

test("cloudflare resources list normalizes KV namespaces (title)", async () => {
  const cf = stubCfFetch(() => ({
    body: {
      success: true,
      result: [{ id: "ns-1", title: "acme-config", supports_url_encoding: true }],
    },
  }));
  const { restores } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/acme/cloudflare/resources/kv_namespace");
    assert.equal(res.status, 200);
    assert.equal(cf.calls[0].url, "https://api.cloudflare.com/client/v4/accounts/cf-42/storage/kv/namespaces?per_page=100");
    assert.deepEqual(json.resources[0], {
      id: "ns-1",
      name: "acme-config",
      title: "acme-config",
      supportsUrlEncoding: true,
      createdAt: null,
    });
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

// ------------------------------------------------------------------
// POST — create
// ------------------------------------------------------------------

test("cloudflare resources create POSTs a Vectorize index with defaults and audits", async () => {
  let created = false;
  const cf = stubCfFetch(() => {
    if (created) return { body: { success: true, result: [] } };
    created = true;
    return {
      body: {
        success: true,
        result: { name: "acme-index", config: { dimensions: 768, metric: "cosine" } },
      },
    };
  });
  const { restores, auditLog } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/cloudflare/resources/vector_index", {
      name: "acme-index",
      providerKey: "cloudflare",
    });
    assert.equal(res.status, 201);
    assert.equal(json.success, true);
    assert.match(json.message, /created/);
    const createCall = cf.calls.find((c) => c.method === "POST");
    assert.ok(createCall, "a POST must hit the Cloudflare API");
    assert.equal(createCall.url, "https://api.cloudflare.com/client/v4/accounts/cf-42/vectorize/v2/indexes");
    const body = JSON.parse(createCall.opts.body);
    assert.equal(body.name, "acme-index");
    assert.deepEqual(body.config, { dimensions: 768, metric: "cosine" });
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "cloudflare_resource.created");
    assert.deepEqual(auditLog[0].afterState, { type: "vector_index", name: "acme-index", provider_key: "cloudflare" });
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

test("cloudflare resources create passes location hint for R2 buckets", async () => {
  let created = false;
  const cf = stubCfFetch(() => {
    if (created) return { body: { success: true, result: { buckets: [] } } };
    created = true;
    return { body: { success: true, result: { name: "acme-chunks", creation_date: "2025-01-01T00:00:00Z" } } };
  });
  const { restores } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res } = await req(server, "POST", "/gateway/companies/acme/cloudflare/resources/object_bucket", {
      name: "acme-chunks",
      providerKey: "cloudflare",
      config: { locationHint: "WEUR" },
    });
    assert.equal(res.status, 201);
    const createCall = cf.calls.find((c) => c.method === "POST");
    assert.equal(createCall.url, "https://api.cloudflare.com/client/v4/accounts/cf-42/r2/buckets");
    assert.deepEqual(JSON.parse(createCall.opts.body), { name: "acme-chunks", location_hint: "WEUR" });
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

test("cloudflare resources create maps KV namespace to title", async () => {
  let created = false;
  const cf = stubCfFetch(() => {
    if (created) return { body: { success: true, result: [] } };
    created = true;
    return { body: { success: true, result: { id: "ns-1", title: "acme-config" } } };
  });
  const { restores } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res } = await req(server, "POST", "/gateway/companies/acme/cloudflare/resources/kv_namespace", {
      name: "acme-config",
      providerKey: "cloudflare",
    });
    assert.equal(res.status, 201);
    const createCall = cf.calls.find((c) => c.method === "POST");
    assert.equal(createCall.url, "https://api.cloudflare.com/client/v4/accounts/cf-42/storage/kv/namespaces");
    assert.deepEqual(JSON.parse(createCall.opts.body), { title: "acme-config" });
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

test("cloudflare resources create refuses an existing resource name (409)", async () => {
  const cf = stubCfFetch(() => ({
    body: { success: true, result: [{ name: "acme-index", config: { dimensions: 768, metric: "cosine" } }] },
  }));
  const { restores } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/acme/cloudflare/resources/vector_index", {
      name: "acme-index",
      providerKey: "cloudflare",
    });
    assert.equal(res.status, 409);
    assert.match(json.error, /already exists/);
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

// ------------------------------------------------------------------
// DELETE
// ------------------------------------------------------------------

test("cloudflare resources delete DELETEs the vector index by name and audits", async () => {
  const cf = stubCfFetch(() => ({ body: { success: true, result: [] } }));
  const { restores, auditLog } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/companies/acme/cloudflare/resources/vector_index/acme-index");
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(cf.calls.length, 1);
    assert.equal(cf.calls[0].method, "DELETE");
    assert.equal(cf.calls[0].url, "https://api.cloudflare.com/client/v4/accounts/cf-42/vectorize/v2/indexes/acme-index");
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "cloudflare_resource.deleted");
    assert.deepEqual(auditLog[0].afterState, { type: "vector_index", id: "acme-index", provider_key: "cloudflare" });
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

test("cloudflare resources delete uses the uuid for D1 databases", async () => {
  const cf = stubCfFetch(() => ({ body: { success: true, result: [] } }));
  const { restores } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res } = await req(server, "DELETE", "/gateway/companies/acme/cloudflare/resources/sql_database/db-abc");
    assert.equal(res.status, 200);
    assert.equal(cf.calls[0].url, "https://api.cloudflare.com/client/v4/accounts/cf-42/d1/database/db-abc");
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

// ------------------------------------------------------------------
// Guards + error paths
// ------------------------------------------------------------------

test("cloudflare resources returns 404 for an unknown company", async () => {
  const cf = stubCfFetch(() => ({ body: { success: true, result: [] } }));
  const { restores } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/ghost/cloudflare/resources/vector_index");
    assert.equal(res.status, 404);
    assert.match(json.error, /Company 'ghost' not found/);
    assert.equal(cf.calls.length, 0, "no Cloudflare call for an unknown company");
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

test("cloudflare resources returns 400 for an unknown resource type", async () => {
  const cf = stubCfFetch(() => ({ body: { success: true, result: [] } }));
  const { restores } = await stubContext();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/acme/cloudflare/resources/workers_ai");
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown resource type/);
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

test("cloudflare resources returns 404 when the company has no Cloudflare connection", async () => {
  const cf = stubCfFetch(() => ({ body: { success: true, result: [] } }));
  const { restores } = await stubContext({ row: null });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/acme/cloudflare/resources/vector_index");
    assert.equal(res.status, 404);
    assert.match(json.error, /No active Cloudflare connection/);
    assert.equal(cf.calls.length, 0);
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

test("cloudflare resources falls back to any active cloudflare-family credential", async () => {
  const familyRow = {
    ...CF_ROW,
    provider_key: "cloudflare_d1",
    credential_key: "cf-d1",
  };
  const cf = stubCfFetch(() => ({ body: { success: true, result: [] } }));
  const { restores } = await stubContext({ row: familyRow });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/acme/cloudflare/resources/sql_database");
    assert.equal(res.status, 200);
    assert.equal(cf.calls[0].url, "https://api.cloudflare.com/client/v4/accounts/cf-42/d1/database?per_page=100");
    assert.equal(json.credentialKey, "cf-d1");
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

test("object_bucket prefers the cloudflare_r2 connection over the umbrella cloudflare one", async () => {
  // Two active credentials: the umbrella cloudflare (account A, no R2) and
  // cloudflare_r2 (account B, where the buckets live). The R2 card must use
  // the account that actually has R2 enabled — the same connection the
  // cloudflare_r2 provider page would use.
  const { blob: blobA } = CredentialService.encryptCredential(
    { account_id: "acct-a", api_token: "sk-token-a" },
    { account_id: true, api_token: true }
  );
  const { blob: blobB } = CredentialService.encryptCredential(
    { account_id: "acct-b", api_token: "sk-token-b" },
    { account_id: true, api_token: true }
  );
  const cf = stubCfFetch(() => ({
    body: { success: true, result: { buckets: [{ name: "popularcert-data", creation_date: "2026-01-01" }] } },
  }));
  const auditLog = [];
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) =>
      key === COMPANY.company_key ? COMPANY : null
    ),
    stub(CredentialRepository, "listByCompany", async () => [
      { ...CF_ROW, id: 2, provider_key: "cloudflare", credential_key: "main", encrypted_credentials: blobA },
      { ...CF_ROW, id: 4, provider_key: "cloudflare_r2", credential_key: "r2-main", encrypted_credentials: blobB },
    ]),
    stub(AuditRepository, "log", async (entry) => auditLog.push(entry)),
  ];
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/acme/cloudflare/resources/object_bucket");
    assert.equal(res.status, 200);
    // Resolved through the cloudflare_r2 credential (account B) — not the
    // umbrella one (account A).
    assert.equal(json.credentialKey, "r2-main");
    assert.equal(cf.calls[0].url, "https://api.cloudflare.com/client/v4/accounts/acct-b/r2/buckets?per_page=100");
    assert.equal(cf.calls[0].opts.headers.Authorization, "Bearer sk-token-b");
    assert.equal(json.resources[0].name, "popularcert-data");
  } finally {
    restores.forEach((r) => r());
    cf.restore();
    server.close();
  }
});

// ------------------------------------------------------------------
// listLiveCloudflareResources — shared with the KB options endpoint so the
// config page's Vector Index / R2 Bucket selectors see live account data.
// ------------------------------------------------------------------
test("listLiveCloudflareResources returns normalized live resources (KB options source)", async () => {
  const cf = stubCfFetch(() => ({
    body: {
      success: true,
      result: { buckets: [{ name: "popularcert-data", creation_date: "2026-01-01", location: "WEUR" }] },
    },
  }));
  const { restores } = await stubContext();
  const { listLiveCloudflareResources } = await import("../routes/cloudflare-resources.js");
  try {
    const rows = await listLiveCloudflareResources(COMPANY, "object_bucket");
    assert.deepEqual(rows, [{ id: "popularcert-data", name: "popularcert-data", location: "WEUR", createdAt: "2026-01-01" }]);
    assert.equal(cf.calls[0].url, "https://api.cloudflare.com/client/v4/accounts/cf-42/r2/buckets?per_page=100");
  } finally {
    restores.forEach((r) => r());
    cf.restore();
  }
});

test("listLiveCloudflareResources throws when the company has no Cloudflare connection (callers catch)", async () => {
  const cf = stubCfFetch(() => ({ body: { success: true, result: [] } }));
  const { restores } = await stubContext({ row: null });
  const { listLiveCloudflareResources } = await import("../routes/cloudflare-resources.js");
  try {
    await assert.rejects(
      () => listLiveCloudflareResources(COMPANY, "vector_index"),
      /No active Cloudflare connection/
    );
    assert.equal(cf.calls.length, 0, "no Cloudflare call without a connection");
  } finally {
    restores.forEach((r) => r());
    cf.restore();
  }
});

test("cloudflare resources surfaces the provider's error message + code as 502 (never 401)", async () => {
  // Even an upstream 401/403 (bad token) must come back as 502 — the portal
  // treats a /gateway 401 as "admin session expired" and would log the user
  // out otherwise. The message carries the real cause, and the provider's
  // error code is prefixed (e.g. "10042 — Please enable R2…") for diagnosis.
  for (const status of [400, 401, 403]) {
    const cf = stubCfFetch(() => ({
      status,
      body: { success: false, errors: [{ code: 7000, message: "Invalid index name." }] },
    }));
    const { restores } = await stubContext();
    const server = await listen(makeApp());
    try {
      const { res, json } = await req(server, "GET", "/gateway/companies/acme/cloudflare/resources/vector_index");
      assert.equal(res.status, 502);
      assert.equal(json.error, "7000 — Invalid index name.");
    } finally {
      restores.forEach((r) => r());
      cf.restore();
      server.close();
    }
  }
});
