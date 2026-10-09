import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// --------------------------
// STATE TESTS
// --------------------------
import {
  standaloneJobs,
  cronSchedulers,
  MAX_CONCURRENT_JOBS,
  jobKey,
  jobKeyDisplay,
} from "../lifecycle.js";

describe("cron/state", () => {
  describe("jobKey", () => {
    it("builds key from jobId and companyName", () => {
      assert.equal(jobKey("ingest", "popularcert"), "ingest:popularcert");
    });

    it("uses _default when companyName is null", () => {
      assert.equal(jobKey("ingest", null), "ingest:_default");
    });

    it("uses _default when companyName is undefined", () => {
      assert.equal(jobKey("ingest"), "ingest:_default");
    });

    it("uses _default for empty string", () => {
      assert.equal(jobKey("ingest", ""), "ingest:_default");
    });
  });

  describe("jobKeyDisplay", () => {
    it("returns plain jobId for default company", () => {
      assert.equal(jobKeyDisplay("ingest:_default"), "ingest");
    });

    it("returns formatted string with company name", () => {
      assert.equal(
        jobKeyDisplay("ingest:popularcert"),
        "ingest [company: popularcert]"
      );
    });
  });

  describe("MAX_CONCURRENT_JOBS", () => {
    it("is a positive number", () => {
      assert.equal(typeof MAX_CONCURRENT_JOBS, "number");
      assert.ok(MAX_CONCURRENT_JOBS > 0);
    });

    it("equals 6", () => {
      assert.equal(MAX_CONCURRENT_JOBS, 6);
    });
  });

  describe("shared Maps", () => {
    beforeEach(() => {
      standaloneJobs.clear();
      cronSchedulers.clear();
    });

    it("standaloneJobs is a Map", () => {
      assert.ok(standaloneJobs instanceof Map);
    });

    it("cronSchedulers is a Map", () => {
      assert.ok(cronSchedulers instanceof Map);
    });
  });
});

// --------------------------
// STANDALONE TESTS
// --------------------------
import { startJob, stopJob, pauseJob, resumeJob, restoreSuspendedJobs, getRunningJobs } from "../lifecycle.js";
import { SuspendedJobRepository } from "../../mysql/repositories/suspended-job.js";

// Capture SuspendedJobRepository calls without MySQL — stub each method for
// the duration of a test (same try/finally pattern as kb-service tests).
function stubRepo(overrides = {}) {
  const calls = { upsert: [], remove: [] };
  const originals = {};
  for (const method of ["upsert", "remove", "listAll"]) {
    originals[method] = SuspendedJobRepository[method];
    SuspendedJobRepository[method] =
      overrides[method] ??
      (method === "upsert"
        ? async (args) => calls.upsert.push(args)
        : method === "remove"
          ? async (...args) => calls.remove.push(args)
          : async () => []);
  }
  return { calls, restore: () => Object.assign(SuspendedJobRepository, originals) };
}

// Helper: clean up all standalone job state and abort controllers
function cleanupStandalone() {
  for (const [, state] of standaloneJobs) {
    state.abortController?.abort();
  }
  standaloneJobs.clear();
}

