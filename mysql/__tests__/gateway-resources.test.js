// --------------------------
// GATEWAY RESOURCE ROUTE TESTS — the POST/PUT/DELETE /gateway resource
// provisioning routes, exercised through a real express mount with stubbed
// repositories (no MySQL, no network). The gateway router imports
// `* as Registry` (a frozen ESM namespace, so its methods can't be patched
// directly), but the registry cache is seeded through the mutable repository
// objects it reads from + invalidateRegistry()/refreshRegistry().
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

// The router's `gate` middleware reads env.MYSQL_* at import time (env.js
// freezes them), so set dummies BEFORE any gateway module is imported. All
// repository methods are stubbed below, so the lazy pool is never touched.
process.env.MYSQL_HOST = "127.0.0.1";
process.env.MYSQL_DATABASE = "gateway_test";
process.env.MYSQL_USER = "test";
process.env.MYSQL_PASSWORD = "test";

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
const gatewayRouter = (await import("../gateway-router.js")).default;

const COMPANY = { id: 2, company_key: "popularcert", max_knowledge_bases: 5 };
const PROVIDER = { id: 1, provider_key: "cloudflare", provider_name: "Cloudflare" };
const VECTOR_TEMPLATE = {
  resource_type: "vector_index",
  display_name: "Vector Index",
  max_per_credential: 5,
};
const CREDENTIAL = {
  id: 7,
  company_id: 2,
  provider_id: 1,
  credential_key: "cf-main",
};

const VALID_BODY = {
  providerKey: "cloudflare",
  credentialId: 7,
  resourceType: "vector_index",
  resourceKey: "docs-index",
  resourceName: "Docs Index",
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
 * Seed the registry cache with a provider (and its resource templates) by
 * stubbing the repository methods refreshRegistry() reads, then invalidating
 * and reloading. Returns the restore function.
 */
async function seedRegistry({ provider = PROVIDER, templates = [VECTOR_TEMPLATE] } = {}) {
  const restores = [
    stub(ProviderRepository, "list", async () => [provider]),
    stub(ProviderRepository, "capabilitiesByProviderIds", async () => []),
    stub(ProviderRepository, "authFormsByProviderIds", async () => []),
    stub(ProviderRepository, "resourceTemplatesByProviderIds", async () =>
      templates.map((r) => ({ ...r, provider_id: provider.id }))
    ),
    stub(ModelRepository, "listByProviderIds", async () => []),
    stub(EndpointRepository, "listByProviderIds", async () => []),
  ];
  Registry.invalidateRegistry();
  await Registry.refreshRegistry();
  // Restore the repo stubs AND drop the seeded cache so a later test can't
  // silently read the stale provider entry (refreshRegistry rebuilds it).
  return () => {
    restores.forEach((r) => r());
    Registry.invalidateRegistry();
  };
}

/** Happy-path stubs: company exists, credential exists + owned, audit no-op,
 * and the max_per_credential count is below the cap. */
function stubHappy() {
  const auditLog = [];
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) =>
      key === COMPANY.company_key ? COMPANY : null
    ),
    stub(CredentialRepository, "findById", async (id) =>
      Number(id) === CREDENTIAL.id ? CREDENTIAL : null
    ),
    stub(ResourceRepository, "countByCredentialType", async () => 0),
    stub(AuditRepository, "log", async (entry) => {
      auditLog.push(entry);
    }),
  ];
  return { restores, auditLog };
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

async function req(server, method, urlPath, body, headers = {}) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
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

after(() => {
  // Nothing global to tear down — repos are restored per test, and each
  // seedRegistry() restore already drops the cached catalog.
  Registry.invalidateRegistry();
});

// ------------------------------------------------------------------
// GET /gateway/companies/:key/resources
// ------------------------------------------------------------------

test("GET resources returns 404 for an unknown company", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/ghost/resources");
    assert.equal(res.status, 404);
    assert.match(json.error, /not found/);
  } finally {
    restoreCompany();
    server.close();
  }
});

test("GET resources lists the company's resources and passes the ?type= filter", async () => {
  let filterUsed = null;
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreList = stub(ResourceRepository, "listByCompany", async (_companyId, opts) => {
    filterUsed = opts?.resourceType || null;
    return [{ id: 1, resource_type: "vector_index", resource_key: "docs-index" }];
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/companies/popularcert/resources?type=vector_index");
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.companyKey, "popularcert");
    assert.equal(json.resources.length, 1);
    assert.equal(filterUsed, "vector_index");
  } finally {
    restoreCompany();
    restoreList();
    server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/companies/:key/resources — validation
// ------------------------------------------------------------------

test("POST resource rejects an unknown company with 404", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/ghost/resources", VALID_BODY);
    assert.equal(res.status, 404);
    assert.match(json.error, /not found/);
  } finally {
    restoreCompany();
    server.close();
  }
});

test("POST resource rejects missing required fields with 400 + per-field errors", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", {});
    assert.equal(res.status, 400);
    assert.match(json.error, /Validation failed/);
    assert.ok(json.errors.providerKey);
    assert.ok(json.errors.credentialId);
    assert.ok(json.errors.resourceType);
    assert.ok(json.errors.resourceKey);
    assert.ok(json.errors.resourceName);
  } finally {
    restoreCompany();
    server.close();
  }
});

