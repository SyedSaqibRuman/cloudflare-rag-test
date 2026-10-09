import cron from "node-cron";
import JOBS from "../jobs.js";
import { SuspendedJobRepository } from "../mysql/repositories/suspended-job.js";
import { logToFile } from "../utils/logger.js";

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
    paused: (key) => `Job '${jobKeyDisplay(key)}' paused. Completed documents are checkpointed; resume to continue.`,
    notSuspended: (key) => `Job '${jobKeyDisplay(key)}' is not paused.`,
  },
  cron: {
    runningStatus: "scheduled",
    includeRunning: false,
    deleteOnStop: true,
    cleanup: (state) => {
      state.task?.stop();
      state.task = null;
      // The tick run is a standalone job (the cron routes ticks through the
      // runner) with its OWN AbortController — stopping the schedule must
      // stop the in-flight run too, exactly like stopCron did when the tick
      // shared the schedule-level controller.
      try { stopJob(state.jobId, state.companyName, state.kbKey ?? null); } catch { /* run already gone */ }
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
// Accepts jobs in `runningStatus` OR `suspended` (stop/pause both target
// live runs; stopping a paused job must also work — it drops the entry).
function guardStop(map, key, jobId, kind) {
  if (map.has(key)) {
    const state = map.get(key);
    if (state.status !== kind.runningStatus && state.status !== "suspended") {
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

  // A fresh start REPLACING a suspended (paused) entry drops its persisted
  // row — the new run owns this job key now, and a leftover row would
  // resurrect the stale pause after a restart.
  const replaced = standaloneJobs.get(key);
  if (replaced?.status === "suspended") {
    SuspendedJobRepository.remove(jobId, replaced.companyName ?? null, replaced.kbKey ?? null);
  }

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
    progress: null, // { processed, skipped, chunks, discovered, phase }
  };

  standaloneJobs.set(key, state);

  console.log(`▶ Standalone job started: ${jobKeyDisplay(key)}`);

  const start = performance.now();

  // Optional completion handle: cron ticks route their runs through this
  // runner and await settlement to feed the schedule's stats — without
  // changing the response contract for HTTP callers (completion is only
  // present when opts.awaitCompletion is set).
  let resolveCompletion = null;
  const completion = opts.awaitCompletion
    ? new Promise((resolve) => { resolveCompletion = resolve; })
    : null;

  // Run in background — do not await here so the API responds immediately.
  (async () => {
    try {
      await job.handler({
        signal: abortController.signal,
        companyName,
        ...opts,
        setProgress: (p) => { state.progress = p; },
      });

      // "stopped" (explicit stop) and "suspended" (pause) own the status —
      // never overwrite them with "completed" when the handler exits via abort.
      if (state.status !== "stopped" && state.status !== "suspended") {
        state.status = "completed";
      }

      console.log(`✅ Standalone job completed: ${jobKeyDisplay(key)}`);
    } catch (err) {
      if (state.status !== "stopped" && state.status !== "suspended") {
        state.status = "failed";
        state.error = err.message;
      }

      console.error(`❌ Standalone job failed: ${jobKeyDisplay(key)}`, err.message);
    } finally {
      state.completedAt = new Date().toISOString();
      state.duration = +(performance.now() - start).toFixed(2);
      state.abortController = null;
      // Clean up finished entries so they don't count toward the concurrency limit.
      // Guard the delete: a NEWER run for the same key may have replaced this
      // entry while this (possibly stopped/wedged) run was still settling —
      // deleting unconditionally would untrack the newer run (it would keep
      // executing but vanish from /jobs/running and become unstoppable).
      // A SUSPENDED (paused) entry is kept — resumeJob consumes it.
      if (standaloneJobs.get(key) === state && state.status !== "suspended") {
        standaloneJobs.delete(key);
      }
      resolveCompletion?.({ status: state.status, error: state.error, durationMs: state.duration });
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
  if (completion) response.completion = completion;
  return response;
}

export function stopJob(jobId, companyName, kbKey = null) {
  const key = jobKey(jobId, companyName, kbKey);
  const result = guardStop(standaloneJobs, key, jobId, KINDS.standalone);
  if (result.success === false) return result;
  // Stopping a PAUSED job also drops its persisted row — it must not
  // resurrect after a restart.
  if (result.state.status === "suspended") {
    SuspendedJobRepository.remove(result.state.jobId, result.state.companyName, result.state.kbKey ?? null);
  }
  return applyStop(standaloneJobs, result.key, result.state, KINDS.standalone);
}

/**
 * Pause a running standalone job: mark it "suspended" and abort the handler.
 * Abort is cooperative — the handler exits at the next loop boundary. The
 * suspended entry STAYS in the map until resumeJob consumes it (a fresh run;
 * the ingestion registry skips already-processed documents, so resume
 * continues from where the run left off).
 */
export function pauseJob(jobId, companyName, kbKey = null) {
  const key = jobKey(jobId, companyName, kbKey);
  const result = guardStop(standaloneJobs, key, jobId, KINDS.standalone);
  if (result.success === false) return result;
  const { state } = result;
  state.status = "suspended";
  state.pausedAt = new Date().toISOString();
  state.abortController?.abort();
  // Persist so the paused job survives a server restart (fire-and-forget —
  // MySQL hiccups never break pausing).
  SuspendedJobRepository.upsert({
    jobId: state.jobId,
    companyName: state.companyName,
    kbKey: state.kbKey ?? null,
    startedAt: state.startedAt,
    pausedAt: state.pausedAt,
    progress: state.progress ?? null,
  });
  console.log(`⏸ Standalone job paused: ${jobKeyDisplay(key)}`);
  return {
    success: true,
    message: KINDS.standalone.paused(key),
    jobId: state.jobId,
    companyName: state.companyName,
    kbKey: state.kbKey ?? null,
  };
}

/**
 * Resume a paused standalone job by starting a fresh run for the same
 * job/company/kb (the old suspended entry is consumed). Resume-from-checkpoint
 * comes from the ingestion registry, not from this entry's state.
 */
export async function resumeJob(jobId, companyName, kbKey = null) {
  const key = jobKey(jobId, companyName, kbKey);
  const state = standaloneJobs.get(key);
  if (!state || state.status !== "suspended") {
    return { success: false, message: KINDS.standalone.notSuspended(key) };
  }
  standaloneJobs.delete(key);
  SuspendedJobRepository.remove(jobId, companyName ?? null, kbKey ?? null);
  const started = await startJob(jobId, companyName, { kbKey });
  if (started.success) {
    started.message = `Job '${jobKeyDisplay(key)}' resumed.`;
  }
  return started;
}

/**
 * Re-register persisted suspended jobs after a restart so they can be
 * resumed (or inspected/stopped) via the normal API. Called once at boot
 * after config init. Best-effort: a persisted row for an unknown jobId is
 * dropped.
 */
export async function restoreSuspendedJobs() {
  const rows = await SuspendedJobRepository.listAll();
  let restored = 0;
  for (const row of rows) {
    if (!jobExists(row.job_id)) {
      // Job type no longer exists — drop the stale row.
      SuspendedJobRepository.remove(row.job_id, row.company_name, row.kb_key);
      continue;
    }
    const key = jobKey(row.job_id, row.company_name, row.kb_key);
    if (standaloneJobs.has(key)) continue; // live state wins
    standaloneJobs.set(key, {
      jobId: row.job_id,
      companyName: row.company_name,
      kbKey: row.kb_key ?? null,
      status: "suspended",
      startedAt: row.started_at,
      pausedAt: row.paused_at,
      progress: row.progress ?? null,
      abortController: null,
    });
    restored++;
  }
  if (restored > 0) {
    console.log(`⏸ Restored ${restored} paused job(s) from the last run.`);
    logToFile("process.log", `⏸ Restored ${restored} paused job(s) after restart`);
  }
  return restored;
}

export function getRunningJobs() {
  const jobs = [];
  for (const [, state] of standaloneJobs) {
    // Suspended (paused) jobs are reported too so callers can distinguish
    // running vs paused; `status` carries which one it is.
    if (state.status === "running" || state.status === "suspended") {
      jobs.push({
        jobId: state.jobId,
        companyName: state.companyName,
        kbKey: state.kbKey ?? null,
        status: state.status,
        startedAt: state.startedAt,
        pausedAt: state.pausedAt ?? null,
        progress: state.progress,
      });
    }
  }
  return jobs;
}

// --------------------------
// CRON SCHEDULES
// --------------------------
export function startCron(jobId, schedule, companyName, opts = {}) {
  if (!jobExists(jobId)) {
    return { success: false, message: `Job '${jobId}' not found.` };
  }

  if (!cron.validate(schedule)) {
    return { success: false, message: "Invalid cron expression." };
  }

  // kbKey scopes the schedule to one knowledge base (KB-driven ingest) —
  // same keying as standalone jobs, so a company can run several KB schedules
  // plus a legacy whole-company schedule concurrently.
  const key = jobKey(jobId, companyName, opts.kbKey);
  const denied = guardStart(cronSchedulers, key, KINDS.cron);
  if (denied) return denied;

  // Kept as the schedule-level stop signal; the tick runs live in the
  // standalone map with their own controllers (stopJob handles those).
  const abortController = new AbortController();

  const state = {
    jobId,
    companyName: companyName || null,
    kbKey: opts.kbKey || null,
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

    try {
      console.log(`⏰ Cron tick: ${jobKeyDisplay(key)}`);
      // Route the tick through the STANDALONE runner: the run becomes visible
      // in /jobs/running (progress!), pausable, resumable, and stoppable — a
      // cron-driven ingest is the same job, just started by the clock. The
      // runner owns the AbortController and the checkpointed registry does
      // the resume, so a paused tick is continued by the NEXT tick (or an
      // explicit /job/resume) — the schedule itself keeps ticking.
      const run = await startJob(jobId, companyName, { kbKey: state.kbKey, awaitCompletion: true });
      if (!run.success) {
        // Runner denied (concurrency limit or a same-key run already active)
        // — same semantic as the overlapping-tick skip above.
        console.log(`⏭️ Skipping tick (runner denied): ${run.message}`);
        return;
      }
      state.runCount++;

      const settled = await run.completion;
      // "suspended" (paused) and "stopped" are user actions on the RUN —
      // not schedule failures; never stain the schedule's lastError with them.
      if (settled.status === "failed") {
        state.lastError = settled.error || "job failed";
        console.error(`❌ Cron job failed: ${jobKeyDisplay(key)}`, settled.error);
      } else {
        state.lastError = null;
        if (settled.status === "suspended") console.log(`⏸ Cron tick run paused: ${jobKeyDisplay(key)}`);
        else if (settled.status === "stopped") console.log(`🛑 Cron tick run stopped: ${jobKeyDisplay(key)}`);
        else console.log(`✅ Cron job completed: ${jobKeyDisplay(key)}`);
      }
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
  if (opts.kbKey) response.kbKey = opts.kbKey;
  return response;
}

export function stopCron(jobId, companyName, kbKey = null) {
  const key = jobKey(jobId, companyName, kbKey);
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

function cronStatus(key, state) {
  return {
    key,
    jobId: state.jobId,
    companyName: state.companyName || null,
    kbKey: state.kbKey || null,
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
  const pausedJobs = runningJobs.filter((j) => j.status === "suspended");
  const scheduledCrons = [...cronSchedulers.entries()]
    .filter(([, s]) => s.status === "scheduled")
    .map(([key, s]) => cronStatus(key, s));

  if (runningJobs.length > 0 || scheduledCrons.length > 0) {
    return {
      success: true,
      mode: "active",
      standalone: runningJobs,
      paused: pausedJobs,
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
