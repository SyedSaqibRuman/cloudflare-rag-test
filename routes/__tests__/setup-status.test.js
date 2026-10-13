// --------------------------
// SETUP STATUS ROUTE TESTS — GET /cloudflare/setup-status
// Runs the real setup-status router through a real express app. Config uses
// an isolated temp dir (each test file is its own process). MySQL-dependent
// parts are optional by design: without MySQL the content step just stays
// open, so tests only assert config-backed steps + sequential order.
// --------------------------
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Isolated cwd BEFORE any project module loads (db/ + processed/ live under
// cwd). Only node builtins + express may be static imports — everything else
// is dynamically imported below so the chdir/env scrub happens first (env.js
// freezes dotenv values at import time; a hoisted import would load the real
// .env and pull the test into a live MySQL pool).
const TEST_DIR = mkdtempSync(path.join(tmpdir(), "setup-status-"));
process.chdir(TEST_DIR);
process.env.CONFIG_STORE = "sqlite";
for (const k of ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE", "MYSQL_SSL"]) {
  delete process.env[k];
}

const { createCompany, deleteCompany, updateConfig } = await import("../../config/index.js");
const { default: router } = await import("../../routes/cloudflare/setup-status.js");

await createCompany("setupco");

after(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withApp(run) {
  const app = express();
  app.use(express.json());
  app.use("/cloudflare/setup-status", router);
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}/cloudflare/setup-status`;
    await run(base);
  } finally {
    server.close();
  }
}

test("steps come back in sequential order with only workspace done for a fresh company", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}?company=setupco`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.complete, false);
    assert.deepEqual(
      data.steps.map((s) => s.id),
      ["workspace", "credentials", "vector-index", "storage", "content", "assistant", "chat"]
    );
    assert.deepEqual(
      data.steps.map((s) => s.done),
      [true, false, false, false, false, false, false]
    );
    assert.equal(data.next.id, "credentials"); // first incomplete in sequence
    assert.equal(data.doneCount, 1);
    assert.equal(data.total, 7);
  });
});

test("config-backed steps flip done in order as the company is configured", async () => {
  await updateConfig(
    {
      CLOUDFLARE_ACCOUNT_ID: "acc123",
      CLOUDFLARE_API_TOKEN: "tok123",
      VECTOR_INDEX: "setup-index",
      R2_BUCKET_NAME: "setup-data",
    },
    "setupco"
  );

  await withApp(async (base) => {
    const res = await fetch(`${base}?company=setupco`);
    const data = await res.json();
    assert.deepEqual(
      data.steps.map((s) => s.done),
      [true, true, true, true, false, false, false]
    );
    const byId = Object.fromEntries(data.steps.map((s) => [s.id, s]));
    assert.equal(byId["vector-index"].detail, "setup-index");
    assert.equal(byId.storage.detail, "setup-data");
    assert.equal(data.next.id, "content");
  });
});

test("assistant checkpoint flips done when ASSISTANT_KEY is set (config fallback, no MySQL rows)", async () => {
  const { updateConfig } = await import("../../config/index.js");
  await updateConfig({ ASSISTANT_KEY: "legacy-assistant" }, "setupco");

  await withApp(async (base) => {
    const res = await fetch(`${base}?company=setupco`);
    const data = await res.json();
    const byId = Object.fromEntries(data.steps.map((s) => [s.id, s]));
    assert.equal(byId.assistant.done, true, "ASSISTANT_KEY alone counts as an assistant");
    assert.equal(byId.assistant.detail, "legacy-assistant");
  });

  await updateConfig({ ASSISTANT_KEY: "" }, "setupco");
});

test("revoked credential flips the AI Provider checkpoint back to incomplete (divergence from the onboarding wizard)", async () => {
  // The wizard (web/src/onboarding-state.js) probes workspace ARTIFACTS — its
  // "Connect AI Services" step stays done as long as a credential ROW exists.
  // The checkpoint probes CONFIG INTEGRITY — the CLOUDFLARE_API_TOKEN the RAG
  // pipeline would actually use (cleared by rag-sync when the connection is
  // deleted). This test pins the checkpoint side of that split: after a
  // revoke, setup-status must reopen "credentials" (and downstream steps
  // stay as they are) so SetupCheckpoints reappears while the wizard stays
  // green. Both views on one company are allowed to disagree by design.
  const { updateConfig } = await import("../../config/index.js");
  await updateConfig({ CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_API_TOKEN: "" }, "setupco");

  await withApp(async (base) => {
    const res = await fetch(`${base}?company=setupco`);
    const data = await res.json();
    assert.equal(data.complete, false);
    const byId = Object.fromEntries(data.steps.map((s) => [s.id, s]));
    assert.equal(byId.credentials.done, false, "revoked token must reopen the AI Provider checkpoint");
    assert.equal(byId["vector-index"].done, true, "index selection survives a credential revoke");
    assert.equal(byId.storage.done, true, "storage selection survives a credential revoke");
    assert.equal(data.next.id, "credentials", "next blocker is the revoked credential");
  });

  // Restore so later tests keep their assumptions.
  await updateConfig(
    { CLOUDFLARE_ACCOUNT_ID: "acc123", CLOUDFLARE_API_TOKEN: "tok123" },
    "setupco"
  );
});

test("unknown company is rejected with 400 by the shared company gate", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}?company=nope`);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /not found/i);
  });
});

test("missing company header is a 400", async () => {
  await withApp(async (base) => {
    const res = await fetch(base);
    assert.equal(res.status, 400);
  });
});

test("deleteCompany makes the company unknown again (400)", async () => {
  await createCompany("ghostco");
  await deleteCompany("ghostco");
  await withApp(async (base) => {
    const res = await fetch(`${base}?company=ghostco`);
    assert.equal(res.status, 400);
  });
});

test("chat marker flips the final checkpoint", async () => {
  const { markCompanyChat, hasCompanyChatted } = await import("../../utils/setup-progress.js");
  assert.equal(hasCompanyChatted("setupco"), false);
  markCompanyChat("setupco");
  markCompanyChat("setupco"); // idempotent
  assert.equal(hasCompanyChatted("setupco"), true);

  await withApp(async (base) => {
    const res = await fetch(`${base}?company=setupco`);
    const data = await res.json();
    const byId = Object.fromEntries(data.steps.map((s) => [s.id, s]));
    assert.equal(byId.chat.done, true);
  });
});