test("POST resource rejects an out-of-enum resourceType", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", {
      ...VALID_BODY,
      resourceType: "blob_store",
    });
    assert.equal(res.status, 400);
    assert.ok(json.errors.resourceType);
  } finally {
    restoreCompany();
    server.close();
  }
});

test("POST resource rejects bad resourceKey format / length", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const server = await listen(makeApp());
  try {
    for (const resourceKey of ["Bad Key", "ab", "a".repeat(64)]) {
      const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", {
        ...VALID_BODY,
        resourceKey,
      });
      assert.equal(res.status, 400, `should reject key '${resourceKey}'`);
      assert.ok(json.errors.resourceKey);
    }
  } finally {
    restoreCompany();
    server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/companies/:key/resources — provider/credential checks
// ------------------------------------------------------------------

test("POST resource rejects an unknown provider", async () => {
  const restoreSeed = await seedRegistry();
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", {
      ...VALID_BODY,
      providerKey: "openai",
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown provider/);
  } finally {
    restoreSeed();
    restoreCompany();
    server.close();
  }
});

test("POST resource rejects a type the provider does not advertise", async () => {
  const restoreSeed = await seedRegistry({
    templates: [{ resource_type: "object_bucket", display_name: "Bucket", max_per_credential: 3 }],
  });
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", VALID_BODY);
    assert.equal(res.status, 400);
    assert.match(json.error, /does not advertise resource type 'vector_index'/);
  } finally {
    restoreSeed();
    restoreCompany();
    server.close();
  }
});

test("POST resource accepts a type with no templates (unadvertised → allowed)", async () => {
  const restoreSeed = await seedRegistry({ templates: [] });
  const { restores, auditLog } = stubHappy();
  const restoreCreate = stub(ResourceRepository, "create", async () => 101);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", VALID_BODY);
    assert.equal(res.status, 201);
    assert.equal(json.resourceId, 101);
    assert.equal(auditLog[0].action, "resource.created");
  } finally {
    restoreSeed();
    restores.forEach((r) => r());
    restoreCreate();
    server.close();
  }
});

test("POST resource rejects a credential from another company", async () => {
  const restoreSeed = await seedRegistry();
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreCredential = stub(CredentialRepository, "findById", async () => ({
    id: 7,
    company_id: 99,
    provider_id: 1,
    credential_key: "cf-main",
  }));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", VALID_BODY);
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown credentialId/);
  } finally {
    restoreSeed();
    restoreCompany();
    restoreCredential();
    server.close();
  }
});

test("POST resource rejects a credential bound to a different provider", async () => {
  const restoreSeed = await seedRegistry();
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreCredential = stub(CredentialRepository, "findById", async () => ({
    id: 7,
    company_id: 2,
    provider_id: 42,
    credential_key: "other",
  }));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", VALID_BODY);
    assert.equal(res.status, 400);
    assert.match(json.error, /is for provider/);
  } finally {
    restoreSeed();
    restoreCompany();
    restoreCredential();
    server.close();
  }
});

test("POST resource enforces the template's max_per_credential with 409", async () => {
  const restoreSeed = await seedRegistry();
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreCredential = stub(CredentialRepository, "findById", async () => CREDENTIAL);
  const restoreCount = stub(ResourceRepository, "countByCredentialType", async () => 5);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", VALID_BODY);
    assert.equal(res.status, 409);
    assert.match(json.error, /max 5/);
  } finally {
    restoreSeed();
    restoreCompany();
    restoreCredential();
    restoreCount();
    server.close();
  }
});

test("POST resource rejects an unknown environmentKey", async () => {
  const restoreSeed = await seedRegistry();
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreCredential = stub(CredentialRepository, "findById", async () => CREDENTIAL);
  const restoreCount = stub(ResourceRepository, "countByCredentialType", async () => 0);
  const restoreEnvs = stub(CompanyRepository, "environments", async () => [{ id: 1, env_key: "prod" }]);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", {
      ...VALID_BODY,
      environmentKey: "dev",
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown environment 'dev'/);
  } finally {
    restoreSeed();
    restoreCompany();
    restoreCredential();
    restoreCount();
    restoreEnvs();
    server.close();
  }
});

