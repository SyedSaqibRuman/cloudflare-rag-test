// --------------------------
// VECTORIZE INDEX ROUTES (/cloudflare/indexes)
// --------------------------
import express from "express";

import {
  listVectors,
  findVector,
  createVectorIndex,
  deleteVectorIndex,
} from "../../services/vectorize.js";

import { companyFromHeader, validateResourceName } from "./helpers.js";

const router = express.Router();

// GET /cloudflare/indexes
router.get("/", async (req, res) => {
  try {
    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const indexes = await listVectors(companyName);
    return res.json({ success: true, indexes });
  } catch (err) {
    console.error("❌ GET /indexes error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /cloudflare/indexes
router.post("/", async (req, res) => {
  try {
    const { name, dimensions } = req.body;

    const nameError = validateResourceName(name);
    if (nameError) {
      return res.status(400).json({ success: false, error: nameError });
    }

    if (dimensions !== undefined && (typeof dimensions !== "number" || dimensions <= 0)) {
      return res.status(400).json({ success: false, error: "dimensions must be a positive number." });
    }

    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const existing = await findVector(name, companyName);
    if (existing) {
      return res.status(200).json({ success: true, index: existing, message: "Index already exists." });
    }

    const index = await createVectorIndex(name, companyName, dimensions);
    return res.status(201).json({ success: true, index });
  } catch (err) {
    console.error("❌ POST /indexes error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /cloudflare/indexes/:name
router.delete("/:name", async (req, res) => {
  try {
    const { name } = req.params;

    const nameError = validateResourceName(name);
    if (nameError) {
      return res.status(400).json({ success: false, error: nameError });
    }

    const companyName = companyFromHeader(req, res);
    if (!companyName) return;
    const existing = await findVector(name, companyName);
    if (!existing) {
      return res.status(404).json({ success: false, error: `Index '${name}' not found.` });
    }

    const result = await deleteVectorIndex(name, companyName);
    return res.json({ success: true, message: result });
  } catch (err) {
    console.error("❌ DELETE /indexes/:name error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
