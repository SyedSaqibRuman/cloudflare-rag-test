// --------------------------
// WORKFLOW RUNNER
// Executes workflow definitions step-by-step with abort support,
// per-step status tracking, and error handling.
// Step types: assistant, http, ingest, notify, delay, condition, loop
// --------------------------

// Active workflow runs — Map<runId, { status, steps, startedAt, signal }>
const activeRuns = new Map();
let runCounter = 0;

// Scheduled workflow runs — Map<scheduleKey, { cron, workflowKey, companyName, task }>
const scheduledWorkflows = new Map();

/**
 * @typedef {Object} StepResult
 * @property {number} stepIndex
 * @property {string} type
 * @property {string} status — 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
 * @property {*} output
 * @property {string} [error]
 * @property {number} [durationMs]
 */

/**
 * Generate a unique run ID.
 */
function generateRunId() {
  return `run_${Date.now()}_${++runCounter}`;
}

/**
 * Sleep for ms milliseconds, abortable.
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, Math.min(ms, 300_000));
    signal?.addEventListener?.("abort", () => { clearTimeout(timer); reject(new Error("Workflow aborted")); }, { once: true });
  });
}

/**
 * Execute a single workflow step with optional retry.
 * @param {Object} step — { type, config, retry?: { maxAttempts?: number, delayMs?: number } }
 * @param {Object} context — { companyName, assistantKey, previousOutputs }
 * @param {AbortSignal} signal
 * @returns {Promise<{ output: *, error?: string }>}
 */
async function executeStep(step, context, signal) {
  if (signal.aborted) throw new Error("Workflow aborted");

  const maxAttempts = step.retry?.maxAttempts || 1;
  const delayMs = step.retry?.delayMs || 1000;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal.aborted) throw new Error("Workflow aborted");
    try {
      return await executeStepOnce(step, context, signal);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && !signal.aborted) {
        console.log(`🔄 Step '${step.type}' failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms...`);
        await sleep(delayMs, signal).catch(() => {});
      }
    }
  }
  throw lastError;
}

/**
 * Execute a single workflow step (no retry).
 */
async function executeStepOnce(step, context, signal) {
  if (signal.aborted) throw new Error("Workflow aborted");

  switch (step.type) {
    case "assistant": {
      const { askQuestion } = await import("../../query/answer.js");
      const input = interpolate(step.config?.input || "Hello", context.previousOutputs);
      const result = await askQuestion(input, [], context.companyName, { signal });
      return { output: result.answer };
    }

    case "http": {
      const url = interpolate(step.config?.url || "", context.previousOutputs);
      const method = step.config?.method || "GET";
      const headers = step.config?.headers || {};
      const body = step.config?.body ? interpolate(JSON.stringify(step.config.body), context.previousOutputs) : undefined;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: method !== "GET" ? body : undefined,
        signal,
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      return { output: data };
    }

    case "ingest": {
      // Use the existing job infrastructure (standalone.js) to run ingestion
      // in the background — the full pipeline (WordPress fetch → chunk →
      // embed → R2 upload → Vectorize upsert) is too heavy for a sync step.
      const { startJob } = await import("../../cron/index.js");
      const kbKey = step.config?.kbKey || null;
      const scope = step.config?.scope || null;
      const result = await startJob("ingest", context.companyName, { kbKey, scope });
      if (!result.success) {
        throw new Error(result.message || "Ingest job failed to start.");
      }
      return { output: { started: true, jobId: result.jobId || "ingest", kbKey: kbKey || "(default)" } };
    }

    case "notify": {
      const channel = step.config?.channel || "log";
      const message = interpolate(step.config?.message || "", context.previousOutputs);
      // Best-effort notification — log to console for now.
      console.log(`📢 Workflow notification [${channel}]: ${message}`);
      return { output: { notified: true, channel, message } };
    }

    case "delay": {
      const ms = step.config?.ms || 1000;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, Math.min(ms, 300_000)); // max 5 min
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Workflow aborted")); });
      });
      return { output: { delayed: ms } };
    }

    case "condition": {
      const expr = step.config?.expression || "";
      const result = evaluateCondition(expr, context.previousOutputs);
      return { output: { conditionMet: result } };
    }

    case "loop": {
      // Simple loop — execute child steps N times.
      const iterations = step.config?.iterations || 1;
      const childSteps = step.config?.steps || [];
      const results = [];
      for (let i = 0; i < Math.min(iterations, 10); i++) {
        if (signal.aborted) break;
        for (const childStep of childSteps) {
          const result = await executeStep(childStep, context, signal);
          results.push(result);
        }
      }
      return { output: results };
    }

    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

