import express from "express";
import cron from "node-cron";
import {
  startJob,
  stopJob,
  pauseJob,
  resumeJob,
  startCron,
  stopCron,
  getJobs,
  getRunningJobs,
  getStatus,
} from "../cron/index.js";
import {
  listPresets,
  createPreset,
  updatePreset,
  deletePreset,
} from "../config/presets.js";

const router = express.Router();

// ============================================================
// 0. SCHEDULER PRESETS — reusable cron schedules stored in SQLite
// ============================================================

// GET /presets
router.get("/presets", (req, res) => {
  return res.json({ success: true, presets: listPresets() });
});

// POST /presets
// Body: { name, schedule }
router.post("/presets", (req, res) => {
  const { name, schedule } = req.body || {};

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: "name is required." });
  }

  if (!schedule?.trim()) {
    return res.status(400).json({ success: false, error: "schedule is required." });
  }

  if (!cron.validate(schedule.trim())) {
    return res.status(400).json({ success: false, error: "Invalid cron expression." });
  }

  const preset = createPreset(name.trim(), schedule.trim());
  return res.status(201).json({ success: true, preset });
});

// PUT /presets/:id
// Body: { name, schedule }
router.put("/presets/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, schedule } = req.body || {};

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid preset id." });
  }

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: "name is required." });
  }

  if (!schedule?.trim()) {
    return res.status(400).json({ success: false, error: "schedule is required." });
  }

  if (!cron.validate(schedule.trim())) {
    return res.status(400).json({ success: false, error: "Invalid cron expression." });
  }

  const updated = updatePreset(id, name.trim(), schedule.trim());
  if (!updated) {
    return res.status(404).json({ success: false, error: "Preset not found." });
  }

  return res.json({ success: true, message: "Preset updated." });
});

// DELETE /presets/:id
router.delete("/presets/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, error: "Invalid preset id." });
  }

  const deleted = deletePreset(id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: "Preset not found." });
  }

  return res.json({ success: true, message: "Preset deleted." });
});

// ============================================================
// 1. STANDALONE JOBS — run jobs, multiple concurrent allowed
// ============================================================

// POST /job/start
// Body: { jobId, companyName?, kbKey? }
// Starts a job immediately. Multiple concurrent jobs allowed (up to MAX_CONCURRENT_JOBS).
router.post("/job/start", async (req, res) => {
  const { jobId, companyName, kbKey } = req.body;

  if (!jobId) {
    return res.status(400).json({ success: false, error: "jobId is required." });
  }

  const result = await startJob(jobId, companyName, { kbKey });
  return res.status(result.success ? 200 : 400).json(result);
});

// POST /job/stop
// Body: { jobId?, companyName?, kbKey? }
// Stops a specific running job, or the first running job if no params given.
router.post("/job/stop", async (req, res) => {
  const { jobId, companyName, kbKey } = req.body || {};
  const result = stopJob(jobId, companyName, kbKey);
  // When an ingest job stops, the KB row may stay "indexing" (abort does not
  // flip it by design). Best-effort: restore "active" so the portal card does
  // not show a stale Indexing badge until the next run.
  if (result.success && jobId === "ingest" && companyName && kbKey) {
    try {
      const { CompanyRepository, KbRepository } = await import("../mysql/repositories.js");
      const company = await CompanyRepository.findByKey(companyName);
      const kb = company ? await KbRepository.findByKey(company.id, kbKey) : null;
      if (kb) await KbRepository.clearIndexingStatus(kb.id);
    } catch {
      /* best-effort status recovery */
    }
  }
  return res.status(result.success ? 200 : 400).json(result);
});

// POST /job/pause
// Body: { jobId?, companyName?, kbKey? }
// Pauses a running job — suspends it at the next loop boundary (checkpointed
// per document via the ingestion registry). The KB row is flipped out of
// "indexing" best-effort so the card badge reflects the paused state.
router.post("/job/pause", async (req, res) => {
  const { jobId, companyName, kbKey } = req.body || {};
  const result = pauseJob(jobId, companyName, kbKey);
  if (result.success && jobId === "ingest" && companyName && kbKey) {
    try {
      const { CompanyRepository, KbRepository } = await import("../mysql/repositories.js");
      const company = await CompanyRepository.findByKey(companyName);
      const kb = company ? await KbRepository.findByKey(company.id, kbKey) : null;
      if (kb) await KbRepository.clearIndexingStatus(kb.id);
    } catch {
      /* best-effort status recovery */
    }
  }
  return res.status(result.success ? 200 : 400).json(result);
});

// POST /job/resume
// Body: { jobId, companyName?, kbKey? }
// Resumes a paused job with a fresh run; completed documents are skipped by
// the ingestion registry, so the run continues from where it paused.
router.post("/job/resume", async (req, res) => {
  const { jobId, companyName, kbKey } = req.body || {};
  const result = await resumeJob(jobId, companyName, kbKey);
  return res.status(result.success ? 200 : 400).json(result);
});

// GET /jobs/running
// Returns all currently running standalone jobs.
router.get("/jobs/running", (req, res) => {
  return res.json({ success: true, jobs: getRunningJobs() });
});

// ============================================================
// 2. CRON SCHEDULERS — schedule jobs with cron expressions
// ============================================================

// POST /cron/start
// Body: { jobId, schedule, companyName?, kbKey? }
// Multiple concurrent cron schedules allowed (up to MAX_CONCURRENT_JOBS).
// kbKey scopes the schedule to one knowledge base (KB-driven ingest) — the
// KB binding is verified at schedule time so an unattended cron never ticks
// into a NotFoundError run after run.
router.post("/cron/start", async (req, res) => {
  const { jobId, schedule, companyName, kbKey } = req.body;

  if (!jobId) {
    return res.status(400).json({ success: false, error: "jobId is required." });
  }

  if (!schedule) {
    return res.status(400).json({ success: false, error: "schedule (cron expression) is required." });
  }

  if (kbKey) {
    if (!companyName) {
      return res.status(400).json({ success: false, error: "kbKey requires companyName — a KB schedule is always company-scoped." });
    }
    try {
      const { CompanyRepository, KbRepository } = await import("../mysql/repositories.js");
      const company = await CompanyRepository.findByKey(companyName);
      const kb = company ? await KbRepository.findByKey(company.id, kbKey) : null;
      if (!kb) {
        return res.status(400).json({ success: false, error: `Knowledge base '${kbKey}' not found for company '${companyName}'.` });
      }
    } catch (e) {
      return res.status(400).json({ success: false, error: `Could not verify KB '${kbKey}' for company '${companyName}': ${e.message}` });
    }
  }

  const result = startCron(jobId, schedule, companyName, { kbKey });
  return res.status(result.success ? 200 : 400).json(result);
});

// POST /cron/stop
// Body: { jobId?, companyName?, kbKey? }
// Stops a specific scheduled cron, or the first scheduled one if no params given.
router.post("/cron/stop", (req, res) => {
  const { jobId, companyName, kbKey } = req.body || {};
  const result = stopCron(jobId, companyName, kbKey);
  return res.status(result.success ? 200 : 400).json(result);
});

// ============================================================
// 3. LIST ALL JOBS
// ============================================================

// GET /jobs
// Returns all registered job types.
router.get("/jobs", (req, res) => {
  return res.json({ success: true, jobs: getJobs() });
});

// ============================================================
// 4. STATUS — all active jobs (standalone + cron)
// ============================================================

// GET /status
router.get("/status", (req, res) => {
  return res.json(getStatus());
});

export default router;
