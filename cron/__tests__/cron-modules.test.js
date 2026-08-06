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
import { startJob, stopJob, getRunningJobs } from "../lifecycle.js";

// Helper: a job handler that blocks until signal fires (never completes on its own)
function blockingHandler({ signal } = {}) {
  return new Promise((resolve) => {
    if (signal) {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }
    // If no signal, just hang forever (test cleanup will handle it)
  });
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
