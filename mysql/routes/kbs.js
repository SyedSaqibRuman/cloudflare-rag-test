// --------------------------
// kbs routes (Clean Architecture: one router per resource group).
// Extracted verbatim from the former mysql/gateway-router.js monolith.
// --------------------------
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  KbRepository,
  ResourceRepository,
  ModelRepository,
  AuditRepository,
} from "../repositories.js";
import * as KbService from "../services/kb-service.js";
import { requireGatewayCompany } from "../services/company-scope.js";
import { startJob } from "../../cron/index.js";
import { countVectors, getVectorIndex } from "../../services/vectorize.js";
import { createRegistry } from "../../ingest/registry.js";
import { wrap } from "./helpers.js";
import { parsePagination, paginate } from "./pagination.js";
import { listLiveCloudflareResources } from "./cloudflare-resources.js";
import { listAllSourcePages } from "../../services/wp.js";
import { actorFromReq, requireKb, findRunningIngestJob, redactKb } from "./shared-helpers.js";

// Multer config: store uploads in a staging dir, max 10 MB per file
const UPLOAD_DIR = path.join(process.cwd(), "content", "_uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      // Sanitize: keep original name, prefix with timestamp to avoid collisions
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB (PDFs can be large)
  fileFilter: (_req, file, cb) => {
    const allowed = [".txt", ".md", ".html", ".htm", ".pdf", ".docx"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported file type '${ext}'. Allowed: ${allowed.join(", ")}`));
  },
});

/** Parse source_config from a KB row (handles both string and object forms). */
function parseSourceConfig(kb) {
  if (!kb.source_config) return {};
  if (typeof kb.source_config === "string") {
    try { return JSON.parse(kb.source_config); } catch { return {}; }
  }
  return kb.source_config;
}

const router = express.Router();

router.use("/kbs", requireGatewayCompany);

// GET /gateway/kbs/options — create-modal options in one round trip (D14).
// vectorResources/storageResources/graphResources stay the REGISTRY rows (the
// KB modal binds provider_resources ids); liveVectorResources/
// liveStorageResources are the account's ACTUAL Cloudflare resources (same
// type-aware resolver as the provider page cards) so the config page's Vector
// Index / R2 Bucket / Graph DB selectors can list real infrastructure even
// when nothing was provisioned as a row.
router.get(
  "/kbs/options",
  wrap(async (req, res) => {
    const [vectorResources, storageResources, graphResources, embeddingModels, liveVector, liveStorage] =
      await Promise.all([
        ResourceRepository.listByCompany(req.company.id, { resourceType: "vector_index" }),
        ResourceRepository.listByCompany(req.company.id, { resourceType: "object_bucket" }),
        ResourceRepository.listByCompany(req.company.id, { resourceType: "graph_database" }),
        ModelRepository.listByCategory("embedding"),
        // Best-effort: no Cloudflare connection (or an API error) degrades to [].
        listLiveCloudflareResources(req.company, "vector_index").catch(() => []),
        listLiveCloudflareResources(req.company, "object_bucket").catch(() => []),
      ]);
    return res.json({
      success: true,
      options: {
        vectorResources,
        storageResources,
        graphResources,
        embeddingModels,
        liveVectorResources: liveVector,
        liveStorageResources: liveStorage,
      },
    });
  })
);

// GET /gateway/kbs
router.get(
  "/kbs",
  wrap(async (req, res) => {
    const kbs = await KbRepository.listByCompany(req.company.id);
    const pagination = parsePagination(req);
    return paginate(res, kbs.map(redactKb), pagination, "kbs", "/gateway/kbs");
  })
);

// POST /gateway/kbs
router.post(
  "/kbs",
  wrap(async (req, res) => {
    const { kbId, kbKey } = await KbService.saveKb(req.company, req.body || {}, actorFromReq(req));
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
    const kb = await requireKb(req.company.id, req.params.key);
    return res.json({ success: true, kb: redactKb(kb) });
  })
);

// PUT /gateway/kbs/:key (kbKey is the route identity — not editable)
router.put(
  "/kbs/:key",
  wrap(async (req, res) => {
    const { kbId, kbKey } = await KbService.updateKb(
      req.company,
      req.params.key,
      req.body || {},
      actorFromReq(req)
    );
    return res.json({ success: true, message: `Knowledge base '${kbKey}' updated.`, kbId, kbKey });
  })
);

// DELETE /gateway/kbs/:key (hard delete, D10)
router.delete(
  "/kbs/:key",
  wrap(async (req, res) => {
    await KbService.removeKb(req.company, req.params.key, actorFromReq(req));
    return res.json({ success: true, message: `Knowledge base '${req.params.key}' deleted.` });
  })
);

// DELETE /gateway/kbs/:key/graph — delete this KB's entities + relationships
// from the Neo4j knowledge graph (manual cleanup button). Does NOT touch the
// KB row, vectors, or R2 storage.
router.delete(
  "/kbs/:key/graph",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    const result = await KbService.clearKbGraph(req.company, req.params.key);

    if (!result.configured) {
      return res.status(400).json({
        success: false,
        error: "No knowledge graph is configured for this company (NEO4J_URI / credentials missing).",
      });
    }
    if (!result.graphReachable) {
      return res.status(502).json({
        success: false,
        error: "Could not reach the knowledge graph. Check the Neo4j connection and try again.",
      });
    }

    await AuditRepository.log({
      ...actorFromReq(req),
      companyId: req.company.id,
      action: "kb.graph.deleted",
      entityType: "kb",
      entityId: kb.id,
      afterState: { kb_key: kb.kb_key, nodesDeleted: result.nodesDeleted, relationshipsDeleted: result.relationshipsDeleted },
      reason: "admin action",
    }).catch(() => {});

    const noun = result.nodesDeleted === 1 ? "entity" : "entities";
    return res.json({
      success: true,
      message:
        result.nodesDeleted > 0
          ? `Deleted ${result.nodesDeleted} ${noun} (${result.relationshipsDeleted} relationships) from the knowledge graph for '${req.params.key}'.`
          : `No graph data found for '${req.params.key}' — nothing to delete.`,
      ...result,
    });
  })
);

// PUT /gateway/kbs/:key/sources — configure ingestion sources (URLs / file list)
router.put(
  "/kbs/:key/sources",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);

    const { sourceType, urls, files } = req.body || {};

    // Validate source_type if provided
    if (sourceType && !["wordpress", "file", "url", "custom"].includes(sourceType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid source_type '${sourceType}'. Must be one of: wordpress, file, url, custom.`,
      });
    }

    // Build source_config from the request
    const sourceConfig = {};
    if (urls) {
      if (!Array.isArray(urls)) {
        return res.status(400).json({ success: false, error: "urls must be an array of strings." });
      }
      // Validate URLs
      for (const u of urls) {
        try {
          new URL(u);
        } catch {
          return res.status(400).json({ success: false, error: `Invalid URL: '${u}'.` });
        }
      }
      sourceConfig.urls = urls;
    }
    if (files) {
      if (!Array.isArray(files)) {
        return res.status(400).json({ success: false, error: "files must be an array of strings." });
      }
      sourceConfig.files = files;
    }
    if (req.body.concurrency != null) sourceConfig.concurrency = Number(req.body.concurrency);
    if (req.body.timeout != null) sourceConfig.timeout = Number(req.body.timeout);

    // Update source_type on the KB row
    if (sourceType) {
      await KbRepository.update(kb.id, { sourceType, sourceConfig });
    } else if (Object.keys(sourceConfig).length > 0) {
      await KbRepository.setSourceConfig(kb.id, sourceConfig);
    }

    await AuditRepository.log({
      ...actorFromReq(req),
      companyId: req.company.id,
      action: "kb.sources.updated",
      entityType: "kb",
      entityId: kb.id,
      afterState: { sourceType: sourceType || kb.source_type, sourceConfig },
      reason: "admin action",
    });

    return res.json({
      success: true,
      message: `Sources updated for '${req.params.key}'.`,
      sourceType: sourceType || kb.source_type,
      sourceConfig,
    });
  })
);

