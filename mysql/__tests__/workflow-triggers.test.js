// --------------------------
// WORKFLOW TRIGGER TESTS — webhook token + schedule validation
// (No live cron timers — those keep the event loop alive.)
// --------------------------
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import crypto from "crypto";
import { closePool } from "../pool.js";

process.env.MYSQL_HOST = "127.0.0.1";
process.env.MYSQL_DATABASE = "gateway_test";
process.env.MYSQL_USER = "test";
process.env.MYSQL_PASSWORD = "test";

const { CompanyRepository, WorkflowRepository, AuditRepository } = await import("../repositories.js");
const { generateWebhookToken } = await import("../services/workflow-service.js");

const COMPANY = { id: 2, company_key: "popularcert" };

// runWorkflow best-effort persists runs via the lazy MySQL pool (logRun in
// workflow-runner.js). When .env has live MySQL creds this opens a real pooled
// socket that otherwise keeps the process alive after the last test — close it
// so the suite exits cleanly. No-op when the pool was never opened.
after(async () => {
  await closePool();
});

const WEBHOOK_WORKFLOW = {
  id: 70,
  workflow_key: "webhook-test",
  workflow_name: "Webhook Test",
  trigger_type: "webhook",
  status: "active",
  is_active: 1,
  definition: { steps: [{ type: "notify", config: { message: "Webhook triggered!" } }] },
  trigger_config: { webhook_secret: "test-secret-123" },
};

const HEADERS = { "x-company-name": "popularcert" };

function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => { obj[method] = original; };
}

function stubHappy() {
  const auditLog = [];
  const restores = [
    stub(CompanyRepository, "findByKey", async (key) => key === COMPANY.company_key ? COMPANY : null),
    stub(AuditRepository, "log", async (entry) => { auditLog.push(entry); }),
  ];
  return { restores, auditLog };
}

let workflowTriggerRoutes;

async function loadRoutes() {
  if (!workflowTriggerRoutes) {
    workflowTriggerRoutes = (await import("../../routes/workflow-triggers.js")).default;
  }
}

async function makeApp() {
  await loadRoutes();
  const app = express();
  app.use(express.json());
  app.use("/webhooks", workflowTriggerRoutes);
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
// Webhook token generation
// ------------------------------------------------------------------

test("generateWebhookToken returns token and secret", () => {
  const { token, secret } = generateWebhookToken();
  assert.ok(token, "token should be set");
  assert.ok(secret, "secret should be set");
  assert.equal(typeof token, "string");
  assert.equal(typeof secret, "string");
});

test("generateWebhookToken produces different tokens each call", () => {
  const t1 = generateWebhookToken();
  const t2 = generateWebhookToken();
  assert.notEqual(t1.token, t2.token);
  assert.notEqual(t1.secret, t2.secret);
});

test("webhook token verification works with valid secret", () => {
  const { secret } = generateWebhookToken();
  const hmac = crypto.createHmac("sha256", secret).update("webhook").digest("hex");
  // Simulate what the route does
  const provided = Buffer.from(hmac, "hex");
  const expected = crypto.createHmac("sha256", secret).update("webhook").digest();
  assert.ok(crypto.timingSafeEqual(provided, expected));
});

test("webhook token verification fails with wrong secret", () => {
  const hmac = crypto.createHmac("sha256", "wrong-secret").update("webhook").digest("hex");
  const provided = Buffer.from(hmac, "hex");
  const expected = crypto.createHmac("sha256", "correct-secret").update("webhook").digest();
  assert.ok(!crypto.timingSafeEqual(provided, expected));
});

// ------------------------------------------------------------------
// Webhook endpoint
// ------------------------------------------------------------------

test("POST /webhooks triggers a workflow with valid token", async () => {
  const { restores } = stubHappy();
  const restoreFind = stub(WorkflowRepository, "findByKey", async () => ({ ...WEBHOOK_WORKFLOW }));
  const server = await listen(await makeApp());
  try {
    const hmac = crypto.createHmac("sha256", "test-secret-123").update("webhook").digest("hex");
    const { res, json } = await req(server, "POST", "/webhooks/popularcert/webhook-test", undefined, {
      ...HEADERS,
      Authorization: `Bearer ${hmac}`,
    });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(json.runId);
  } finally {
    restores.forEach((r) => r());
    restoreFind();
    server.close();
  }
});

test("POST /webhooks rejects invalid token", async () => {
  const { restores } = stubHappy();
  const restoreFind = stub(WorkflowRepository, "findByKey", async () => ({ ...WEBHOOK_WORKFLOW }));
  const server = await listen(await makeApp());
  try {
    const { res, json } = await req(server, "POST", "/webhooks/popularcert/webhook-test", undefined, {
      ...HEADERS,
      Authorization: "Bearer invalid-token",
    });
    assert.equal(res.status, 401);
    assert.match(json.error, /Invalid webhook token/);
  } finally {
    restores.forEach((r) => r());
    restoreFind();
    server.close();
  }
});

test("POST /webhooks rejects non-webhook workflow", async () => {
  const { restores } = stubHappy();
  const restoreFind = stub(WorkflowRepository, "findByKey", async () => ({
    ...WEBHOOK_WORKFLOW,
    trigger_type: "schedule",
  }));
  const server = await listen(await makeApp());
  try {
    const { res, json } = await req(server, "POST", "/webhooks/popularcert/webhook-test", undefined, HEADERS);
    assert.equal(res.status, 400);
    assert.match(json.error, /webhook trigger enabled/);
  } finally {
    restores.forEach((r) => r());
    restoreFind();
    server.close();
  }
});

test("GET /webhooks returns workflow health check", async () => {
  const { restores } = stubHappy();
  const restoreFind = stub(WorkflowRepository, "findByKey", async () => ({ ...WEBHOOK_WORKFLOW }));
  const server = await listen(await makeApp());
  try {
    const { res, json } = await req(server, "GET", "/webhooks/popularcert/webhook-test", undefined, HEADERS);
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.workflow, "webhook-test");
    assert.equal(json.triggerType, "webhook");
  } finally {
    restores.forEach((r) => r());
    restoreFind();
    server.close();
  }
});
