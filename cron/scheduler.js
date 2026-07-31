import cron from "node-cron";
import JOBS from "../jobs.js";
import {
  cronSchedulers,
  MAX_CONCURRENT_JOBS,
  jobKey,
  jobKeyDisplay,
} from "./state.js";

// --------------------------
// START SCHEDULER
// --------------------------
export function startCron(jobId, schedule, companyName) {
  if (!JOBS[jobId]) {
    return { success: false, message: `Job '${jobId}' not found.` };
  }

  if (!cron.validate(schedule)) {
    return { success: false, message: "Invalid cron expression." };
  }

  const key = jobKey(jobId, companyName);

  if (cronSchedulers.has(key)) {
    const existing = cronSchedulers.get(key);
    if (existing.status === "scheduled") {
      return {
        success: false,
        message: `Scheduler for '${jobKeyDisplay(key)}' is already running. Stop it first.`,
      };
    }
  }

  if (cronSchedulers.size >= MAX_CONCURRENT_JOBS) {
    return {
      success: false,
      message: `Max concurrent cron schedules (${MAX_CONCURRENT_JOBS}) reached. Stop one first.`,
    };
  }

  const job = JOBS[jobId];
  const abortController = new AbortController();

  const state = {
    jobId,
    companyName: companyName || null,
    schedule,
    task: null,
    status: "scheduled",
    startedAt: new Date().toISOString(),
    lastRun: null,
    lastError: null,
    runCount: 0,
    lastDuration: null,
    totalDuration: 0,
    abortController,
  };

  state.task = cron.schedule(schedule, async () => {
    if (state.tickRunning) {
      console.log(`⏭️ Skipping overlapping tick: ${jobKeyDisplay(key)}`);
      return;
    }

    state.tickRunning = true;
    const start = performance.now();
    state.lastRun = new Date().toISOString();
    state.runCount++;

    try {
      console.log(`⏰ Cron tick: ${jobKeyDisplay(key)}`);
      await job.handler({ signal: abortController.signal, companyName });
      state.lastError = null;
      console.log(`✅ Cron job completed: ${jobKeyDisplay(key)}`);
    } catch (err) {
      state.lastError = err.message;
      console.error(`❌ Cron job failed: ${jobKeyDisplay(key)}`, err.message);
    } finally {
      state.lastDuration = +(performance.now() - start).toFixed(2);
      state.totalDuration += state.lastDuration;
      state.tickRunning = false;
    }
  });

  cronSchedulers.set(key, state);

  console.log(`✅ Cron scheduled: ${jobKeyDisplay(key)} [${schedule}]`);

  const response = {
    success: true,
    message: `Cron scheduled for '${jobKeyDisplay(key)}'.`,
    jobId,
    schedule,
  };
  if (companyName) response.companyName = companyName;
  return response;
}

// --------------------------
// STOP SCHEDULER
// --------------------------
export function stopCron(jobId, companyName) {
  const key = jobKey(jobId, companyName);

  if (!cronSchedulers.has(key)) {
    // If no specific key given, try to stop the first scheduled cron
    if (!jobId) {
      const scheduled = [...cronSchedulers.entries()].find(
        ([, s]) => s.status === "scheduled"
      );
      if (scheduled) {
        const [runningKey, state] = scheduled;
        state.abortController?.abort();
        state.task?.stop();
        state.task = null;
        state.status = "stopped";
        cronSchedulers.delete(runningKey);

        console.log(`🛑 Cron stopped: ${jobKeyDisplay(runningKey)}`);
        return {
          success: true,
          message: `Cron stopped for '${jobKeyDisplay(runningKey)}'.`,
          jobId: state.jobId,
          companyName: state.companyName,
        };
      }
      return { success: false, message: "No cron scheduler is running." };
    }
    return {
      success: false,
      message: `Scheduler for '${jobKeyDisplay(key)}' not found or not running.`,
    };
  }

  const state = cronSchedulers.get(key);
  if (state.status !== "scheduled") {
    return {
      success: false,
      message: `Scheduler for '${jobKeyDisplay(key)}' is not scheduled (status: ${state.status}).`,
    };
  }

  state.abortController?.abort();
  state.task?.stop();
  state.task = null;
  state.status = "stopped";
  cronSchedulers.delete(key);

  console.log(`🛑 Cron stopped: ${jobKeyDisplay(key)}`);

  return {
    success: true,
    message: `Cron stopped for '${jobKeyDisplay(key)}'.`,
    jobId: state.jobId,
    companyName: state.companyName,
  };
}
