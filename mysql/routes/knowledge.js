// --------------------------
// KNOWLEDGE ROUTES — REST boundary over the Knowledge Service (Phase 2).
// Company + KB scoping comes from the request (x-company-name + KB key) and
// is never accepted as free-form input. Graph writes follow the knowledge
// mutation policy: admin/api actors may commit, everything else is queued as
// a candidate claim for the review queue.
//
// Routes (all under /gateway/knowledge, behind requireGatewayCompany):
//   GET    /kbs/:kbKey/entities            list entities (type/q/limit)
//   POST   /kbs/:kbKey/entities            create/morph entity { name, type }
//   GET    /kbs/:kbKey/entities/:entityId  entity detail incl. relationships
//   PUT    /kbs/:kbKey/entities/:entityId  update type/aliases/description
//   POST   /kbs/:kbKey/entities/merge      merge duplicates { keepId, dropId }
//   GET    /kbs/:kbKey/relationships       list typed edges (entityId/type)
//   POST   /kbs/:kbKey/relationships       create { source, type, target, ... }
//   DELETE /kbs/:kbKey/relationships       remove { sourceId, targetId, type }
//   GET    /kbs/:kbKey/claims              list claims (status/entityId)
//   POST   /kbs/:kbKey/claims              propose a claim
//   PUT    /kbs/:kbKey/claims/:claimId/status   accept/reject/deprecate/review
//   GET    /kbs/:kbKey/conflicts           claims flagged conflicting
//   GET    /kbs/:kbKey/review              review queue (candidates)
//   POST   /kbs/:kbKey/tools/execute       run an internal AI knowledge tool
// --------------------------
import express from "express";
import { requireGatewayCompany } from "../services/company-scope.js";
import { requireKb, actorFromReq } from "./shared-helpers.js";
import { wrap } from "./helpers.js";
import { AuditRepository } from "../repositories.js";
import {
  createEntity,
  listEntities,
  getEntity,
  updateEntity,
  mergeEntities,
  createRelationship,
  listRelationships,
  removeRelationship,
  createClaim,
  listClaims,
  updateClaimStatus,
  findConflicts,
  listReviewQueue,
  executeKnowledgeTool,
} from "../../knowledge/index.js";

const router = express.Router();

router.use("/knowledge", requireGatewayCompany);

async function audit(req, kbId, action, afterState = {}) {
  try {
    await AuditRepository.log({
      companyId: req.company.id,
      ...actorFromReq(req),
      action,
      entityType: "knowledge",
      entityId: kbId ? String(kbId) : null,
      afterState,
      reason: "knowledge layer mutation",
    });
  } catch {
    /* audit is best-effort — never mask the knowledge result */
  }
}

/** Actor for the knowledge mutation policy (admin UI = trusted, commits). */
function actorFromAdminReq(req) {
  return { type: "admin", id: req.auth?.user || "portal", ip: req.ip };
}

// ------------------------------------------------------------------
// ENTITIES
// ------------------------------------------------------------------

// GET /gateway/knowledge/kbs/:kbKey/entities
router.get(
  "/kbs/:kbKey/entities",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const { type, q, limit, offset } = req.query;
    const entities = await listEntities(req.company.company_key, kb.kb_key, { type, q, limit, offset });
    return res.json({ success: true, kbKey: kb.kb_key, entities });
  })
);

// POST /gateway/knowledge/kbs/:kbKey/entities
router.post(
  "/kbs/:kbKey/entities",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const { name, type, confidence } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: "name is required." });
    }
    const entity = await createEntity(
      req.company.company_key,
      kb.kb_key,
      { name: String(name).trim(), type: type || "Other", confidence },
      actorFromAdminReq(req)
    );
    await audit(req, kb.id, "knowledge.entity.created", { entity: entity.id, name: entity.name });
    return res.status(201).json({ success: true, entity });
  })
);

// GET /gateway/knowledge/kbs/:kbKey/entities/:entityId
router.get(
  "/kbs/:kbKey/entities/:entityId",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const entity = await getEntity(req.company.company_key, kb.kb_key, req.params.entityId);
    return res.json({ success: true, kbKey: kb.kb_key, entity });
  })
);

// PUT /gateway/knowledge/kbs/:kbKey/entities/:entityId
router.put(
  "/kbs/:kbKey/entities/:entityId",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const entity = await updateEntity(req.company.company_key, kb.kb_key, req.params.entityId, req.body || {});
    await audit(req, kb.id, "knowledge.entity.updated", { entity: entity.id, patch: req.body });
    return res.json({ success: true, entity });
  })
);

// POST /gateway/knowledge/kbs/:kbKey/entities/merge
router.post(
  "/kbs/:kbKey/entities/merge",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const { keepId, dropId } = req.body || {};
    if (!keepId || !dropId) {
      return res.status(400).json({ success: false, error: "keepId and dropId are required." });
    }
    const merged = await mergeEntities(req.company.company_key, kb.kb_key, { keepId, dropId });
    await audit(req, kb.id, "knowledge.entity.merged", merged);
    return res.json({ success: true, ...merged });
  })
);

