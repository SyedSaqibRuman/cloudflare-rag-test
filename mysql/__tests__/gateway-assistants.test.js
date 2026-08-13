// --------------------------
// GATEWAY ASSISTANT ROUTE TESTS — the POST/PUT/DELETE /gateway/assistants
// endpoints (plus GET list/detail), exercised through a real express mount
// with stubbed repositories (no MySQL, no network). The assistant routes go
// straight to the repositories (no provider-registry cache involved), so
// unlike the resource tests there is no registry seeding — each test stubs
// the repository methods the service touches and restores them afterward.
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

const {
  CompanyRepository,
  CredentialRepository,
  ModelRepository,
  ResourceRepository,
  KbRepository,
  AssistantRepository,
  AuditRepository,
} = await import("../repositories.js");
const gatewayRouter = (await import("../gateway-router.js")).default;

const COMPANY = { id: 2, company_key: "popularcert", max_assistants: 5 };
const CREDENTIAL = { id: 7, company_id: 2, provider_id: 1, credential_key: "cf-main" };
const MODEL = { id: 9, provider_id: 1, model_key: "gpt-4o" };
const KB = { id: 4, company_id: 2 };
const GRAPH_RESOURCE = { id: 6, company_id: 2 };

// Full snake_case row shape updateAssistant merges over (matches the
// ASSISTANT_SELECT columns from repositories.js).
const EXISTING = {
  id: 30,
  assistant_key: "sales-bot",
  assistant_name: "Sales Bot",
  description: null,
  credential_id: 7,
  model_id: 9,
  system_prompt: null,
  temperature: 0.7,
  max_tokens: 4096,
  enable_function_calling: 1,
  enable_streaming: 1,
  tools: null,
  primary_kb_id: null,
  kb_ids: null,
  enable_graph_context: 0,
  graph_resource_id: null,
  is_active: 1,
  is_public: 0,
};

const HEADERS = { "x-company-name": "popularcert" };

const VALID_BODY = {
  assistantKey: "sales-bot",
  assistantName: "Sales Bot",
  credentialId: 7,
  modelId: 9,
  kbIds: [4],
  primaryKbId: 4,
  graphResourceId: 6,
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
 * Happy-path stubs for the assistant write paths: company resolves, the
 * credential/model/KBs/resources are all owned by that company, the key is
 * free, and the limit is not hit. Returns { restores, auditLog, calls } where
 * calls records create/update/remove arguments for assertions.
 */
function stubHappy({ existing = null } = {}) {
  const auditLog = [];
  const calls = { createArgs: null, updateArgs: null, removedId: null };
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) => (key === COMPANY.company_key ? COMPANY : null)),
    stub(AssistantRepository, "findByKey", async () => existing),
    stub(AssistantRepository, "listByCompany", async () => []),
    stub(CredentialRepository, "findById", async (id) => (Number(id) === CREDENTIAL.id ? CREDENTIAL : null)),
    stub(ModelRepository, "findById", async (id) => (Number(id) === MODEL.id ? MODEL : null)),
    stub(KbRepository, "findById", async (id) => (Number(id) === KB.id ? KB : null)),
    stub(ResourceRepository, "findById", async (id) => (Number(id) === GRAPH_RESOURCE.id ? GRAPH_RESOURCE : null)),
    stub(AssistantRepository, "create", async (companyId, input) => {
      calls.createArgs = { companyId, input };
      return 42;
    }),
    stub(AssistantRepository, "update", async (id, input) => {
      calls.updateArgs = { id, input };
      return true;
    }),
    stub(AssistantRepository, "remove", async (id) => {
      calls.removedId = id;
      return true;
    }),
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

// ------------------------------------------------------------------
// requireGatewayCompany gate (x-company-name resolution)
// ------------------------------------------------------------------

test("assistant routes reject a missing company with 400", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY);
    assert.equal(res.status, 400);
    assert.match(json.error, /Company is required/);
  } finally {
    server.close();
  }
});

