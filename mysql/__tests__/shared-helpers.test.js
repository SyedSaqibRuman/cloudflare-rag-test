// --------------------------
// SHARED ROUTE HELPERS TESTS
// Tests for actorFromReq, requireKb, findRunningIngestJob.
// Pure unit tests — no MySQL, no network.
// Run with: node --test "mysql/__tests__/shared-helpers.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { KbRepository } from "../repositories.js";
import { standaloneJobs } from "../../cron/lifecycle.js";
import { NotFoundError } from "../../shared/errors.js";
import { actorFromReq, requireKb, findRunningIngestJob } from "../routes/shared-helpers.js";

// ---- actorFromReq ----

test("actorFromReq returns admin actor with user from req.auth", () => {
  const req = { auth: { user: "admin@co.com" }, ip: "127.0.0.1" };
  const actor = actorFromReq(req);
  assert.deepStrictEqual(actor, {
    actorType: "admin",
    actorId: "admin@co.com",
    actorIp: "127.0.0.1",
  });
});

test("actorFromReq returns null actorId when req.auth is undefined", () => {
  const req = { ip: "10.0.0.1" };
  const actor = actorFromReq(req);
  assert.equal(actor.actorId, null);
  assert.equal(actor.actorIp, "10.0.0.1");
});

test("actorFromReq returns null actorId when req.auth.user is falsy", () => {
  const req = { auth: {}, ip: "::1" };
  const actor = actorFromReq(req);
  assert.equal(actor.actorId, null);
});

// ---- requireKb ----

const origFindByKey = KbRepository.findByKey;

test("requireKb returns KB when found", async () => {
  const fakeKb = { id: 1, kbKey: "my-kb", kbName: "My KB" };
  KbRepository.findByKey = async (companyId, kbKey) => {
    assert.equal(companyId, 42);
    assert.equal(kbKey, "my-kb");
    return fakeKb;
  };
  try {
    const result = await requireKb(42, "my-kb");
    assert.deepStrictEqual(result, fakeKb);
  } finally {
    KbRepository.findByKey = origFindByKey;
  }
});

test("requireKb throws NotFoundError when KB not found", async () => {
  KbRepository.findByKey = async () => null;
  try {
    await requireKb(1, "no-such-kb");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof NotFoundError);
    assert.equal(err.status, 404);
    assert.match(err.message, /no-such-kb/);
  } finally {
    KbRepository.findByKey = origFindByKey;
  }
});

test("requireKb propagates repository errors", async () => {
  KbRepository.findByKey = async () => {
    throw new Error("connection refused");
  };
  try {
    await requireKb(1, "kb1");
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.message, "connection refused");
    assert.equal(err instanceof NotFoundError, false);
  } finally {
    KbRepository.findByKey = origFindByKey;
  }
});

// ---- findRunningIngestJob ----

// Manipulate the real standaloneJobs Map — getRunningJobs() reads from it.

test("findRunningIngestJob returns matching job", () => {
  standaloneJobs.clear();
  standaloneJobs.set("ingest:acme:kb1", {
    jobId: "ingest",
    companyName: "acme",
    kbKey: "kb1",
    status: "running",
    progress: {},
  });
  standaloneJobs.set("ingest:acme:kb2", {
    jobId: "ingest",
    companyName: "acme",
    kbKey: "kb2",
    status: "running",
    progress: {},
  });
  standaloneJobs.set("cron:acme", {
    jobId: "cron",
    companyName: "acme",
    kbKey: null,
    status: "running",
    progress: {},
  });
  try {
    const job = findRunningIngestJob("acme", "kb1");
    assert.equal(job.jobId, "ingest");
    assert.equal(job.kbKey, "kb1");
  } finally {
    standaloneJobs.clear();
  }
});

test("findRunningIngestJob returns null when no matching job", () => {
  standaloneJobs.clear();
  standaloneJobs.set("ingest:acme:kb2", {
    jobId: "ingest",
    companyName: "acme",
    kbKey: "kb2",
    status: "running",
    progress: {},
  });
  try {
    assert.equal(findRunningIngestJob("acme", "kb1"), null);
  } finally {
    standaloneJobs.clear();
  }
});

test("findRunningIngestJob returns null when no jobs running", () => {
  standaloneJobs.clear();
  assert.equal(findRunningIngestJob("acme", "kb1"), null);
});

test("findRunningIngestJob ignores completed jobs", () => {
  standaloneJobs.clear();
  standaloneJobs.set("ingest:acme:kb1", {
    jobId: "ingest",
    companyName: "acme",
    kbKey: "kb1",
    status: "completed",
    progress: {},
  });
  try {
    assert.equal(findRunningIngestJob("acme", "kb1"), null);
  } finally {
    standaloneJobs.clear();
  }
});

test("findRunningIngestJob matches all three fields (jobId + company + kbKey)", () => {
  standaloneJobs.clear();
  // Same jobId + kbKey but different company
  standaloneJobs.set("ingest:beta:kb1", {
    jobId: "ingest",
    companyName: "beta",
    kbKey: "kb1",
    status: "running",
    progress: {},
  });
  // The correct match
  standaloneJobs.set("ingest:acme:kb1", {
    jobId: "ingest",
    companyName: "acme",
    kbKey: "kb1",
    status: "running",
    progress: {},
  });
  try {
    const result = findRunningIngestJob("acme", "kb1");
    assert.equal(result.jobId, "ingest");
    assert.equal(result.companyName, "acme");
    assert.equal(result.kbKey, "kb1");
  } finally {
    standaloneJobs.clear();
  }
});

test("findRunningIngestJob returns null for different company", () => {
  standaloneJobs.clear();
  standaloneJobs.set("ingest:beta:kb1", {
    jobId: "ingest",
    companyName: "beta",
    kbKey: "kb1",
    status: "running",
    progress: {},
  });
  try {
    assert.equal(findRunningIngestJob("acme", "kb1"), null);
  } finally {
    standaloneJobs.clear();
  }
});