// GET /gateway/kbs/:key/documents — list processed documents from the ingestion registry
router.get(
  "/kbs/:key/documents",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    let entries = [];
    try {
      const registry = createRegistry(req.company.company_key, req.params.key);
      entries = registry.listEntries();
    } catch {
      entries = [];
    }
    // Sort by modifiedAt descending (most recent first)
    entries.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    return res.json({
      success: true,
      documents: entries,
      total: entries.length,
      sourceType: kb.source_type,
    });
  })
);

// POST /gateway/kbs/:key/documents — upload files for ingestion
router.post(
  "/kbs/:key/documents",
  upload.array("files", 20), // max 20 files per request
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: "No files uploaded." });
    }

    // Store file paths in source_config
    const uploadedPaths = req.files.map((f) => f.path);
    const existingConfig = parseSourceConfig(kb);
    const mergedFiles = [...(existingConfig.files || []), ...uploadedPaths];
    const sourceConfig = { ...existingConfig, files: mergedFiles };

    await KbRepository.update(kb.id, { sourceType: "file", sourceConfig });

    await AuditRepository.log({
      ...actorFromReq(req),
      companyId: req.company.id,
      action: "kb.documents.uploaded",
      entityType: "kb",
      entityId: kb.id,
      afterState: {
        filesUploaded: req.files.length,
        totalFiles: mergedFiles.length,
        fileNames: req.files.map((f) => f.originalname),
      },
      reason: "admin action",
    });

    return res.json({
      success: true,
      message: `${req.files.length} file(s) uploaded to '${req.params.key}'.`,
      files: req.files.map((f) => ({
        name: f.originalname,
        size: f.size,
        path: f.path,
      })),
      totalFiles: mergedFiles.length,
    });
  })
);