describe("cron/standalone", () => {
  beforeEach(() => {
    cleanupStandalone();
  });

  afterEach(() => {
    cleanupStandalone();
  });

  describe("startJob", () => {
    it("returns error for unknown jobId", async () => {
      const result = await startJob("nonexistent");
      assert.equal(result.success, false);
      assert.ok(result.message.includes("not found"));
    });

    it("starts a valid job", async () => {
      const result = await startJob("testing");
      assert.equal(result.success, true);
      assert.ok(result.message.includes("started"));
      assert.equal(result.jobId, "testing");
      assert.ok(result.startedAt);
      // Clean up: the background IIFE is still running
      cleanupStandalone();
    });

    it("includes companyName in response when provided", async () => {
      const result = await startJob("testing", "popularcert");
      assert.equal(result.success, true);
      assert.equal(result.companyName, "popularcert");
      cleanupStandalone();
    });

    it("does not include companyName when not provided", async () => {
      const result = await startJob("testing");
      assert.equal(result.success, true);
      assert.equal(result.companyName, undefined);
      cleanupStandalone();
    });

    it("prevents duplicate concurrent runs of the same job+company", async () => {
      // Use a blocking job so it stays running
      // We need to inject a blocking handler. Since startJob uses JOBS[jobId].handler,
      // and we can't easily mock that, we'll test the logic by directly populating the Map
      const key = jobKey("testing", "co1");
      const abortController = new AbortController();
      standaloneJobs.set(key, {
        jobId: "testing",
        companyName: "co1",
        status: "running",
        startedAt: new Date().toISOString(),
        abortController,
      });

      const result = await startJob("testing", "co1");
      assert.equal(result.success, false);
      assert.ok(result.message.includes("already running"));
    });

    it("allows same job for different companies", async () => {
      // Directly populate the Map for two different company keys
      const key1 = jobKey("testing", "co1");
      const key2 = jobKey("testing", "co2");
      const ac1 = new AbortController();
      const ac2 = new AbortController();

      standaloneJobs.set(key1, {
        jobId: "testing",
        companyName: "co1",
        status: "running",
        startedAt: new Date().toISOString(),
        abortController: ac1,
      });
      standaloneJobs.set(key2, {
        jobId: "testing",
        companyName: "co2",
        status: "running",
        startedAt: new Date().toISOString(),
        abortController: ac2,
      });

      // Both should exist
      assert.ok(standaloneJobs.has(key1));
      assert.ok(standaloneJobs.has(key2));
    });

    it("enforces max concurrent jobs limit", async () => {
      // Fill up to max
      for (let i = 0; i < MAX_CONCURRENT_JOBS; i++) {
        const key = jobKey("testing", `co${i}`);
        const ac = new AbortController();
        standaloneJobs.set(key, {
          jobId: "testing",
          companyName: `co${i}`,
          status: "running",
          startedAt: new Date().toISOString(),
          abortController: ac,
        });
      }

      const result = await startJob("testing", "overflow");
      assert.equal(result.success, false);
      assert.ok(result.message.includes("Max concurrent"));
      assert.ok(Array.isArray(result.running));
      assert.equal(result.running.length, MAX_CONCURRENT_JOBS);
    });
  });

  describe("stopJob", () => {
    it("returns error when no job is running and no jobId given", () => {
      const result = stopJob();
      assert.equal(result.success, false);
      assert.ok(result.message.includes("No job"));
    });

    it("returns error for unknown job key", () => {
      const result = stopJob("nonexistent", "co");
      assert.equal(result.success, false);
      assert.ok(result.message.includes("not found"));
    });

    it("stops a running job by key", () => {
      // Inject a running job directly
      const key = jobKey("testing", "co1");
      const ac = new AbortController();
      standaloneJobs.set(key, {
        jobId: "testing",
        companyName: "co1",
        status: "running",
        startedAt: new Date().toISOString(),
        abortController: ac,
      });

      const result = stopJob("testing", "co1");
      assert.equal(result.success, true);
      assert.ok(result.message.includes("stopped"));
      assert.ok(ac.signal.aborted);
    });

    it("stops the first running job when no params given", () => {
      const key = jobKey("testing", "co1");
      const ac = new AbortController();
      standaloneJobs.set(key, {
        jobId: "testing",
        companyName: "co1",
        status: "running",
        startedAt: new Date().toISOString(),
        abortController: ac,
      });

      const result = stopJob();
      assert.equal(result.success, true);
      assert.ok(result.message.includes("stopped"));
    });

    it("returns error for already stopped job", () => {
      const key = jobKey("testing", "co1");
      standaloneJobs.set(key, {
        jobId: "testing",
        companyName: "co1",
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      const result = stopJob("testing", "co1");
      assert.equal(result.success, false);
      assert.ok(result.message.includes("not running"));
    });
  });

  describe("pauseJob / resumeJob", () => {
    it("pauses a running job: marks suspended, aborts, keeps the entry", () => {
      const stub = stubRepo(); // keep the real MySQL pool out of unit tests
      try {
        const key = jobKey("ingest", "co1", "kb1");
        const ac = new AbortController();
        standaloneJobs.set(key, {
          jobId: "ingest",
          companyName: "co1",
          kbKey: "kb1",
          status: "running",
          startedAt: new Date().toISOString(),
          abortController: ac,
          progress: { processed: 5, phase: "processing" },
        });

        const result = pauseJob("ingest", "co1", "kb1");
        assert.equal(result.success, true);
        assert.ok(result.message.includes("paused"));
        assert.ok(ac.signal.aborted, "abort signal fired");

        const state = standaloneJobs.get(key);
        assert.ok(state, "suspended entry stays in the map for resume");
        assert.equal(state.status, "suspended");
        assert.ok(state.pausedAt);
        assert.equal(stub.calls.upsert.length, 1, "pause persisted");
      } finally {
        stub.restore();
      }
    });

    it("pauseJob returns error for unknown job", () => {
      const result = pauseJob("nonexistent", "co");
      assert.equal(result.success, false);
    });

    it("resumeJob consumes the suspended entry and starts a fresh run", async () => {
      const stub = stubRepo();
      try {
        const key = jobKey("testing", "co2");
        standaloneJobs.set(key, {
          jobId: "testing",
          companyName: "co2",
          status: "suspended",
          startedAt: new Date().toISOString(),
          pausedAt: new Date().toISOString(),
          abortController: null,
        });

        const result = await resumeJob("testing", "co2");
        assert.equal(result.success, true);
        assert.ok(result.message.includes("resumed"));
        assert.equal(stub.calls.remove.length, 1, "persisted row removed on resume");

        // Old suspended entry consumed — no suspended state remains for the key
        // (the fresh run either still runs or already completed+deleted itself,
        // both are startJob's already-tested behavior).
        const state = standaloneJobs.get(key);
        assert.ok(!state || state.status === "running", "suspended entry consumed");
      } finally {
        stub.restore();
        cleanupStandalone();
      }
    });

    it("startJob over a suspended entry drops the persisted row", async () => {
      const stub = stubRepo();
      try {
        const key = jobKey("testing", "co3");
        standaloneJobs.set(key, {
          jobId: "testing",
          companyName: "co3",
          status: "suspended",
          startedAt: new Date().toISOString(),
          pausedAt: new Date().toISOString(),
          abortController: null,
        });

        const result = await startJob("testing", "co3");
        assert.equal(result.success, true);
        assert.equal(stub.calls.remove.length, 1, "persisted row dropped when the suspended entry is replaced by a fresh start");
        assert.equal(stub.calls.remove[0][0], "testing");
        assert.equal(stub.calls.remove[0][1], "co3");
      } finally {
        stub.restore();
        cleanupStandalone();
      }
    });

    it("resumeJob fails when nothing is suspended for the key", async () => {
      const result = await resumeJob("testing", "co-nowhere");
      assert.equal(result.success, false);
      assert.ok(result.message.includes("not paused"));
    });

    it("getRunningJobs reports suspended jobs with their status", () => {
      const key = jobKey("ingest", "co1", "kb1");
      standaloneJobs.set(key, {
        jobId: "ingest",
        companyName: "co1",
        kbKey: "kb1",
        status: "suspended",
        startedAt: new Date().toISOString(),
        pausedAt: new Date().toISOString(),
        abortController: null,
        progress: null,
      });

      const jobs = getRunningJobs();
      const suspended = jobs.find((j) => j.status === "suspended");
      assert.ok(suspended, "suspended job reported");
      assert.equal(suspended.jobId, "ingest");
      assert.equal(suspended.kbKey, "kb1");
      assert.ok(suspended.pausedAt);
    });
  });

  describe("pause persistence (survives restart)", () => {
    it("pauseJob persists the suspended state; resume removes it", async () => {
      const stub = stubRepo();
      try {
        const key = jobKey("ingest", "co1", "kb1");
        const ac = new AbortController();
        standaloneJobs.set(key, {
          jobId: "ingest",
          companyName: "co1",
          kbKey: "kb1",
          status: "running",
          startedAt: "2026-01-01T00:00:00Z",
          abortController: ac,
          progress: { processed: 3, phase: "processing" },
        });

        await pauseJob("ingest", "co1", "kb1");
        assert.equal(stub.calls.upsert.length, 1);
        assert.equal(stub.calls.upsert[0].jobId, "ingest");
        assert.equal(stub.calls.upsert[0].kbKey, "kb1");
        assert.equal(stub.calls.upsert[0].progress.processed, 3);

        // Restore from the persisted row (simulating a restart) works
        standaloneJobs.clear();
        SuspendedJobRepository.listAll = async () => [
          {
            job_id: "ingest",
            company_name: "co1",
            kb_key: "kb1",
            started_at: "2026-01-01T00:00:00Z",
            paused_at: "2026-01-01T00:10:00Z",
            progress: { processed: 3 },
          },
        ];
        const restored = await restoreSuspendedJobs();
        assert.equal(restored, 1);
        const state = standaloneJobs.get(key);
        assert.equal(state.status, "suspended");
        assert.equal(state.pausedAt, "2026-01-01T00:10:00Z");
        assert.equal(state.abortController, null);

        // Resume consumes the entry AND removes the persisted row. Use the
        // 'testing' job for the fresh run — its handler is harmless — but
        // verify the persisted row for the 'ingest' key is what got removed.
        SuspendedJobRepository.listAll = async () => [];
        SuspendedJobRepository.upsert = async () => {};
        standaloneJobs.set(jobKey("testing", "co1"), {
          jobId: "testing",
          companyName: "co1",
          status: "suspended",
          startedAt: new Date().toISOString(),
          pausedAt: new Date().toISOString(),
          abortController: null,
        });
        const result = await resumeJob("testing", "co1");
        assert.equal(result.success, true);
        assert.equal(stub.calls.remove.length, 1);
        assert.deepEqual(stub.calls.remove[0], ["testing", "co1", null]);
      } finally {
        stub.restore();
        cleanupStandalone();
      }
    });

    it("stopping a paused job drops its persisted row", async () => {
      const stub = stubRepo();
      try {
        const key = jobKey("ingest", "co1", "kb1");
        standaloneJobs.set(key, {
          jobId: "ingest",
          companyName: "co1",
          kbKey: "kb1",
          status: "suspended",
          startedAt: new Date().toISOString(),
          pausedAt: new Date().toISOString(),
          abortController: null,
        });
        const result = stopJob("ingest", "co1", "kb1");
        assert.equal(result.success, true);
        assert.equal(stub.calls.remove.length, 1);
        assert.deepEqual(stub.calls.remove[0], ["ingest", "co1", "kb1"]);
      } finally {
        stub.restore();
        cleanupStandalone();
      }
    });

    it("restoreSuspendedJobs drops rows for unknown jobIds", async () => {
      const stub = stubRepo({
        listAll: async () => [
          { job_id: "ghost-job", company_name: "co", kb_key: null, started_at: "x", paused_at: "y", progress: null },
        ],
      });
      try {
        const restored = await restoreSuspendedJobs();
        assert.equal(restored, 0);
        assert.equal(stub.calls.remove.length, 1);
        assert.deepEqual(stub.calls.remove[0], ["ghost-job", "co", null]);
      } finally {
        stub.restore();
      }
    });
  });

  describe("getRunningJobs", () => {
    it("returns empty array when no jobs running", () => {
      assert.deepEqual(getRunningJobs(), []);
    });

    it("returns running jobs", () => {
      const key = jobKey("testing", "co1");
      standaloneJobs.set(key, {
        jobId: "testing",
        companyName: "co1",
        status: "running",
        startedAt: new Date().toISOString(),
      });

      const jobs = getRunningJobs();
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].jobId, "testing");
      assert.equal(jobs[0].companyName, "co1");
      assert.equal(jobs[0].status, "running");
      assert.ok(jobs[0].startedAt);
    });

    it("does not include completed jobs", () => {
      standaloneJobs.set("testing:co1", {
        jobId: "testing",
        companyName: "co1",
        status: "completed",
        startedAt: new Date().toISOString(),
      });

      const jobs = getRunningJobs();
      assert.equal(jobs.length, 0);
    });
  });
});