/**
 * Simple variable interpolation: {{step0.output}}, {{step1.output}}, etc.
 */
function interpolate(template, previousOutputs) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{step(\d+)\.output\}\}/g, (_, idx) => {
    const output = previousOutputs[Number(idx)];
    return output != null ? (typeof output === "string" ? output : JSON.stringify(output)) : "";
  });
}

/**
 * Simple condition evaluation — checks if a previous step output meets a condition.
 * Supports: "step0.output == 'value'", "step0.output != null", "step0.output.length > 0"
 */
function evaluateCondition(expr, previousOutputs) {
  // Very basic evaluation — just check for truthiness or simple equality.
  if (!expr) return true;
  const match = expr.match(/^step(\d+)\.output\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) return Boolean(expr);
  const [, idx, op, expected] = match;
  const actual = previousOutputs[Number(idx)];
  const expVal = expected.replace(/^['"]|['"]$/g, "");
  switch (op) {
    case "==": return String(actual) === expVal;
    case "!=": return String(actual) !== expVal;
    case ">": return Number(actual) > Number(expVal);
    case "<": return Number(actual) < Number(expVal);
    case ">=": return Number(actual) >= Number(expVal);
    case "<=": return Number(actual) <= Number(expVal);
    default: return true;
  }
}

/**
 * Run a workflow definition.
 * @param {Object} opts
 * @param {string} opts.workflowKey
 * @param {string} opts.companyName
 * @param {Object} opts.definition — { steps: [...] }
 * @param {Object} [opts.signal] — AbortSignal
 * @returns {Promise<{ runId: string, status: string, steps: StepResult[] }>}
 */
export async function runWorkflow({ workflowKey, companyName, definition, signal: externalSignal }) {
  const runId = generateRunId();
  const abortController = new AbortController();
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, abortController.signal])
    : abortController.signal;

  const steps = definition?.steps || [];
  const stepResults = [];
  const previousOutputs = [];

  const run = {
    runId,
    workflowKey,
    companyName,
    status: "running",
    steps: stepResults,
    startedAt: new Date(),
    abortController,
  };
  activeRuns.set(runId, run);

  try {
    for (let i = 0; i < steps.length; i++) {
      if (signal.aborted) {
        stepResults.push({ stepIndex: i, type: steps[i].type, status: "skipped", output: null });
        break;
      }

      const stepStart = Date.now();
      stepResults.push({ stepIndex: i, type: steps[i].type, status: "running", output: null });

      try {
        const result = await executeStep(steps[i], { companyName, previousOutputs }, signal);
        previousOutputs.push(result.output);
        stepResults[i] = {
          stepIndex: i,
          type: steps[i].type,
          status: "completed",
          output: result.output,
          durationMs: Date.now() - stepStart,
        };
      } catch (err) {
        previousOutputs.push(null);
        stepResults[i] = {
          stepIndex: i,
          type: steps[i].type,
          status: "failed",
          output: null,
          error: err.message,
          durationMs: Date.now() - stepStart,
        };
        run.status = "failed";
        break;
      }
    }

    if (run.status === "running") run.status = "completed";
  } catch (err) {
    run.status = "failed";
  } finally {
    run.completedAt = new Date();
    run.durationMs = run.completedAt - run.startedAt;

    // Persist to MySQL (best-effort — never block the caller).
    try {
      const { WorkflowRunRepository, WorkflowRepository, CompanyRepository } = await import("../repositories.js");
      const company = await CompanyRepository.findByKey(companyName);
      const workflow = company ? await WorkflowRepository.findByKey(company.id, workflowKey) : null;
      if (company && workflow) {
        await WorkflowRunRepository.logRun({
          companyId: company.id,
          workflowId: workflow.id,
          workflowKey,
          runId,
          status: run.status,
          triggerType: "manual",
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          durationMs: run.durationMs,
          steps: stepResults,
          error: run.status === "failed" ? "One or more steps failed." : null,
        });
      }
    } catch {
      // Best-effort — don't fail the workflow if DB is unavailable
    }

    // Keep in activeRuns for 5 minutes, then clean up.
    const cleanup = setTimeout(() => activeRuns.delete(runId), 5 * 60_000);
    cleanup.unref();
  }

  return run;
}

