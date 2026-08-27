// --------------------------
// INGESTION ROUTES
// Start, cancel, and check status of ingestion jobs.
// --------------------------

import express from "express";
import { gate } from "./helpers.js";
import { startJob, stopJob, standaloneJobs } from "../../cron/index.js";
import { CompanyRepository } from "../../mysql/repositories.js";
import { wrap } from "./helpers.js";

const router = express.Router();

router.use(gate);

// GET /ingest/jobs — list all ingestion jobs (for debugging/admin)
router.get(
  "/jobs",
  wrap(async (req, res) => {
    const jobs = Array.from(standaloneJobs.values()).map((job) => ({
      id: job.jobId,
      companyName: job.companyName,
      kbKey: job.kbKey,
      status: job.status,
      startedAt: job.startedAt,
      error: job.error,
    }));
    res.json({ success: true, jobs });
  })
);

// POST /ingest/start — start an ingestion job (standalone)
router.post(
  "/start",
  wrap(async (req, res) => {
    const { companyName, kbKey, maxPages, scope } = req.body;
    if (!companyName) {
      return res.status(400).json({ success: false, error: "companyName is required" });
    }

    // Validate company exists
    const company = await CompanyRepository.findByKey(companyName);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${companyName}' not found` });
    }

    // Prevent duplicate ingestion for same company+kb
    const existing = Array.from(standaloneJobs.values()).find(
      (j) => j.jobId === "ingest" && j.companyName === companyName && j.kbKey === kbKey
    );
    if (existing) {
      return res.status(409).json({ success: false, error: `Ingestion already running for company '${companyName}'${kbKey ? ` and KB '${kbKey}'` : ""}` });
    }

    const result = await startJob("ingest", companyName, { kbKey, maxPages, scope });
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.message || "Failed to start job" });
    }

    // Log audit
    // TODO: audit logging

    res.json({ success: true, message: `Ingestion started for company '${companyName}'${kbKey ? ` and KB '${kbKey}'` : ""}`, startedAt: result.startedAt });
  })
);

// GET /ingest/status/:companyName — get ingestion status for a company
router.get(
  "/status/:companyName",
  wrap(async (req, res) => {
    const { companyName } = req.params;
    if (!companyName) {
      return res.status(400).json({ success: false, error: "companyName is required" });
    }

    const company = await CompanyRepository.findByKey(companyName);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${companyName}' not found` });
    }

    const job = Array.from(standaloneJobs.values()).find(
      (j) => j.jobId === "ingest" && j.companyName === companyName
    );

    if (!job) {
      return res.json({ success: true, status: { running: false, inProgress: false, documentCount: 0, vectorCount: null, lastError: null, lastSyncAt: null } });
    }

    // We don't have direct access to documentCount etc. from the job object.
    // For now, we return basic status. In the future we could enhance the job object to store progress.
    res.json({
      success: true,
      status: {
        running: job.status === "running",
        inProgress: job.status === "running",
        documentCount: job.documentCount || 0, // we would need to store this in the job object
        vectorCount: job.vectorCount || null,
        lastError: job.error || null,
        lastSyncAt: job.startedAt,
      },
    });
  })
);

// DELETE /ingest/cancel/:companyName — cancel ingestion for a company
router.delete(
  "/cancel/:companyName",
  wrap(async (req, res) => {
    const { companyName } = req.params;
    if (!companyName) {
      return res.status(400).json({ success: false, error: "companyName is required" });
    }

    const company = await CompanyRepository.findByKey(companyName);
    if (!company) {
      return res.status(404).json({ success: false, error: `Company '${companyName}' not found` });
    }

    const job = Array.from(standaloneJobs.values()).find(
      (j) => j.jobId === "ingest" && j.companyName === companyName
    );
    if (!job) {
      return res.json({ success: true, message: `No ingestion job running for company '${companyName}'` });
    }

    await stopJob("ingest", companyName);
    res.json({ success: true, message: `Ingestion cancelled for company '${companyName}'` });
  })
);

// GET /ingest/history/:companyName/history — stub for now
router.get(
  "/history/:companyName/history",
  wrap(async (req, res) => {
    res.json({ success: true, history: [] });
  })
);

export default router;