// --------------------------
// INGEST GUARD FAILURE-RECORDING TESTS — locks the Gap-2 fix: a pre-flight
// config guard failure (vector/storage adapter missing) must be RECORDED on
// the KB row (status=error + last_error + audit) instead of exiting silently.
// ingest.js main() is exercised through real module imports with the
// repositories stubbed in-place (no MySQL, no network, no Cloudflare).
// Run with: node --test ingest/__tests__/ingest-guard-recording.test.js
// --------------------------
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// env.js freezes MYSQL_* at import time — dummies BEFORE any gateway import
// so the lazy pool is never touched (all repositories stubbed below).
process.env.MYSQL_HOST = "127.0.0.1";
process.env.MYSQL_DATABASE = "gateway_test";
process.env.MYSQL_USER = "test";
process.env.MYSQL_PASSWORD = "test";
process.env.APP_ENCRYPTION_KEY = "cd".repeat(32);

const { CompanyRepository, KbRepository, AuditRepository } = await import("../../mysql/repositories.js");
const { main } = await import("../../ingest.js");

const COMPANY = { id: 7, company_key: "guardco" };
const KB_ROW = {
  id: 42,
  company_id: 7,
  kb_key: "broken-kb",
  source_type: "file",
  source_config: JSON.stringify({ files: ["x.pdf"] }),
  vector_resource_id: null,
  storage_resource_id: null,
  chunk_size: 512,
};

/** Stub a repository method, returning a restore function. */
function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

describe("ingest pre-flight guard failure recording", () => {
  test("missing vector adapter records last_error + flips status to error", async () => {
    const calls = { status: [], errors: [], audits: [] };
    const restores = [
      stub(CompanyRepository, "findByKey", async (key) => (key === COMPANY.company_key ? COMPANY : null)),
      stub(KbRepository, "findByKey", async (companyId, kbKey) =>
        kbKey === KB_ROW.kb_key ? KB_ROW : null
      ),
      stub(KbRepository, "setStatus", async (id, status) => calls.status.push([id, status])),
      stub(KbRepository, "setIngestionError", async (id, message) => calls.errors.push([id, message])),
      stub(KbRepository, "setIngestionStats", async () => {}),
      stub(AuditRepository, "log", async (entry) => calls.audits.push(entry)),
    ];
    try {
      await assert.rejects(
        () => main({ companyName: COMPANY.company_key, kbKey: KB_ROW.kb_key }),
        /not configured for KB 'broken-kb'/
      );
      // The failure must be VISIBLE on the row — this is the regression lock.
      assert.deepEqual(calls.status, [[42, "indexing"], [42, "error"]]);
      assert.equal(calls.errors.length, 1);
      // Either guard may fire first (storage is checked before vector) — both
      // must be recorded the same way.
      assert.match(calls.errors[0][1], /not configured for KB 'broken-kb'/);
      assert.equal(calls.audits.filter((a) => a.action === "kb.ingest.failed").length, 1);
    } finally {
      restores.forEach((r) => r());
    }
  });

  test("unknown company fails fast without recording (no KB row exists)", async () => {
    const calls = { status: [], errors: [] };
    const restores = [
      stub(CompanyRepository, "findByKey", async () => null),
      stub(KbRepository, "setStatus", async (id, status) => calls.status.push([id, status])),
      stub(KbRepository, "setIngestionError", async (id, message) => calls.errors.push([id, message])),
    ];
    try {
      await assert.rejects(
        () => main({ companyName: "no-such-co", kbKey: "x" }),
        /Company 'no-such-co' not found/
      );
      assert.deepEqual(calls.status, []);
      assert.deepEqual(calls.errors, []);
    } finally {
      restores.forEach((r) => r());
    }
  });
});
