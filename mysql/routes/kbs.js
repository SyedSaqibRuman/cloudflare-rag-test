// --------------------------
// kbs routes (Clean Architecture: one router per resource group).
// Extracted verbatim from the former mysql/gateway-router.js monolith.
// --------------------------
import express from "express";
import {
  KbRepository,
  ResourceRepository,
  ModelRepository,
  AuditRepository,
} from "../repositories.js";
import * as KbService from "../services/kb-service.js";
import { requireGatewayCompany } from "../services/company-scope.js";
import { startJob, getRunningJobs } from "../../cron/index.js";
import { countVectors, getVectorIndex } from "../../services/vectorize.js";
import { createRegistry } from "../../ingest/registry.js";
import { wrap } from "./helpers.js";

const router = express.Router();

router.use("/kbs", requireGatewayCompany);

// GET /gateway/kbs/options — create-modal options in one round trip (D14)
router.get(
  "/kbs/options",
  wrap(async (req, res) => {
    const [vectorResources, storageResources, embeddingModels] = await Promise.all([
      ResourceRepository.listByCompany(req.company.id, { resourceType: "vector_index" }),
      ResourceRepository.listByCompany(req.company.id, { resourceType: "object_bucket" }),
      ModelRepository.listByCategory("embedding"),
    ]);
    return res.json({
      success: true,
      options: { vectorResources, storageResources, embeddingModels },
    });
  })
);

// GET /gateway/kbs
router.get(
  "/kbs",
  wrap(async (req, res) => {
    const kbs = await KbRepository.listByCompany(req.company.id);
    return res.json({ success: true, kbs });
  })
);

// POST /gateway/kbs
router.post(
  "/kbs",
  wrap(async (req, res) => {
    const actor = { actorType: "admin", actorId: req.auth?.user || null, actorIp: req.ip };
    const { kbId, kbKey } = await KbService.saveKb(req.company, req.body || {}, actor);
    return res.status(201).json({
      success: true,
      message: `Knowledge base '${kbKey}' created.`,
      kbId,
      kbKey,
    });
  })
);

// GET /gateway/kbs/:key
router.get(
  "/kbs/:key",
  wrap(async (req, res) => {
    const kb = await KbRepository.findByKey(req.company.id, req.params.key);
    if (!kb) {
      return res
        .status(404)
        .json({ success: false, error: `Knowledge base '${req.params.key}' not found.` });
    }
    return res.json({ success: true, kb });
  })
);

// PUT /gateway/kbs/:key (kbKey is the route identity — not editable)
router.put(
  "/kbs/:key",
  wrap(async (req, res) => {
    const actor = { actorType: "admin", actorId: req.auth?.user || null, actorIp: req.ip };
    const { kbId, kbKey } = await KbService.updateKb(
      req.company,
      req.params.key,
      req.body || {},
      actor
    );
    return res.json({ success: true, message: `Knowledge base '${kbKey}' updated.`, kbId, kbKey });
  })
);

// DELETE /gateway/kbs/:key (hard delete, D10)
router.delete(
  "/kbs/:key",
  wrap(async (req, res) => {
    const actor = { actorType: "admin", actorId: req.auth?.user || null, actorIp: req.ip };
    await KbService.removeKb(req.company, req.params.key, actor);
    return res.json({ success: true, message: `Knowledge base '${req.params.key}' deleted.` });
  })
);

// POST /gateway/kbs/:key/ingest — start a standalone ingest job bound to the KB (F11)
router.post(
  "/kbs/:key/ingest",
  wrap(async (req, res) => {
    const kb = await KbRepository.findByKey(req.company.id, req.params.key);
    if (!kb) {
      return res
        .status(404)
        .json({ success: false, error: `Knowledge base '${req.params.key}' not found.` });
    }
    if (
      getRunningJobs().some(
        (j) => j.jobId === "ingest" && j.companyName === req.company.company_key && j.kbKey === req.params.key
      )
    ) {
      return res
        .status(409)
        .json({ success: false, error: `Ingest for '${req.params.key}' is already running.` });
    }
    const result = await startJob("ingest", req.company.company_key, { kbKey: req.params.key });
    if (!result.success) {
      return res.status(409).json({ success: false, error: result.message });
    }
    await AuditRepository.log({
      actorType: "admin",
      actorId: req.auth?.user || null,
      companyId: req.company.id,
      action: "kb.ingest.started",
      entityType: "kb",
      entityId: kb.id,
      reason: "admin action",
    });
    return res.json({
      success: true,
      message: `Ingest for '${req.params.key}' started.`,
      startedAt: result.startedAt,
    });
  })
);

// GET /gateway/kbs/:key/status
router.get(
  "/kbs/:key/status",
  wrap(async (req, res) => {
    const kb = await KbRepository.findByKey(req.company.id, req.params.key);
    if (!kb) {
      return res
        .status(404)
        .json({ success: false, error: `Knowledge base '${req.params.key}' not found.` });
    }
    const runningJob = getRunningJobs().find(
      (j) => j.jobId === "ingest" && j.companyName === req.company.company_key && j.kbKey === req.params.key
    );
    let documentCount = 0;
    try {
      documentCount = createRegistry(req.company.company_key, req.params.key).countDocuments();
    } catch {
      documentCount = 0;
    }
    // vector count is best-effort (F12): null on API failure; resolve the index
    // the same way ingest does (KB resource override → config fallback).
    let vectorCount = null;
    try {
      const indexName = kb.vector_external_id || getVectorIndex(req.company.company_key);
      if (indexName) vectorCount = await countVectors(indexName, req.company.company_key);
    } catch {
      vectorCount = null;
    }
    return res.json({
      success: true,
      status: {
        kbKey: kb.kb_key,
        status: kb.status,
        inProgress: Boolean(runningJob),
        // The DDL has no last_sync column — updated_at is the last status flip (F12).
        lastSyncAt: kb.updated_at,
        documentCount,
        vectorCount,
        lastError: runningJob?.error ?? null,
      },
    });
  })
);


export default router;