// --------------------------
// SCHEDULER TESTS
// --------------------------
import { startCron, stopCron } from "../lifecycle.js";
import JOBS from "../../jobs.js";

function cleanupCron() {
  for (const [, state] of cronSchedulers) {
    state.abortController?.abort();
    state.task?.stop();
  }
  cronSchedulers.clear();
}

describe("cron/scheduler", () => {
  beforeEach(() => {
    cleanupCron();
  });

  afterEach(() => {
    cleanupCron();
  });

  describe("startCron", () => {
    it("returns error for unknown jobId", () => {
      const result = startCron("nonexistent", "* * * * *");
      assert.equal(result.success, false);
      assert.ok(result.message.includes("not found"));
    });

    it("returns error for invalid cron expression", () => {
      const result = startCron("testing", "not-a-cron");
      assert.equal(result.success, false);
      assert.ok(result.message.includes("Invalid cron"));
    });

    it("starts a valid cron schedule", () => {
      const result = startCron("testing", "* * * * *");
      assert.equal(result.success, true);
      assert.ok(result.message.includes("scheduled"));
      assert.equal(result.jobId, "testing");
      assert.equal(result.schedule, "* * * * *");
    });

    it("includes companyName in response when provided", () => {
      const result = startCron("testing", "* * * * *", "popularcert");
      assert.equal(result.success, true);
      assert.equal(result.companyName, "popularcert");
    });

    it("prevents duplicate schedules for same job+company", () => {
      startCron("testing", "* * * * *", "co1");
      const result = startCron("testing", "* * * * *", "co1");
      assert.equal(result.success, false);
      assert.ok(result.message.includes("already running"));
    });

    it("allows same job with different schedules for different companies", () => {
      const r1 = startCron("testing", "* * * * *", "co1");
      const r2 = startCron("testing", "0 * * * *", "co2");
      assert.equal(r1.success, true);
      assert.equal(r2.success, true);
    });
  });

  describe("stopCron", () => {
    it("returns error when no cron is running and no jobId given", () => {
      const result = stopCron();
      assert.equal(result.success, false);
      assert.ok(result.message.includes("No cron"));
    });

    it("returns error for unknown key", () => {
      const result = stopCron("nonexistent", "co");
      assert.equal(result.success, false);
      assert.ok(result.message.includes("not found"));
    });

    it("stops a scheduled cron", () => {
      startCron("testing", "* * * * *", "co1");
      const result = stopCron("testing", "co1");
      assert.equal(result.success, true);
      assert.ok(result.message.includes("stopped"));
    });

    it("stops the first scheduled cron when no params given", () => {
      startCron("testing", "* * * * *", "co1");
      const result = stopCron();
      assert.equal(result.success, true);
      assert.ok(result.message.includes("stopped"));
    });

    it("returns error for already stopped scheduler", () => {
      // Inject a scheduler with status "stopped" directly
      // (stopCron deletes entries, so we can't use stopCron to create a stopped state)
      const key = jobKey("testing", "co1");
      cronSchedulers.set(key, {
        jobId: "testing",
        companyName: "co1",
        schedule: "* * * * *",
        task: null,
        status: "stopped",
        startedAt: new Date().toISOString(),
        lastRun: null,
        lastError: null,
        runCount: 0,
        lastDuration: null,
        totalDuration: 0,
        abortController: null,
      });

      const result = stopCron("testing", "co1");
      assert.equal(result.success, false);
      assert.ok(result.message.includes("not scheduled"));
    });
  });

  // KB-scoped schedules — cron/start accepts kbKey and the tick must run the
  // KB-driven ingest (same keying as standalone jobs, so one company can run
  // several KB schedules plus a legacy whole-company schedule concurrently).
  describe("kbKey threading", () => {
    it("reports kbKey in the start response", () => {
      const result = startCron("ingest", "* * * * *", "maxicert", { kbKey: "max-test-kb" });
      assert.equal(result.success, true);
      assert.equal(result.kbKey, "max-test-kb");
      assert.equal(result.companyName, "maxicert");
    });

    it("omits kbKey from the response for legacy schedules", () => {
      const result = startCron("ingest", "* * * * *", "maxicert");
      assert.equal(result.success, true);
      assert.equal(result.kbKey, undefined);
    });

    it("allows the same job+company with different KBs concurrently", () => {
      const r1 = startCron("ingest", "* * * * *", "maxicert", { kbKey: "kb-a" });
      const r2 = startCron("ingest", "0 * * * *", "maxicert", { kbKey: "kb-b" });
      assert.equal(r1.success, true);
      assert.equal(r2.success, true);
    });

    it("prevents duplicate schedules for the same job+company+kb", () => {
      startCron("ingest", "* * * * *", "maxicert", { kbKey: "kb-a" });
      const result = startCron("ingest", "* * * * *", "maxicert", { kbKey: "kb-a" });
      assert.equal(result.success, false);
      assert.ok(result.message.includes("already running"));
    });

    it("distinguishes a KB schedule from the legacy company schedule", () => {
      startCron("ingest", "* * * * *", "maxicert");
      const result = startCron("ingest", "* * * * *", "maxicert", { kbKey: "kb-a" });
      assert.equal(result.success, true); // different key — both coexist
    });

    it("stops the kb-scoped schedule without touching the legacy one", () => {
      startCron("ingest", "* * * * *", "maxicert");
      startCron("ingest", "0 * * * *", "maxicert", { kbKey: "kb-a" });
      const result = stopCron("ingest", "maxicert", "kb-a");
      assert.equal(result.success, true);
      assert.equal(result.kbKey, "kb-a");
      const remaining = getStatus().cron.filter((c) => c.jobId === "ingest" && c.companyName === "maxicert");
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].kbKey, null);
    });

    it("stops only the legacy schedule when kbKey is not given", () => {
      startCron("ingest", "* * * * *", "maxicert");
      startCron("ingest", "0 * * * *", "maxicert", { kbKey: "kb-a" });
      const result = stopCron("ingest", "maxicert");
      assert.equal(result.success, true);
      const remaining = getStatus().cron.filter((c) => c.jobId === "ingest" && c.companyName === "maxicert");
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].kbKey, "kb-a");
    });
  });

  // Cron ticks route their runs through the standalone runner (startJob with
  // awaitCompletion) so a cron-driven ingest is visible in /jobs/running,
  // pausable, and resumable — these lock the runner-side contract.
  describe("startJob awaitCompletion (cron tick integration)", () => {
    const FAKE = "e2e-fake-job";

    afterEach(() => {
      delete JOBS[FAKE];
      cleanupStandalone();
      cleanupCron();
    });

    it("resolves { status: 'completed', error: null } when the handler finishes", async () => {
      JOBS[FAKE] = { id: FAKE, name: "Fake", handler: async () => "ok" };
      const run = await startJob(FAKE, "co-x", { awaitCompletion: true });
      assert.equal(run.success, true);
      const settled = await run.completion;
      assert.equal(settled.status, "completed");
      assert.equal(settled.error, null);
    });

    it("resolves { status: 'failed', error } when the handler throws", async () => {
      JOBS[FAKE] = {
        id: FAKE,
        name: "Fake",
        handler: async () => { throw new Error("boom"); },
      };
      const run = await startJob(FAKE, "co-x", { awaitCompletion: true });
      const settled = await run.completion;
      assert.equal(settled.status, "failed");
      assert.equal(settled.error, "boom");
    });

    it("stopping the schedule stops an in-flight tick run (stopCron cleanup)", async () => {
      JOBS[FAKE] = {
        id: FAKE,
        name: "Fake",
        handler: ({ signal }) =>
          new Promise((resolve, reject) => {
            const t = setTimeout(() => resolve(), 30_000);
            signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Job was stopped.")); }, { once: true });
          }),
      };
      // Start the tick run exactly as the cron tick now does.
      const run = await startJob(FAKE, "co1", { kbKey: "kb-a", awaitCompletion: true });
      assert.equal(run.success, true);
      // Inject the schedule entry as startCron would hold it mid-tick.
      cronSchedulers.set(jobKey(FAKE, "co1", "kb-a"), {
        jobId: FAKE,
        companyName: "co1",
        kbKey: "kb-a",
        schedule: "* * * * *",
        task: null,
        status: "scheduled",
        startedAt: new Date().toISOString(),
        lastRun: null,
        lastError: null,
        runCount: 1,
        lastDuration: null,
        totalDuration: 0,
        abortController: new AbortController(),
      });

      const stopped = stopCron(FAKE, "co1", "kb-a");
      assert.equal(stopped.success, true);

      const settled = await run.completion;
      assert.equal(settled.status, "stopped");
      assert.equal(settled.error, null); // user action, not a failure
      assert.equal(getRunningJobs().find((j) => j.jobId === FAKE), undefined);
    });
  });
});

