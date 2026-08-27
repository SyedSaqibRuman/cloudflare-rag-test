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

export default router;
