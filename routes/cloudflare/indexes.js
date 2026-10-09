// --------------------------
// VECTORIZE INDEX ROUTES (/cloudflare/indexes)
// Legacy index-management routes (the pre-gateway path, still used by the
// portal Cloudflare page). Every mutation is audited; DELETE refuses to
// remove an index a knowledge base is bound to.
//
// 2026-09-30 hardening after the max-test-index incident: the index was
// deleted+recreated outside the gateway on 09-29 and every KB bound to it
// silently lost its vectors (wp-30 lost 1,259). These routes had NO audit
// logging and NO binding guard — recreating an index destroys its vectors,
// so both create and delete on a KB-bound name are now blocked/audited.
// --------------------------
import express from "express";

import {
  listVectors,
  findVector,
  createVectorIndex,
  deleteVectorIndex,
} from "../../services/vectorize.js";

import { CompanyRepository, KbRepository, AuditRepository } from "../../mysql/repositories.js";
import { ConflictError } from "../../shared/errors.js";
import { companyFromHeader, validateResourceName } from "./helpers.js";

/** Audit row for an index mutation. Best-effort — never fails the request. */
async function auditIndexAction(companyName, action, name, extra = {}) {
  try {
    const company = await CompanyRepository.findByKey(companyName);
    if (!company) return;
    await AuditRepository.log({
      companyId: company.id,
      actorType: "admin",
      actorIp: extra.actorIp ?? null,
      action,
      entityType: "vector_index",
      entityId: null,
      afterState: { name, ...extra },
      reason: "admin action",
    });
  } catch (err) {
    console.error(`⚠️ Index audit log failed (${action} ${name}):`, err.message);
  }
}

/** 409 when any live KB (any company) binds `name` as its vector store.
 *  Cloudflare's index list carries no stable id, so match through the
 *  gateway resource rows' external_resource_id instead. */
async function assertIndexNotKbBound(name) {
  const rows = await KbRepository.listByVectorExternalId(name).catch(() => []);
  if (rows.length) {
    const detail = rows.map((k) => `'${k.kb_key}' (${k.company_id})`).join(", ");
    throw new ConflictError(
      `Index '${name}' is the Vector Store of knowledge base(s): ${detail}. ` +
        `Re-point or delete the KB(s) first — recreating or deleting this index would destroy their vectors.`
    );
  }
}

const router = express.Router();

// GET /cloudflare/indexes
router.get("/", async (req, res) => {
  const companyName = companyFromHeader(req, res);
  if (!companyName) return;
  const indexes = await listVectors(companyName);
  return res.json({ success: true, indexes });
});

// POST /cloudflare/indexes
router.post("/", async (req, res) => {
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

  // Recreating a name that KBs are bound to would hand those KBs a fresh,
  // empty index while their registry claims the old vectors exist.
  await assertIndexNotKbBound(name);

  const index = await createVectorIndex(name, companyName, dimensions);
  await auditIndexAction(companyName, "vector_index.created", name, {
    dimensions: dimensions ?? null,
    actorIp: req.ip,
  });
  return res.status(201).json({ success: true, index });
});

// DELETE /cloudflare/indexes/:name
router.delete("/:name", async (req, res) => {
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

  // A KB-bound index holds that KB's vectors — deleting it is data loss the
  // KB row cannot see (status stays "active").
  await assertIndexNotKbBound(name);

  const result = await deleteVectorIndex(name, companyName);
  await auditIndexAction(companyName, "vector_index.deleted", name, {
    actorIp: req.ip,
  });
  return res.json({ success: true, message: result });
});

export default router;