// DELETE /gateway/kbs/:key/documents — remove uploaded files and clear source_config.files
router.delete(
  "/kbs/:key/documents",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);

    // Remove files from disk
    const existingConfig = parseSourceConfig(kb);
    const files = existingConfig.files || [];
    let removed = 0;
    for (const f of files) {
      try {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
          removed++;
        }
      } catch {
        /* best-effort cleanup */
      }
    }

    await KbRepository.setSourceConfig(kb.id, { ...existingConfig, files: [] });

    return res.json({
      success: true,
      message: `Removed ${removed} file(s) from '${req.params.key}'.`,
      removed,
    });
  })
);

// POST /gateway/kbs/:key/ingest — start a standalone ingest job bound to the KB (F11)
router.post(
  "/kbs/:key/ingest",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    if (findRunningIngestJob(req.company.company_key, req.params.key)) {
      return res
        .status(409)
        .json({ success: false, error: `Ingest for '${req.params.key}' is already running.` });
    }
    const scope = req.body?.scope || null;
    const result = await startJob("ingest", req.company.company_key, { kbKey: req.params.key, scope });
    if (!result.success) {
      return res.status(409).json({ success: false, error: result.message });
    }
    await AuditRepository.log({
      ...actorFromReq(req),
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
    const kb = await requireKb(req.company.id, req.params.key);
    const runningJob = findRunningIngestJob(req.company.company_key, req.params.key);
    let documentCount;
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
    // Auto-recover stuck "indexing" status: if no running job exists but the
    // KB row is still marked "indexing", flip it to "active" (the job
    // completed but the status update failed silently).
    if (!runningJob && kb.status === "indexing") {
      try {
        await KbRepository.setStatus(kb.id, "active");
        kb.status = "active";
      } catch {
        /* best-effort recovery — proceed with original status */ }
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
        lastError: runningJob?.error ?? kb.last_error ?? null,
        // Ingestion statistics from the last completed run.
        lastIngestion: kb.last_ingestion_at
          ? {
              at: kb.last_ingestion_at,
              durationMs: kb.last_ingestion_duration_ms,
              documentsProcessed: kb.last_ingestion_documents_processed,
              documentsSkipped: kb.last_ingestion_documents_skipped,
              chunksCreated: kb.last_ingestion_chunks_created,
              mode: kb.last_ingestion_mode,
            }
          : null,
      },
    });
  })
);