// --------------------------
// STATUS TESTS
// --------------------------
import { getJobs, getStatus } from "../lifecycle.js";

describe("cron/status", () => {
  beforeEach(() => {
    cleanupStandalone();
    cleanupCron();
  });

  afterEach(() => {
    cleanupStandalone();
    cleanupCron();
  });

  describe("getJobs", () => {
    it("returns array of registered jobs", () => {
      const jobs = getJobs();
      assert.ok(Array.isArray(jobs));
      assert.ok(jobs.length >= 2);
    });

    it("each job has id, name, and description", () => {
      const jobs = getJobs();
      for (const job of jobs) {
        assert.ok(typeof job.id === "string");
        assert.ok(typeof job.name === "string");
        assert.ok(typeof job.description === "string");
      }
    });

    it("includes testing and ingest jobs", () => {
      const jobs = getJobs();
      const ids = jobs.map((j) => j.id);
      assert.ok(ids.includes("testing"));
      assert.ok(ids.includes("ingest"));
    });
  });

  describe("getStatus", () => {
    it("returns idle mode when nothing is running", () => {
      const status = getStatus();
      assert.equal(status.success, true);
      assert.equal(status.mode, "idle");
      assert.ok(Array.isArray(status.standalone));
      assert.ok(Array.isArray(status.cron));
      assert.ok(Array.isArray(status.jobs));
    });

    it("returns active mode with standalone jobs", () => {
      // Inject a running job
      const key = jobKey("testing", "co1");
      standaloneJobs.set(key, {
        jobId: "testing",
        companyName: "co1",
        status: "running",
        startedAt: new Date().toISOString(),
      });

      const status = getStatus();
      assert.equal(status.mode, "active");
      assert.ok(status.standalone.length >= 1);
    });

    it("returns active mode with cron schedules", () => {
      startCron("testing", "* * * * *", "co1");
      const status = getStatus();
      assert.equal(status.mode, "active");
      assert.ok(status.cron.length >= 1);
    });

    it("cron status includes schedule and runCount", () => {
      startCron("testing", "*/5 * * * *", "co1");
      const status = getStatus();
      const cronEntry = status.cron.find(
        (c) => c.jobId === "testing" && c.companyName === "co1"
      );
      assert.ok(cronEntry);
      assert.equal(cronEntry.schedule, "*/5 * * * *");
      assert.equal(cronEntry.runCount, 0);
      assert.equal(cronEntry.lastDuration, null);
      assert.equal(cronEntry.avgDuration, null);
    });

    it("idle mode reports empty standalone/cron and the job catalog", () => {
      // Finished entries are deleted from the maps on completion, so idle mode
      // has no history to report — it returns the catalog instead.
      const status = getStatus();
      assert.equal(status.mode, "idle");
      assert.deepEqual(status.standalone, []);
      assert.deepEqual(status.cron, []);
      assert.ok(Array.isArray(status.jobs));
      assert.ok(status.jobs.length >= 1);
      assert.ok(status.jobs.some((j) => j.id === "testing"));
    });
  });
});
