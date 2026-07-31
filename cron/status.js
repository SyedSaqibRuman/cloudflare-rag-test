import JOBS from "../jobs.js";
import { standaloneJobs, cronSchedulers } from "./state.js";
import { getRunningJobs } from "./standalone.js";

// --------------------------
// LIST ALL JOBS
// --------------------------
export function getJobs() {
  return Object.values(JOBS).map((job) => ({
    id: job.id,
    name: job.name,
    description: job.description ?? "",
  }));
}

// --------------------------
// STATUS
// Returns all active jobs (standalone + cron)
// --------------------------
export function getStatus() {
  const runningJobs = getRunningJobs();
  const scheduledCrons = [...cronSchedulers.entries()]
    .filter(([, s]) => s.status === "scheduled")
    .map(([key, s]) => _cronStatus(key, s));

  if (runningJobs.length > 0 || scheduledCrons.length > 0) {
    return {
      success: true,
      mode: "active",
      standalone: runningJobs,
      cron: scheduledCrons,
    };
  }

  // Nothing executing — return a summary
  const recentStandalone = [...standaloneJobs.entries()]
    .slice(-5)
    .map(([key, s]) => _standaloneStatus(key, s));
  const recentCron = [...cronSchedulers.entries()]
    .slice(-5)
    .map(([key, s]) => _cronStatus(key, s));

  return {
    success: true,
    mode: "idle",
    standalone: recentStandalone,
    cron: recentCron,
    jobs: getJobs(),
  };
}

function _standaloneStatus(key, state) {
  return {
    key,
    jobId: state.jobId,
    companyName: state.companyName || null,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    duration: state.duration ? `${state.duration}ms` : null,
    error: state.error,
  };
}

function _cronStatus(key, state) {
  return {
    key,
    jobId: state.jobId,
    companyName: state.companyName || null,
    status: state.status,
    schedule: state.schedule,
    startedAt: state.startedAt,
    lastRun: state.lastRun,
    lastError: state.lastError,
    runCount: state.runCount,
    lastDuration: state.lastDuration ? `${state.lastDuration}ms` : null,
    avgDuration:
      state.runCount > 0
        ? `${(state.totalDuration / state.runCount).toFixed(2)}ms`
        : null,
  };
}
