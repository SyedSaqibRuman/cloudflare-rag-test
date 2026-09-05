// --------------------------
// GATEWAY WORKFLOW ROUTE TESTS
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.MYSQL_HOST = "127.0.0.1";
process.env.MYSQL_DATABASE = "gateway_test";
process.env.MYSQL_USER = "test";
process.env.MYSQL_PASSWORD = "test";

const {
  CompanyRepository,
  AssistantRepository,
  WorkflowRepository,
  AuditRepository,
} = await import("../repositories.js");
const gatewayRouter = (await import("../gateway-router.js")).default;

const COMPANY = { id: 2, company_key: "popularcert" };
const ASSISTANT = { id: 10, company_id: 2 };

const EXISTING = {
  id: 60,
  workflow_key: "nightly-ingest",
  workflow_name: "Nightly Ingestion",
  description: "Ingest content every night",
  trigger_type: "schedule",
  status: "draft",
  is_active: 1,
  definition: { steps: [{ type: "ingest", config: { kbKey: "docs" } }] },
  primary_assistant_id: null,
  trigger_config: { cron: "0 2 * * *" },
};

const HEADERS = { "x-company-name": "popularcert" };

function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => { obj[method] = original; };
}

function stubHappy({ existing = null } = {}) {
  const auditLog = [];
  const calls = { createArgs: null, updateArgs: null, removedId: null };
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) => key === COMPANY.company_key ? COMPANY : null),
    stub(WorkflowRepository, "findByKey", async () => existing),
    stub(WorkflowRepository, "listByCompany", async () => []),
    stub(AssistantRepository, "findById", async (id) => Number(id) === ASSISTANT.id ? ASSISTANT : null),
    stub(WorkflowRepository, "create", async (companyId, input) => { calls.createArgs = { companyId, input }; return 60; }),
    stub(WorkflowRepository, "update", async (id, input) => { calls.updateArgs = { id, input }; return true; }),
    stub(WorkflowRepository, "remove", async (id) => { calls.removedId = id; return true; }),
    stub(AuditRepository, "log", async (entry) => { auditLog.push(entry); }),
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
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}

async function req(server, method, urlPath, body, headers = {}) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* */ }
  return { res, json };
}

// ------------------------------------------------------------------
// GET /gateway/workflows
// ------------------------------------------------------------------

test("GET workflows lists the company's workflows", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreList = stub(WorkflowRepository, "listByCompany", async () => [
    { id: 60, workflow_key: "nightly-ingest", workflow_name: "Nightly Ingestion", status: "draft" },
  ]);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/gateway/workflows", undefined, HEADERS);
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.workflows.length, 1);
  } finally {
    restoreCompany(); restoreList(); server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/workflows — validation
// ------------------------------------------------------------------

test("POST workflow rejects empty body with 400", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/workflows", {}, HEADERS);
    assert.equal(res.status, 400);
    assert.match(json.error, /Validation failed/);
  } finally {
    restoreCompany(); server.close();
  }
});

test("POST workflow rejects duplicate key with 409", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(WorkflowRepository, "findByKey", async () => ({ id: 60 }));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/workflows", {
      workflowKey: "nightly-ingest", workflowName: "Test", triggerType: "manual",
    }, HEADERS);
    assert.equal(res.status, 409);
    assert.match(json.error, /already exists/);
  } finally {
    restoreCompany(); restoreFind(); server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/workflows — success
// ------------------------------------------------------------------

test("POST workflow creates and audits", async () => {
  const { restores, auditLog, calls } = stubHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/workflows", {
      workflowKey: "nightly-ingest", workflowName: "Nightly Ingestion",
      triggerType: "manual", definition: { steps: [{ type: "ingest", config: {} }] },
    }, HEADERS);
    assert.equal(res.status, 201);
    assert.equal(json.success, true);
    assert.equal(json.workflowId, 60);
    assert.equal(calls.createArgs.input.workflowKey, "nightly-ingest");
    assert.equal(auditLog[0].action, "workflow.created");
  } finally {
    restores.forEach((r) => r()); server.close();
  }
});

// ------------------------------------------------------------------
// PUT /gateway/workflows/:key
// ------------------------------------------------------------------

test("PUT workflow returns 404 for unknown", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(WorkflowRepository, "findByKey", async () => null);
  const server = await listen(makeApp());
  try {
    const { res } = await req(server, "PUT", "/gateway/workflows/unknown", { workflowName: "X" }, HEADERS);
    assert.equal(res.status, 404);
  } finally {
    restoreCompany(); restoreFind(); server.close();
  }
});

test("PUT workflow merges and audits", async () => {
  const { restores, auditLog, calls } = stubHappy({ existing: EXISTING });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/workflows/nightly-ingest", {
      workflowName: "Nightly Content Sync",
    }, HEADERS);
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(calls.updateArgs.input.workflowName, "Nightly Content Sync");
    assert.equal(auditLog[0].action, "workflow.updated");
  } finally {
    restores.forEach((r) => r()); server.close();
  }
});

// ------------------------------------------------------------------
// DELETE /gateway/workflows/:key
// ------------------------------------------------------------------

test("DELETE workflow soft-deletes and audits", async () => {
  const { restores, auditLog, calls } = stubHappy({ existing: EXISTING });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/workflows/nightly-ingest", undefined, HEADERS);
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(calls.removedId, 60);
    assert.equal(auditLog[0].action, "workflow.deleted");
  } finally {
    restores.forEach((r) => r()); server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/workflows/:key/activate
// ------------------------------------------------------------------

test("POST activate sets status to active", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(WorkflowRepository, "findByKey", async () => ({ ...EXISTING, status: "draft" }));
  let updateInput = null;
  const restoreUpdate = stub(WorkflowRepository, "update", async (id, input) => { updateInput = input; return true; });
  const restoreAudit = stub(AuditRepository, "log", async () => {});
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/workflows/nightly-ingest/activate", undefined, HEADERS);
    assert.equal(res.status, 200);
    assert.equal(updateInput.status, "active");
    assert.equal(updateInput.isActive, true);
  } finally {
    restoreCompany(); restoreFind(); restoreUpdate(); restoreAudit(); server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/workflows/:key/pause
// ------------------------------------------------------------------

test("POST pause sets status to paused", async () => {
  const restoreCompany = stub(CompanyRepository, "findByKey", async () => COMPANY);
  const restoreFind = stub(WorkflowRepository, "findByKey", async () => ({ ...EXISTING, status: "active" }));
  let updateInput = null;
  const restoreUpdate = stub(WorkflowRepository, "update", async (id, input) => { updateInput = input; return true; });
  const restoreAudit = stub(AuditRepository, "log", async () => {});
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/workflows/nightly-ingest/pause", undefined, HEADERS);
    assert.equal(res.status, 200);
    assert.equal(updateInput.status, "paused");
    assert.equal(updateInput.isActive, false);
  } finally {
    restoreCompany(); restoreFind(); restoreUpdate(); restoreAudit(); server.close();
  }
});