// GET /gateway/kbs/:key/source-pages — list available WP pages/posts for selected-scope ingestion
router.get(
  "/kbs/:key/source-pages",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    if (kb.source_type !== "wordpress") {
      return res
        .status(400)
        .json({ success: false, error: "Source pages are only available for WordPress KBs." });
    }
    const pages = await listAllSourcePages(req.company.company_key, {
      contentTypes: ["page", "post"],
      maxPages: 50,
    });
    return res.json({ success: true, pages });
  })
);

// GET /gateway/kbs/:key/ingest-progress — real-time ingestion progress for a running job
router.get(
  "/kbs/:key/ingest-progress",
  wrap(async (req, res) => {
    // 404 gate — throws NotFoundError when the KB does not exist.
    await requireKb(req.company.id, req.params.key);
    const runningJob = findRunningIngestJob(req.company.company_key, req.params.key);
    if (!runningJob) {
      return res.json({ success: true, running: false, progress: null });
    }
    return res.json({
      success: true,
      running: true,
      progress: runningJob.progress || { processed: 0, skipped: 0, chunks: 0, discovered: 0, phase: "starting" },
      startedAt: runningJob.startedAt,
    });
  })
);

// POST /gateway/kbs/:key/webhook/test — send a test webhook payload to the configured URL
router.post(
  "/kbs/:key/webhook/test",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    if (!kb.webhook_url) {
      return res.status(400).json({ success: false, error: "No webhook URL configured for this KB." });
    }
    const { fireIngestionWebhook } = await import("../../ingest/webhooks.js");
    const payload = {
      webhookUrl: kb.webhook_url,
      webhookSecret: kb.webhook_secret,
      stats: {
        documentsProcessed: 0,
        documentsSkipped: 0,
        chunksCreated: 0,
        durationMs: 0,
        mode: "test",
      },
      kbKey: kb.kb_key,
      companyName: req.company.company_key,
      status: "completed",
    };
    try {
      await fireIngestionWebhook(payload);
      return res.json({ success: true, message: `Test webhook sent to ${kb.webhook_url}` });
    } catch (err) {
      return res.status(502).json({ success: false, error: `Webhook failed: ${err.message}` });
    }
  })
);

