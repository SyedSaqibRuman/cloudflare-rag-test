import cron from "node-cron";
import JOBS from "../jobs.js";

// --------------------------
// JOB LIFECYCLE
// One machine for both execution modes — on-demand standalone jobs and cron
// schedules. Key guards, concurrency, abort, status strings, and the status
// query interface all live here; cron/index.js is the only import surface.
// --------------------------

export const MAX_CONCURRENT_JOBS = 6;

// Map<jobCompanyKey, jobState> — allows multiple concurrent jobs/schedules.
export const standaloneJobs = new Map();
export const cronSchedulers = new Map();

// --------------------------
// KEY HELPERS
// --------------------------
export function jobKey(jobId, companyName, kbKey = null) {
  return `${jobId}:${companyName || "_default"}${kbKey ? `:${kbKey}` : ""}`;
}

export function jobKeyDisplay(key) {
  const parts = key.split(":");
  const [jobId, company] = parts;
  const kbKey = parts[2] || null;
  let display = company === "_default" ? jobId : `${jobId} [company: ${company}]`;
  if (kbKey) display += ` [kb: ${kbKey}]`;
  return display;
}

function jobExists(jobId) {
  return !!JOBS[jobId];
}

// --------------------------
// SHARED GUARDS
// The lifecycle strings live here, per execution mode, so the two adapters
// cannot drift. A guard returns a denial response or null (start may proceed).
// --------------------------
const KINDS = {
  standalone: {
    runningStatus: "running",
    includeRunning: true, // denial response lists running jobs
    deleteOnStop: false, // the background runner cleans up its own entry
    cleanup: null,
    logStopped: "Standalone job stopped",
    alreadyRunning: (key) => `Job '${jobKeyDisplay(key)}' is already running. Stop it first.`,
    maxConcurrent: (n) => `Max concurrent jobs (${n}) reached. Stop a running job first.`,
    stopped: (key) => `Job '${jobKeyDisplay(key)}' stopped.`,
    notFound: (key) => `Job '${jobKeyDisplay(key)}' not found or not running.`,
    notRunning: (key, status) => `Job '${jobKeyDisplay(key)}' is not running (status: ${status}).`,
    noneRunning: () => "No job is currently running.",
  },
  cron: {
    runningStatus: "scheduled",
    includeRunning: false,
    deleteOnStop: true,
    cleanup: (state) => {
      state.task?.stop();
      state.task = null;
    },
    logStopped: "Cron stopped",
    alreadyRunning: (key) => `Scheduler for '${jobKeyDisplay(key)}' is already running. Stop it first.`,
    maxConcurrent: (n) => `Max concurrent cron schedules (${n}) reached. Stop one first.`,
    stopped: (key) => `Cron stopped for '${jobKeyDisplay(key)}'.`,
    notFound: (key) => `Scheduler for '${jobKeyDisplay(key)}' not found or not running.`,
    notRunning: (key, status) => `Scheduler for '${jobKeyDisplay(key)}' is not scheduled (status: ${status}).`,
    noneRunning: () => "No cron scheduler is running.",
  },
};

function guardStart(map, key, kind) {
  const existing = map.get(key);
  if (existing && existing.status === kind.runningStatus) {
    return { success: false, message: kind.alreadyRunning(key) };
  }
  if (map.size >= MAX_CONCURRENT_JOBS) {
    const response = { success: false, message: kind.maxConcurrent(MAX_CONCURRENT_JOBS) };
    if (kind.includeRunning) {
      response.running = [...map.values()]
        .filter((j) => j.status === kind.runningStatus)
        .map((j) => ({ jobId: j.jobId, companyName: j.companyName }));
    }
    return response;
  }
  return null;
}

// Returns { ok, key, state } or a denial response.
function guardStop(map, key, jobId, kind) {
  if (map.has(key)) {
    const state = map.get(key);
    if (state.status !== kind.runningStatus) {
      return { success: false, message: kind.notRunning(key, state.status) };
    }
    return { ok: true, key, state };
  }
  if (!jobId) {
    const [runningKey, state] =
      [...map.entries()].find(([, s]) => s.status === kind.runningStatus) || [];
    if (runningKey) return { ok: true, key: runningKey, state };
    return { success: false, message: kind.noneRunning() };
  }
  return { success: false, message: kind.notFound(key) };
}