test("assistant routes reject an unknown company with 404", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY, {
      "x-company-name": "ghost",
    });
    assert.equal(res.status, 404);
    assert.match(json.error, /Company 'ghost' not found/);
  } finally {
    restoreCompany();
    server.close();
  }
});

// ------------------------------------------------------------------
// GET /gateway/assistants
// ------------------------------------------------------------------

test("GET assistants lists the company's assistants", async () => {
  let scopedCompanyId = null;
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreList = stub(AssistantRepository, "listByCompany", async (companyId) => {
    scopedCompanyId = companyId;
    return [{ id: 30, assistant_key: "sales-bot", assistant_name: "Sales Bot" }];
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/assistants", undefined, HEADERS);
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(scopedCompanyId, 2);
    assert.equal(json.assistants.length, 1);
    assert.equal(json.assistants[0].assistant_key, "sales-bot");
  } finally {
    restoreCompany();
    restoreList();
    server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/assistants — validation
// ------------------------------------------------------------------

test("POST assistant rejects an empty body with 400 + per-field errors", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", {}, HEADERS);
    assert.equal(res.status, 400);
    assert.match(json.error, /Validation failed/);
    assert.match(json.error, /assistantKey/);
    assert.match(json.error, /assistantName/);
    assert.match(json.error, /credentialId/);
  } finally {
    restoreCompany();
    server.close();
  }
});

test("POST assistant rejects a malformed assistantKey", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const server = await listen(makeApp());
  try {
    for (const assistantKey of ["Sales Bot", "sales_bot", "ab", "a".repeat(64)]) {
      const { res, json } = await req(server, "POST", "/gateway/assistants", {
        ...VALID_BODY,
        assistantKey,
      }, HEADERS);
      assert.equal(res.status, 400, `should reject key '${assistantKey}'`);
      assert.match(json.error, /Validation failed/);
      assert.match(json.error, /assistantKey/);
    }
  } finally {
    restoreCompany();
    server.close();
  }
});

test("POST assistant rejects a duplicate assistantKey with 409", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => ({ id: 30 }));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY, HEADERS);
    assert.equal(res.status, 409);
    assert.match(json.error, /already exists/);
  } finally {
    restoreCompany();
    restoreFind();
    server.close();
  }
});

test("POST assistant enforces the company's max_assistants with 409", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => null);
  const restoreList = stub(AssistantRepository, "listByCompany", async () => Array(5).fill({ id: 1 }));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY, HEADERS);
    assert.equal(res.status, 409);
    assert.match(json.error, /assistant limit reached \(5\)/);
  } finally {
    restoreCompany();
    restoreFind();
    restoreList();
    server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/assistants — ownership checks
// ------------------------------------------------------------------

test("POST assistant rejects an unknown credentialId with 400", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => null);
  const restoreList = stub(AssistantRepository, "listByCompany", async () => []);
  const restoreCredential = stub(CredentialRepository, "findById", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY, HEADERS);
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown credentialId '7'/);
  } finally {
    restoreCompany();
    restoreFind();
    restoreList();
    restoreCredential();
    server.close();
  }
});

test("POST assistant rejects a credential from another company", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => null);
  const restoreList = stub(AssistantRepository, "listByCompany", async () => []);
  const restoreCredential = stub(CredentialRepository, "findById", async () => ({
    id: 7,
    company_id: 99,
    provider_id: 1,
  }));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY, HEADERS);
    assert.equal(res.status, 400);
    assert.match(json.error, /does not belong to this company/);
  } finally {
    restoreCompany();
    restoreFind();
    restoreList();
    restoreCredential();
    server.close();
  }
});

test("POST assistant rejects an unknown modelId", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => null);
  const restoreList = stub(AssistantRepository, "listByCompany", async () => []);
  const restoreCredential = stub(CredentialRepository, "findById", async () => CREDENTIAL);
  const restoreModel = stub(ModelRepository, "findById", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY, HEADERS);
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown modelId '9'/);
  } finally {
    restoreCompany();
    restoreFind();
    restoreList();
    restoreCredential();
    restoreModel();
    server.close();
  }
});