// POST /gateway/kbs/export — export one or all KBs as JSON
router.post(
  "/kbs/export",
  wrap(async (req, res) => {
    const { keys } = req.body || {};
    let kbs;
    if (Array.isArray(keys) && keys.length > 0) {
      kbs = [];
      for (const key of keys) {
        const kb = await KbRepository.findByKey(req.company.id, key);
        if (kb) kbs.push(kb);
      }
    } else {
      kbs = await KbRepository.listByCompany(req.company.id);
    }
    const exportData = kbs.map((kb) => {
      const copy = { ...kb };
      delete copy.id;
      delete copy.company_id;
      delete copy.created_at;
      delete copy.updated_at;
      delete copy.deleted_at;
      return copy;
    });
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="kb-export-${Date.now()}.json"`);
    return res.json({ success: true, count: exportData.length, items: exportData });
  })
);

// POST /gateway/kbs/import — import KBs from JSON
router.post(
  "/kbs/import",
  wrap(async (req, res) => {
    const { items, overwrite } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "items must be a non-empty array." });
    }
    let imported = 0;
    const errors = [];
    for (const item of items) {
      try {
        const key = item.kb_key;
        if (!key) { errors.push({ key: "(missing)", error: "Missing kb_key" }); continue; }
        const existing = await KbRepository.findByKey(req.company.id, key);
        if (existing && !overwrite) { errors.push({ key, error: "Already exists" }); continue; }
        if (existing) {
          await KbRepository.update(existing.id, item);
        } else {
          await KbRepository.create(req.company.id, item);
        }
        imported++;
        await AuditRepository.log({
          ...actorFromReq(req), companyId: req.company.id,
          action: existing ? "kb.import.updated" : "kb.import.created",
          entityType: "kb", entityId: key, afterState: { key },
        }).catch(() => {});
      } catch (err) { errors.push({ key: item.kb_key || "?", error: err.message }); }
    }
    return res.json({ success: true, imported, errors: errors.length > 0 ? errors : undefined });
  })
);

// ------------------------------------------------------------------
// 🔹 Custom Q&A — direct answers that override the RAG pipeline
// ------------------------------------------------------------------

// GET /gateway/kbs/:key/qa — list all custom Q&A pairs
router.get(
  "/kbs/:key/qa",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    const entries = await KbRepository.getCustomQa(kb.id);
    return res.json({ success: true, entries });
  })
);

// POST /gateway/kbs/:key/qa — add a new Q&A pair
router.post(
  "/kbs/:key/qa",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    const { question, answer, enabled, tags } = req.body || {};
    if (!question || !answer) {
      return res.status(400).json({ success: false, error: "question and answer are required." });
    }
    const entry = await KbRepository.addCustomQaEntry(kb.id, { question, answer, enabled, tags });
    await AuditRepository.log({
      ...actorFromReq(req), companyId: req.company.id,
      action: "kb.qa.created", entityType: "kb", entityId: kb.kb_key,
      afterState: { question, answer },
    }).catch(() => {});
    return res.status(201).json({ success: true, entry });
  })
);

// PUT /gateway/kbs/:key/qa/:entryId — update a Q&A pair
router.put(
  "/kbs/:key/qa/:entryId",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    const { entryId } = req.params;
    const { question, answer, enabled, tags } = req.body || {};
    const entry = await KbRepository.updateCustomQaEntry(kb.id, entryId, { question, answer, enabled, tags });
    if (!entry) {
      return res.status(404).json({ success: false, error: "Q&A entry not found." });
    }
    await AuditRepository.log({
      ...actorFromReq(req), companyId: req.company.id,
      action: "kb.qa.updated", entityType: "kb", entityId: kb.kb_key,
      afterState: { entryId, question: entry.question },
    }).catch(() => {});
    return res.json({ success: true, entry });
  })
);

// DELETE /gateway/kbs/:key/qa/:entryId — delete a Q&A pair
router.delete(
  "/kbs/:key/qa/:entryId",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    const { entryId } = req.params;
    const deleted = await KbRepository.deleteCustomQaEntry(kb.id, entryId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Q&A entry not found." });
    }
    await AuditRepository.log({
      ...actorFromReq(req), companyId: req.company.id,
      action: "kb.qa.deleted", entityType: "kb", entityId: kb.kb_key,
      beforeState: { entryId },
    }).catch(() => {});
    return res.json({ success: true, message: "Q&A entry deleted." });
  })
);

// POST /gateway/kbs/:key/qa/match — test if a question matches any custom Q&A (for debugging)
router.post(
  "/kbs/:key/qa/match",
  requireGatewayCompany,
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    const { question } = req.body || {};
    if (!question) {
      return res.status(400).json({ success: false, error: "question is required." });
    }
    const match = await KbRepository.matchCustomQa(kb.id, question);
    return res.json({ success: true, match, matched: !!match });
  })
);

export default router;
