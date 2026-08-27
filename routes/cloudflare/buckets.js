// --------------------------
// R2 BUCKET ROUTES (/cloudflare/buckets)
// Handlers throw on unexpected failures — Express 5 forwards sync throws and
// async rejections to the central typed-error handler in app.js, which logs
// once and maps AppError statuses. No per-handler try/catch needed.
// --------------------------
import express from "express";

import {
  listBuckets,
  createBucket,
  deleteBucket,
  clearBucket,
} from "../../services/r2.js";

import { companyFromHeader, validateResourceName } from "./helpers.js";

const router = express.Router();

// GET /cloudflare/buckets
router.get("/", async (req, res) => {
  const companyName = companyFromHeader(req, res);
  if (!companyName) return;
  const buckets = await listBuckets(companyName);
  return res.json({ success: true, buckets });
});

// POST /cloudflare/buckets
router.post("/", async (req, res) => {
  const { name } = req.body;

  const nameError = validateResourceName(name);
  if (nameError) {
    return res.status(400).json({ success: false, error: nameError });
  }

  const companyName = companyFromHeader(req, res);
  if (!companyName) return;
  const bucket = await createBucket(name, companyName);
  if (!bucket) {
    return res.status(500).json({ success: false, error: "Failed to create bucket." });
  }
  return res.status(201).json({ success: true, bucket });
});

// DELETE /cloudflare/buckets/:name
router.delete("/:name", async (req, res) => {
  const { name } = req.params;

  const nameError = validateResourceName(name);
  if (nameError) {
    return res.status(400).json({ success: false, error: nameError });
  }

  const companyName = companyFromHeader(req, res);
  if (!companyName) return;
  const result = await deleteBucket(name, companyName);
  if (!result) {
    return res.status(404).json({ success: false, error: `Bucket '${name}' not found or could not be deleted.` });
  }
  return res.json({ success: true, message: `Bucket '${name}' deleted.` });
});

// POST /cloudflare/buckets/:name/clear
router.post("/:name/clear", async (req, res) => {
  const { name } = req.params;

  const nameError = validateResourceName(name);
  if (nameError) {
    return res.status(400).json({ success: false, error: nameError });
  }

  const companyName = companyFromHeader(req, res);
  if (!companyName) return;
  const result = await clearBucket(name, companyName);
  if (!result) {
    return res.status(500).json({ success: false, error: `Failed to clear bucket '${name}'.` });
  }
  return res.json({ success: true, message: `Bucket '${name}' cleared.` });
});

export default router;