test("POST assistant rejects a model from a different provider than the credential", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => null);
  const restoreList = stub(AssistantRepository, "listByCompany", async () => []);
  const restoreCredential = stub(CredentialRepository, "findById", async () => CREDENTIAL);
  const restoreModel = stub(ModelRepository, "findById", async () => ({
    id: 9,
    provider_id: 42,
    model_key: "other-model",
  }));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY, HEADERS);
    assert.equal(res.status, 400);
    assert.match(json.error, /does not belong to the credential's provider/);
  } finally {
    restoreCompany();
    restoreFind();
    restoreList();
    restoreCredential();
    restoreModel();
    server.close();
  }
});

test("POST assistant rejects an unknown kbId", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => null);
  const restoreList = stub(AssistantRepository, "listByCompany", async () => []);
  const restoreCredential = stub(CredentialRepository, "findById", async () => CREDENTIAL);
  const restoreModel = stub(ModelRepository, "findById", async () => MODEL);
  const restoreKb = stub(KbRepository, "findById", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY, HEADERS);
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown kbId '4'/);
  } finally {
    restoreCompany();
    restoreFind();
    restoreList();
    restoreCredential();
    restoreModel();
    restoreKb();
    server.close();
  }
});

test("POST assistant rejects a KB owned by another company", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => null);
  const restoreList = stub(AssistantRepository, "listByCompany", async () => []);
  const restoreCredential = stub(CredentialRepository, "findById", async () => CREDENTIAL);
  const restoreModel = stub(ModelRepository, "findById", async () => MODEL);
  const restoreKb = stub(KbRepository, "findById", async () => ({ id: 4, company_id: 99 }));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY, HEADERS);
    assert.equal(res.status, 400);
    assert.match(json.error, /does not belong to this company/);
  } finally {
    restoreCompany();
    restoreFind();
    restoreList();
    restoreCredential();
    restoreModel();
    restoreKb();
    server.close();
  }
});

test("POST assistant rejects an unknown graphResourceId", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => null);
  const restoreList = stub(AssistantRepository, "listByCompany", async () => []);
  const restoreCredential = stub(CredentialRepository, "findById", async () => CREDENTIAL);
  const restoreModel = stub(ModelRepository, "findById", async () => MODEL);
  const restoreKb = stub(KbRepository, "findById", async () => KB);
  const restoreResource = stub(ResourceRepository, "findById", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY, HEADERS);
    assert.equal(res.status, 400);
    assert.match(json.error, /Unknown graphResourceId '6'/);
  } finally {
    restoreCompany();
    restoreFind();
    restoreList();
    restoreCredential();
    restoreModel();
    restoreKb();
    restoreResource();
    server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/assistants — success
// ------------------------------------------------------------------

test("POST assistant creates the row with a resolved model_key and audits assistant.created", async () => {
  const { restores, auditLog, calls } = stubHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/assistants", VALID_BODY, HEADERS);
    assert.equal(res.status, 201);
    assert.equal(json.success, true);
    assert.equal(json.assistantId, 42);
    assert.equal(json.assistantKey, "sales-bot");
    assert.match(json.message, /created/);
    assert.equal(calls.createArgs.companyId, 2);
    assert.equal(calls.createArgs.input.assistantKey, "sales-bot");
    assert.equal(calls.createArgs.input.credentialId, 7);
    assert.equal(calls.createArgs.input.modelId, 9);
    assert.equal(calls.createArgs.input.modelKey, "gpt-4o");
    assert.deepEqual(calls.createArgs.input.kbIds, [4]);
    assert.equal(calls.createArgs.input.primaryKbId, 4);
    assert.equal(calls.createArgs.input.graphResourceId, 6);
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "assistant.created");
    assert.equal(auditLog[0].entityType, "assistant");
    assert.equal(auditLog[0].entityId, 42);
    assert.equal(auditLog[0].companyId, 2);
    assert.deepEqual(auditLog[0].afterState, { assistant_key: "sales-bot" });
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

// ------------------------------------------------------------------
// GET /gateway/assistants/:key
// ------------------------------------------------------------------

test("GET assistant by key returns 404 for an unknown assistant", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/assistants/sales-bot", undefined, HEADERS);
    assert.equal(res.status, 404);
    assert.match(json.error, /Assistant 'sales-bot' not found/);
  } finally {
    restoreCompany();
    restoreFind();
    server.close();
  }
});

