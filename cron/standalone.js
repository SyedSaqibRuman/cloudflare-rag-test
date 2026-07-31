import JOBS from "../jobs.js";
import {
  standaloneJobs,
  MAX_CONCURRENT_JOBS,
  jobKey,
  jobKeyDisplay,
} from "./state.js";

// --------------------------
// START JOB
// --------------------------
export async function startJob(jobId, companyName) {
  if (!JOBS[jobId]) {
    return { success: false, message: `Job '${jobId}' not found.` };
  }

  const key = jobKey(jobId, companyName);

  if (standaloneJobs.has(key)) {
    const existing = standaloneJobs.get(key);
    if (existing.status === "running") {
      return {
        success: false,
        message: `Job '${jobKeyDisplay(key)}' is already running. Stop it first.`,
      };
    }
  }

  if (standaloneJobs.size >= MAX_CONCURRENT_JOBS) {
    const running = [...standaloneJobs.values()].filter(
      (j) => j.status === "running"
    );
    return {
      success: false,
      message: `Max concurrent jobs (${MAX_CONCURRENT_JOBS}) reached. Stop a running job first.`,
      running: running.map((j) => ({
        jobId: j.jobId,
        companyName: j.companyName,
      })),
    };
  }

  const job = JOBS[jobId];
  const abortController = new AbortController();

  const state = {
    jobId,
    companyName: companyName || null,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    duration: null,
    error: null,
    abortController,
  };

  standaloneJobs.set(key, state);

  console.log(`▶ Standalone job started: ${jobKeyDisplay(key)}`);

  const start = performance.now();

  // Run in background — do not await here so API responds immediately
  (async () => {
    try {
      await job.handler({
        signal: abortController.signal,
        companyName,
      });

      if (state.status !== "stopped") {
        state.status = "completed";
      }

      console.log(`✅ Standalone job completed: ${jobKeyDisplay(key)}`);
    } catch (err) {
      if (state.status !== "stopped") {
        state.status = "failed";
        state.error = err.message;
      }

      console.error(
        `❌ Standalone job failed: ${jobKeyDisplay(key)}`,
        err.message
      );
    } finally {
      state.completedAt = new Date().toISOString();
      state.duration = +(performance.now() - start).toFixed(2);
      state.abortController = null;
      // Clean up completed/failed/stopped entries so they don't count toward the concurrency limit
      standaloneJobs.delete(key);
    }
  })();

  const response = {
    success: true,
    message: `Job '${jobKeyDisplay(key)}' started.`,
    jobId,
    startedAt: state.startedAt,
  };
  if (companyName) response.companyName = companyName;
  return response;
}

// --------------------------
// STOP JOB
// --------------------------
export function stopJob(jobId, companyName) {
  const key = jobKey(jobId, companyName);

  if (!standaloneJobs.has(key)) {
    // If no specific key given, try to stop the first running job
    if (!jobId) {
      const running = [...standaloneJobs.entries()].find(
        ([, s]) => s.status === "running"
      );
      if (running) {
        const [runningKey, state] = running;
        state.abortController?.abort();
        state.status = "stopped";
        state.completedAt = new Date().toISOString();
        console.log(`🛑 Standalone job stopped: ${jobKeyDisplay(runningKey)}`);
        return {
          success: true,
          message: `Job '${jobKeyDisplay(runningKey)}' stopped.`,
          jobId: state.jobId,
          companyName: state.companyName,
        };
      }
      return { success: false, message: "No job is currently running." };
    }
    return {
      success: false,
      message: `Job '${jobKeyDisplay(key)}' not found or not running.`,
    };
  }

  const state = standaloneJobs.get(key);
  if (state.status !== "running") {
    return {
      success: false,
      message: `Job '${jobKeyDisplay(key)}' is not running (status: ${state.status}).`,
    };
  }

  state.abortController?.abort();
  state.status = "stopped";
  state.completedAt = new Date().toISOString();

  console.log(`🛑 Standalone job stopped: ${jobKeyDisplay(key)}`);

  return {
    success: true,
    message: `Job '${jobKeyDisplay(key)}' stopped.`,
    jobId: state.jobId,
    companyName: state.companyName,
  };
}

// --------------------------
// LIST RUNNING
// --------------------------
export function getRunningJobs() {
  const jobs = [];
  for (const [, state] of standaloneJobs) {
    if (state.status === "running") {
      jobs.push({
        jobId: state.jobId,
        companyName: state.companyName,
        status: state.status,
        startedAt: state.startedAt,
      });
    }
  }
  return jobs;
}