/**
 * Abort a running workflow.
 * @param {string} runId
 * @returns {boolean}
 */
export function abortWorkflow(runId) {
  const run = activeRuns.get(runId);
  if (!run || run.status !== "running") return false;
  run.abortController.abort();
  run.status = "aborted";
  return true;
}

/**
 * Get the status of a workflow run.
 * @param {string} runId
 * @returns {Object | null}
 */
export function getRunStatus(runId) {
  return activeRuns.get(runId) || null;
}

/**
 * List all active runs for a company.
 * @param {string} companyName
 * @returns {Array}
 */
export function listActiveRuns(companyName) {
  const runs = [];
  for (const run of activeRuns.values()) {
    if (run.companyName === companyName) runs.push(run);
  }
  return runs;
}

// --------------------------
// SCHEDULE TRIGGERS
// --------------------------

/**
 * Schedule a workflow to run on a cron expression.
 * @param {Object} opts
 * @param {string} opts.workflowKey
 * @param {string} opts.companyName
 * @param {string} opts.cron — cron expression (e.g. "0 2 * * *")
 * @param {Object} opts.definition — workflow definition
 * @returns {{ success: boolean, message: string, scheduleKey: string }}
 */
export async function scheduleWorkflow({ workflowKey, companyName, cron: cronExpr, definition }) {
  const cronMod = await import("node-cron");
  const cron = cronMod.default || cronMod;

  if (!cron.validate(cronExpr)) {
    return { success: false, message: `Invalid cron expression: ${cronExpr}` };
  }

  // node-cron keeps the event loop alive via setInterval — unref it.
  // This is a known issue with node-cron.

  const scheduleKey = `${workflowKey}:${companyName || "_default"}`;

  // Stop existing schedule if any.
  if (scheduledWorkflows.has(scheduleKey)) {
    const existing = scheduledWorkflows.get(scheduleKey);
    existing.task?.stop();
  }

  const task = cron.schedule(cronExpr, async () => {
    console.log(`⏰ Workflow schedule tick: ${scheduleKey}`);
    try {
      await runWorkflow({ workflowKey, companyName, definition });
      console.log(`✅ Scheduled workflow completed: ${scheduleKey}`);
    } catch (err) {
      console.error(`❌ Scheduled workflow failed: ${scheduleKey}`, err.message);
    }
  });

  scheduledWorkflows.set(scheduleKey, {
    cron: cronExpr,
    workflowKey,
    companyName,
    definition,
    task,
    startedAt: new Date(),
    runCount: 0,
  });

  console.log(`✅ Workflow scheduled: ${scheduleKey} [${cronExpr}]`);

  return {
    success: true,
    message: `Workflow '${workflowKey}' scheduled with cron '${cronExpr}'.`,
    scheduleKey,
  };
}

/**
 * Stop a scheduled workflow.
 * @param {string} workflowKey
 * @param {string} companyName
 * @returns {{ success: boolean, message: string }}
 */
export function unscheduleWorkflow(workflowKey, companyName) {
  const scheduleKey = `${workflowKey}:${companyName || "_default"}`;
  const scheduled = scheduledWorkflows.get(scheduleKey);
  if (!scheduled) {
    return { success: false, message: `No schedule found for '${workflowKey}'.` };
  }

  scheduled.task?.stop();
  scheduledWorkflows.delete(scheduleKey);

  console.log(`🛑 Workflow unscheduled: ${scheduleKey}`);

  return {
    success: true,
    message: `Schedule stopped for '${workflowKey}'.`,
  };
}

/**
 * List all scheduled workflows for a company.
 * @param {string} companyName
 * @returns {Array}
 */
export function listScheduledWorkflows(companyName) {
  const schedules = [];
  for (const [key, scheduled] of scheduledWorkflows) {
    if (!companyName || scheduled.companyName === companyName) {
      schedules.push({
        scheduleKey: key,
        workflowKey: scheduled.workflowKey,
        companyName: scheduled.companyName,
        cron: scheduled.cron,
        startedAt: scheduled.startedAt,
        runCount: scheduled.runCount,
      });
    }
  }
  return schedules;
}