test("GET assistant by key returns the assistant", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => EXISTING);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/assistants/sales-bot", undefined, HEADERS);
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.assistant.assistant_key, "sales-bot");
  } finally {
    restoreCompany();
    restoreFind();
    server.close();
  }
});

// ------------------------------------------------------------------
// PUT /gateway/assistants/:key
// ------------------------------------------------------------------

test("PUT assistant returns 404 for an unknown assistant", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/assistants/sales-bot", { assistantName: "X" }, HEADERS);
    assert.equal(res.status, 404);
    assert.match(json.error, /Assistant 'sales-bot' not found/);
  } finally {
    restoreCompany();
    restoreFind();
    server.close();
  }
});

test("PUT assistant rejects invalid merged input with 400", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => EXISTING);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/assistants/sales-bot", { temperature: 9 }, HEADERS);
    assert.equal(res.status, 400);
    assert.match(json.error, /Validation failed/);
    assert.match(json.error, /temperature/);
  } finally {
    restoreCompany();
    restoreFind();
    server.close();
  }
});

test("PUT assistant merges over the existing row, keeps the key, and audits assistant.updated", async () => {
  const { restores, auditLog, calls } = stubHappy({ existing: EXISTING });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/assistants/sales-bot", {
      assistantName: "Sales Bot v2",
      temperature: 0.5,
      // immutable: ignored in the merge
      assistantKey: "should-not-change",
    }, HEADERS);
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.assistantId, 30);
    assert.equal(json.assistantKey, "sales-bot");
    assert.equal(calls.updateArgs.id, 30);
    assert.equal(calls.updateArgs.input.assistantName, "Sales Bot v2");
    assert.equal(calls.updateArgs.input.temperature, 0.5);
    assert.equal(calls.updateArgs.input.assistantKey, "sales-bot");
    assert.equal(calls.updateArgs.input.modelKey, "gpt-4o");
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "assistant.updated");
    assert.equal(auditLog[0].entityId, 30);
    assert.deepEqual(auditLog[0].beforeState, { assistant_key: "sales-bot", model_id: 9 });
    assert.deepEqual(auditLog[0].afterState, { assistant_key: "sales-bot", model_id: 9 });
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

// ------------------------------------------------------------------
// DELETE /gateway/assistants/:key
// ------------------------------------------------------------------

test("DELETE assistant returns 404 for an unknown assistant", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(AssistantRepository, "findByKey", async () => null);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/assistants/sales-bot", undefined, HEADERS);
    assert.equal(res.status, 404);
    assert.match(json.error, /Assistant 'sales-bot' not found/);
  } finally {
    restoreCompany();
    restoreFind();
    server.close();
  }
});

test("DELETE assistant soft-deletes and audits assistant.deleted", async () => {
  const { restores, auditLog, calls } = stubHappy({ existing: EXISTING });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/assistants/sales-bot", undefined, HEADERS);
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.match(json.message, /deleted/);
    assert.equal(calls.removedId, 30);
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "assistant.deleted");
    assert.equal(auditLog[0].entityType, "assistant");
    assert.equal(auditLog[0].entityId, 30);
    assert.deepEqual(auditLog[0].afterState, { assistant_key: "sales-bot" });
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});