// ------------------------------------------------------------------
// RELATIONSHIPS
// ------------------------------------------------------------------

// GET /gateway/knowledge/kbs/:kbKey/relationships
router.get(
  "/kbs/:kbKey/relationships",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const { entityId, type, limit } = req.query;
    const relationships = await listRelationships(req.company.company_key, kb.kb_key, { entityId, type, limit });
    return res.json({ success: true, kbKey: kb.kb_key, relationships });
  })
);

// POST /gateway/knowledge/kbs/:kbKey/relationships
router.post(
  "/kbs/:kbKey/relationships",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const { source, type, target, confidence, evidence, autoCreateEntities } = req.body || {};
    const result = await createRelationship(
      req.company.company_key,
      kb.kb_key,
      { source, type, target, confidence, evidence, autoCreateEntities: autoCreateEntities !== false },
      actorFromAdminReq(req)
    );
    await audit(req, kb.id, "knowledge.relationship.created", {
      source: result.sourceId, type: result.type, target: result.targetId, status: result.status,
    });
    return res.status(201).json({ success: true, ...result });
  })
);

// DELETE /gateway/knowledge/kbs/:kbKey/relationships
router.delete(
  "/kbs/:kbKey/relationships",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const { sourceId, targetId, type } = req.body || {};
    if (!sourceId || !targetId || !type) {
      return res.status(400).json({ success: false, error: "sourceId, targetId and type are required." });
    }
    const result = await removeRelationship(req.company.company_key, kb.kb_key, { sourceId, targetId, type });
    await audit(req, kb.id, "knowledge.relationship.deleted", { sourceId, targetId, type });
    return res.json({ success: true, ...result });
  })
);

// ------------------------------------------------------------------
// CLAIMS
// ------------------------------------------------------------------

// GET /gateway/knowledge/kbs/:kbKey/claims
router.get(
  "/kbs/:kbKey/claims",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const { status, entityId, limit } = req.query;
    const claims = await listClaims(req.company.company_key, kb.kb_key, { status, entityId, limit });
    return res.json({ success: true, kbKey: kb.kb_key, claims });
  })
);

// POST /gateway/knowledge/kbs/:kbKey/claims — propose a claim (policy applies)
router.post(
  "/kbs/:kbKey/claims",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const { subject, predicate, object, confidence, evidence, status } = req.body || {};
    const result = await createClaim(
      req.company.company_key,
      kb.kb_key,
      { subject, predicate, object, confidence, evidence, status, allowAutoCreateEntities: true },
      actorFromAdminReq(req)
    );
    await audit(req, kb.id, "knowledge.claim.created", {
      claim: result.id, subject: result.subjectId, predicate: result.predicate,
      object: result.objectId, status: result.status,
    });
    return res.status(201).json({ success: true, ...result });
  })
);

// PUT /gateway/knowledge/kbs/:kbKey/claims/:claimId/status
router.put(
  "/kbs/:kbKey/claims/:claimId/status",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const { status, reason } = req.body || {};
    if (!status) return res.status(400).json({ success: false, error: "status is required." });
    const result = await updateClaimStatus(
      req.company.company_key, kb.kb_key, req.params.claimId, status, actorFromAdminReq(req), reason
    );
    await audit(req, kb.id, "knowledge.claim.status", { claim: req.params.claimId, status, reason });
    return res.json({ success: true, ...result });
  })
);

// GET /gateway/knowledge/kbs/:kbKey/conflicts
router.get(
  "/kbs/:kbKey/conflicts",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const conflicts = await findConflicts(req.company.company_key, kb.kb_key);
    return res.json({ success: true, kbKey: kb.kb_key, conflicts });
  })
);

// GET /gateway/knowledge/kbs/:kbKey/review — review queue
router.get(
  "/kbs/:kbKey/review",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const review = await listReviewQueue(req.company.company_key, kb.kb_key);
    return res.json({ success: true, kbKey: kb.kb_key, review });
  })
);

// POST /gateway/knowledge/kbs/:kbKey/tools/execute — internal AI tool boundary
// (Phase 5). Company + KB come from the request; the actor is the admin UI,
// so write tools commit directly (trusted actor policy).
router.post(
  "/kbs/:kbKey/tools/execute",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.kbKey);
    const { tool, args } = req.body || {};
    if (!tool || typeof tool !== "string") {
      return res.status(400).json({ success: false, error: "tool is required." });
    }
    const result = await executeKnowledgeTool(tool, args || {}, {
      companyName: req.company.company_key,
      kbKey: kb.kb_key,
      actor: actorFromAdminReq(req),
    });
    await audit(req, kb.id, `knowledge.tool.${tool}`, { tool });
    return res.json({ success: true, tool, result });
  })
);

export default router;
