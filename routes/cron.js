import express from "express";
import {
  startJob,
  stopJob,
  startCron,
  stopCron,
  getJobs,
  getRunningJobs,
  getStatus,
} from "../cron/index.js";

const router = express.Router();

// ============================================================
// 1. STANDALONE JOBS — run jobs, multiple concurrent allowed
// ============================================================

// POST /job/start
// Body: { jobId, companyName? }
// Starts a job immediately. Multiple concurrent jobs allowed (up to MAX_CONCURRENT_JOBS).
router.post("/job/start", async (req, res) => {
  try {
    const { jobId, companyName } = req.body;

    if (!jobId) {
      return res.status(400).json({ success: false, message: "jobId is required." });
    }

    const result = await startJob(jobId, companyName);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /job/stop
// Body: { jobId?, companyName? }
// Stops a specific running job, or the first running job if no params given.
router.post("/job/stop", (req, res) => {
  const { jobId, companyName } = req.body || {};
  const result = stopJob(jobId, companyName);
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
  try {
    const { jobId, schedule, companyName } = req.body;

    if (!jobId) {
      return res.status(400).json({ success: false, message: "jobId is required." });
    }

    if (!schedule) {
      return res.status(400).json({ success: false, message: "schedule (cron expression) is required." });
    }

    const result = startCron(jobId, schedule, companyName);
    return res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
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
