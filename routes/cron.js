import express from "express";
import cron from "node-cron";
import {
  startJob,
  stopJob,
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
router.post("/job/stop", (req, res) => {
  const { jobId, companyName, kbKey } = req.body || {};
  const result = stopJob(jobId, companyName, kbKey);
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
// Body: { jobId, schedule, companyName? }
// Multiple concurrent cron schedules allowed (up to MAX_CONCURRENT_JOBS).
router.post("/cron/start", (req, res) => {
  const { jobId, schedule, companyName } = req.body;

  if (!jobId) {
    return res.status(400).json({ success: false, error: "jobId is required." });
  }

  if (!schedule) {
    return res.status(400).json({ success: false, error: "schedule (cron expression) is required." });
  }

  const result = startCron(jobId, schedule, companyName);
  return res.status(result.success ? 200 : 400).json(result);
});

// POST /cron/stop
// Body: { jobId?, companyName? }
// Stops a specific scheduled cron, or the first scheduled one if no params given.
router.post("/cron/stop", (req, res) => {
  const { jobId, companyName } = req.body || {};
  const result = stopCron(jobId, companyName);
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