function applyStop(map, key, state, kind) {
  state.abortController?.abort();
  state.status = "stopped";
  state.completedAt = new Date().toISOString();
  if (kind.cleanup) kind.cleanup(state);
  if (kind.deleteOnStop) map.delete(key);
  console.log(`🛑 ${kind.logStopped}: ${jobKeyDisplay(key)}`);
  return {
    success: true,
    message: kind.stopped(key),
    jobId: state.jobId,
    companyName: state.companyName,
    kbKey: state.kbKey ?? null,
  };
}

// --------------------------
// STANDALONE JOBS (on-demand)
// --------------------------
export async function startJob(jobId, companyName, opts = {}) {
  if (!jobExists(jobId)) {
    return { success: false, message: `Job '${jobId}' not found.` };
  }

  const key = jobKey(jobId, companyName, opts.kbKey);
  const denied = guardStart(standaloneJobs, key, KINDS.standalone);
  if (denied) return denied;

  const job = JOBS[jobId];
  const abortController = new AbortController();

  const state = {
    jobId,
    companyName: companyName || null,
    kbKey: opts.kbKey || null,
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

  // Run in background — do not await here so the API responds immediately.
  (async () => {
    try {
      await job.handler({
        signal: abortController.signal,
        companyName,
        ...opts,
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

      console.error(`❌ Standalone job failed: ${jobKeyDisplay(key)}`, err.message);
    } finally {
      state.completedAt = new Date().toISOString();
      state.duration = +(performance.now() - start).toFixed(2);
      state.abortController = null;
      // Clean up finished entries so they don't count toward the concurrency limit.
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
  if (opts.kbKey) response.kbKey = opts.kbKey;
  return response;
}

export function stopJob(jobId, companyName, kbKey = null) {
  const key = jobKey(jobId, companyName, kbKey);
  const result = guardStop(standaloneJobs, key, jobId, KINDS.standalone);
  if (result.success === false) return result;
  return applyStop(standaloneJobs, result.key, result.state, KINDS.standalone);
}

export function getRunningJobs() {
  const jobs = [];
  for (const [, state] of standaloneJobs) {
    if (state.status === "running") {
      jobs.push({
        jobId: state.jobId,
        companyName: state.companyName,
        kbKey: state.kbKey ?? null,
        status: state.status,
        startedAt: state.startedAt,
      });
    }
  }
  return jobs;
}

// --------------------------
// CRON SCHEDULES
// --------------------------
export function startCron(jobId, schedule, companyName) {
  if (!jobExists(jobId)) {
    return { success: false, message: `Job '${jobId}' not found.` };
  }

  if (!cron.validate(schedule)) {
    return { success: false, message: "Invalid cron expression." };
  }

  const key = jobKey(jobId, companyName);
  const denied = guardStart(cronSchedulers, key, KINDS.cron);
  if (denied) return denied;

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

export function stopCron(jobId, companyName) {
  const key = jobKey(jobId, companyName);
  const result = guardStop(cronSchedulers, key, jobId, KINDS.cron);
  if (result.success === false) return result;
  return applyStop(cronSchedulers, result.key, result.state, KINDS.cron);
}

// --------------------------
// STATUS (one query interface)
// --------------------------
export function getJobs() {
  return Object.values(JOBS).map((job) => ({
    id: job.id,
    name: job.name,
    description: job.description ?? "",
  }));
}

function standaloneStatus(key, state) {
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

function cronStatus(key, state) {
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
      state.runCount > 0 ? `${(state.totalDuration / state.runCount).toFixed(2)}ms` : null,
  };
}

export function getStatus() {
  const runningJobs = getRunningJobs();
  const scheduledCrons = [...cronSchedulers.entries()]
    .filter(([, s]) => s.status === "scheduled")
    .map(([key, s]) => cronStatus(key, s));

  if (runningJobs.length > 0 || scheduledCrons.length > 0) {
    return {
      success: true,
      mode: "active",
      standalone: runningJobs,
      cron: scheduledCrons,
    };
  }

  // Idle: nothing running or scheduled. Finished entries are deleted from the
  // maps on completion, so there is no recent history to report — return the
  // job catalog instead of pretending otherwise.
  return {
    success: true,
    mode: "idle",
    standalone: [],
    cron: [],
    jobs: getJobs(),
  };
}