test("POST resource resolves environmentKey, creates the row, and audits", async () => {
  let createArgs = null;
  const restoreSeed = await seedRegistry();
  const { restores, auditLog } = stubHappy();
  const restoreEnvs = stub(CompanyRepository, "environments", async () => [{ id: 1, env_key: "prod" }]);
  const restoreCreate = stub(ResourceRepository, "create", async (_companyId, input) => {
    createArgs = input;
    return 101;
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", {
      ...VALID_BODY,
      environmentKey: "prod",
      externalRegion: "WEUR",
      config: { dimensions: 768 },
      isDefault: true,
    });
    assert.equal(res.status, 201);
    assert.equal(json.success, true);
    assert.equal(json.resourceId, 101);
    assert.match(json.message, /provisioned under 'cf-main'/);
    assert.equal(createArgs.environmentId, 1);
    assert.equal(createArgs.resourceType, "vector_index");
    assert.equal(createArgs.resourceKey, "docs-index");
    assert.equal(createArgs.resourceName, "Docs Index");
    assert.equal(createArgs.externalRegion, "WEUR");
    assert.deepEqual(createArgs.config, { dimensions: 768 });
    assert.equal(createArgs.isDefault, true);
    assert.equal(createArgs.providerId, 1);
    assert.equal(createArgs.credentialId, 7);
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "resource.created");
    assert.equal(auditLog[0].companyId, 2);
    assert.equal(auditLog[0].entityType, "provider_resource");
    assert.equal(auditLog[0].entityId, 101);
  } finally {
    restoreSeed();
    restores.forEach((r) => r());
    restoreEnvs();
    restoreCreate();
    server.close();
  }
});

test("POST resource maps duplicate resource keys to 409", async () => {
  const restoreSeed = await seedRegistry();
  const { restores } = stubHappy();
  const restoreCreate = stub(ResourceRepository, "create", async () => {
    const err = new Error("Duplicate entry");
    err.code = "ER_DUP_ENTRY";
    throw err;
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/companies/popularcert/resources", VALID_BODY);
    assert.equal(res.status, 409);
    assert.match(json.error, /already exists/);
  } finally {
    restoreSeed();
    restores.forEach((r) => r());
    restoreCreate();
    server.close();
  }
});

// ------------------------------------------------------------------
// PUT /gateway/resources/:id
// ------------------------------------------------------------------

test("PUT resource returns 404 for an unknown resource", async () => {
  const restoreFind = stub(ResourceRepository, "findById", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/resources/999", { resourceName: "X" });
    assert.equal(res.status, 404);
    assert.match(json.error, /Resource not found/);
  } finally {
    restoreFind();
    server.close();
  }
});

test("PUT resource rejects an empty or over-long resourceName", async () => {
  const restoreFind = stub(ResourceRepository, "findById", async () => ({
    id: 5,
    company_id: 2,
    resource_key: "docs-index",
  }));
  const server = await listen(makeApp());
  try {
    for (const resourceName of ["", "  ", "a".repeat(201)]) {
      const { res } = await req(server, "PUT", "/gateway/resources/5", { resourceName });
      assert.equal(res.status, 400, `should reject name ${JSON.stringify(resourceName)}`);
    }
  } finally {
    restoreFind();
    server.close();
  }
});

test("PUT resource applies only the editable fields and audits resource.updated", async () => {
  let updateArgs = null;
  let auditEntry = null;
  const restoreFind = stub(ResourceRepository, "findById", async () => ({
    id: 5,
    company_id: 2,
    resource_key: "docs-index",
  }));
  const restoreUpdate = stub(ResourceRepository, "update", async (id, patch) => {
    updateArgs = { id, patch };
    return true;
  });
  const restoreAudit = stub(AuditRepository, "log", async (entry) => {
    auditEntry = entry;
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/resources/5", {
      resourceName: "Renamed Index",
      externalRegion: "US",
      description: "now",
      status: "provisioned",
      isDefault: true,
      // immutable fields are silently ignored
      resourceKey: "should-not-apply",
    });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(updateArgs.id, 5);
    assert.equal(updateArgs.patch.resourceName, "Renamed Index");
    assert.equal(updateArgs.patch.externalRegion, "US");
    assert.equal(updateArgs.patch.description, "now");
    assert.equal(updateArgs.patch.status, "provisioned");
    assert.equal(updateArgs.patch.isDefault, true);
    assert.equal(updateArgs.patch.resourceKey, undefined);
    assert.equal(auditEntry.action, "resource.updated");
    assert.equal(auditEntry.companyId, 2);
  } finally {
    restoreFind();
    restoreUpdate();
    restoreAudit();
    server.close();
  }
});

// ------------------------------------------------------------------
// DELETE /gateway/resources/:id
// ------------------------------------------------------------------

test("DELETE resource returns 404 for an unknown resource", async () => {
  const restoreFind = stub(ResourceRepository, "findById", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/resources/999");
    assert.equal(res.status, 404);
    assert.match(json.error, /Resource not found/);
  } finally {
    restoreFind();
    server.close();
  }
});

test("DELETE resource soft-deletes and audits resource.deleted", async () => {
  let removedId = null;
  let auditEntry = null;
  const restoreFind = stub(ResourceRepository, "findById", async () => ({
    id: 5,
    company_id: 2,
    resource_key: "docs-index",
  }));
  const restoreRemove = stub(ResourceRepository, "remove", async (id) => {
    removedId = id;
    return true;
  });
  const restoreAudit = stub(AuditRepository, "log", async (entry) => {
    auditEntry = entry;
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/resources/5");
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(removedId, 5);
    assert.equal(auditEntry.action, "resource.deleted");
    assert.deepEqual(auditEntry.afterState, { resource_key: "docs-index" });
  } finally {
    restoreFind();
    restoreRemove();
    restoreAudit();
    server.close();
  }
});
