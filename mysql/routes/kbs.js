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
  CredentialRepository,
  AuditRepository,
} from "../repositories.js";
import * as KbService from "../services/kb-service.js";
import { requireGatewayCompany } from "../services/company-scope.js";
import { startJob } from "../../cron/index.js";
import { countVectors, getVectorIndex } from "../../services/vectorize.js";
import { resolveKbAdapters } from "../../ingest/resolve.js";
import { getChunk, listObjectKeys } from "../../services/r2.js";
import { createRegistry } from "../../ingest/registry.js";
import { documentChunkPrefix, assembleDocumentPreview } from "../../ingest/preview.js";
import { validateRestSourceConfig } from "../../ingest/sources/rest.js";
import { discoverSitemaps, SitemapError } from "../../ingest/sources/sitemap/index.js";
import { wrap } from "./helpers.js";
import { parsePagination, paginate } from "./pagination.js";
import { listLiveCloudflareResources } from "./cloudflare-resources.js";
import { listAllSourcePages } from "../../services/wp.js";
import { actorFromReq, requireKb, findRunningIngestJob, findPausedIngestJob, redactKb } from "./shared-helpers.js";
import { splitVectorCapable } from "../../shared/vector-capability.js";
import { partitionEmbeddingModels } from "../../shared/embedding-capability.js";
import { KB_ENABLED_SOURCE_TYPES, isSourceTypeEnabled } from "../../shared/catalog-enums.js";
import { normalizeWebsiteUrl } from "../../ingest/sources/sitemap/index.js";
import { assessKbIndexHealth, evaluateKbIndexHealth } from "../services/kb-health.js";
import { isNonCfVectorProvider } from "../../query/kb-retrieval.js";


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
    const [vectorResources, storageResources, graphResources, embeddingModels, liveVector, liveStorage, credentials] =
      await Promise.all([
        ResourceRepository.listByCompany(req.company.id, { resourceType: "vector_index" }),
        ResourceRepository.listByCompany(req.company.id, { resourceType: "object_bucket" }),
        ResourceRepository.listByCompany(req.company.id, { resourceType: "graph_database" }),
        ModelRepository.listByCategory("embedding"),
        // Best-effort: no Cloudflare connection (or an API error) degrades to [].
        listLiveCloudflareResources(req.company, "vector_index").catch(() => []),
        listLiveCloudflareResources(req.company, "object_bucket").catch(() => []),
        // Which providers this company can actually call. The embedding
        // dropdown offers only models whose provider has an adapter AND a
        // credential here (shared/embedding-capability.js) — the catalog is
        // global, so without this an admin can bind a Jina/Voyage model to a
        // company with no such connection and only discover it at ingest time.
        // Best-effort: a failure leaves the list empty (nothing offered), which
        // is the safe direction — "Company default (config)" always remains.
        CredentialRepository.listByCompany(req.company.id, { includeInactive: false }).catch(() => []),
      ]);
    // Annotate which registry resources can actually serve vector ingestion.
    // Storage-only providers (cloudflare_r2, aws_s3, …) have no vector adapter,
    // so the wizard filters them out of the Vector Store dropdown and the KB
    // service rejects binding them (shared/vector-capability.js).
    const { capable: capableVector, incapable: incapableVector } = splitVectorCapable(vectorResources);
    // Same idea for the Embedding Model dropdown (Storage & Search step).
    const { available: availableEmbedding, unavailable: unavailableEmbedding } =
      partitionEmbeddingModels(embeddingModels, {
        credentialProviderKeys: (credentials || []).map((c) => c.provider_key),
      });
    return res.json({
      success: true,
      options: {
        vectorResources: capableVector,
        incapableVectorResources: incapableVector,
        storageResources,
        graphResources,
        embeddingModels,
        // The filtered list the wizard renders; `unavailableEmbeddingModels` is
        // returned so the UI can explain a short/empty list instead of leaving
        // the admin wondering (it names the provider to connect).
        availableEmbeddingModels: availableEmbedding,
        unavailableEmbeddingModels: unavailableEmbedding,
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

// POST /gateway/kbs/discover-website — sitemap discovery PREVIEW (spec §30):
// given only a website URL, run the robots.txt → fallbacks → index-crawl
// discovery and report what would be ingested, without creating anything.
// Placed before the /kbs POST so it can never be captured by a future /:key
// route pattern; still registered before /kbs/:key GET for the same reason.
router.post(
  "/kbs/discover-website",
  wrap(async (req, res) => {
    const websiteUrl = String(req.body?.websiteUrl || "").trim();
    if (!websiteUrl) {
      return res.status(400).json({ success: false, error: "websiteUrl is required." });
    }
    try {
      const result = await discoverSitemaps(websiteUrl, {
        limits: { maxUrls: 50 }, // preview cap — the real ingest uses the KB's own limits
      });
      const sitemapUrl = result.discoveredSitemaps?.[0] || null;
      return res.json({
        success: true,
        website: result.websiteUrl,
        robotsUrl: result.robotsUrl,
        robotsFound: result.robotsFound ?? Boolean(result.robotsUrl),
        sitemapFound: Boolean(sitemapUrl),
        sitemapUrl,
        sitemapCount: result.stats?.sitemapCount ?? result.discoveredSitemaps?.length ?? 0,
        urlCount: result.stats?.urlCount ?? result.urls?.length ?? 0,
        sampleUrls: (result.urls || []).slice(0, 10).map((u) => u.url),
        truncated: result.truncated ?? null,
      });
    } catch (err) {
      // Bad website URL (400) vs network/unusable site (502) — the wizard maps
      // both to friendly copy; raw errors stay in the server log.
      const status = err instanceof SitemapError ? 400 : 502;
      console.error(`❌ Website discovery preview failed for '${websiteUrl}': ${err.message}`);
      return res.status(status).json({
        success: false,
        error:
          status === 400
            ? `Invalid website URL: ${err.message}`
            : `Could not check this website for a sitemap: ${err.message}`,
      });
    }
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

// GET /gateway/kbs/health — stale-index detection across the company's KBs.
// Flags KBs whose last successful ingest predates their bound Vectorize
// index's created_on — proof the index was deleted and recreated after the
// data was written, i.e. every vector from that ingest is gone while the
// registry still lists the documents as processed (the 2026-09-29
// max-test-index failure mode). Only KBs bound to a cloudflare_vectorize
// resource row are checked: the created_on map comes from the live CF index
// list, and a KB bound to Qdrant/Pinecone/etc. must stay uncheckable rather
// than be misreported as "index missing". Registered BEFORE /kbs/:key so it
// is never captured by the :key pattern.
router.get(
  "/kbs/health",
  wrap(async (req, res) => {
    const kbs = await KbRepository.listByCompany(req.company.id);
    const vectorResources = await ResourceRepository.listByCompany(req.company.id, {
      resourceType: "vector_index",
    });
    // CF-family predicate: the ask path routes every non-(pinecone/qdrant/
    // weaviate/openai) provider through the CF fast-path (query/kb-retrieval.js
    // isNonCfVectorProvider), so umbrella `cloudflare` rows count as checkable
    // here too — a strict provider_key === "cloudflare_vectorize" match would
    // misroute KBs bound via the umbrella connection to the uncheckable bucket.
    const providerKeyByResourceId = new Map(
      vectorResources.map((r) => [r.id, r.provider_key])
    );
    const cfResourceIds = new Set(
      [...providerKeyByResourceId.entries()]
        .filter(([, providerKey]) => !isNonCfVectorProvider(providerKey))
        .map(([id]) => id)
    );

    // Partition: CF-Vectorize-bound KBs go through the module evaluation;
    // KBs bound to another provider are appended as uncheckable with an
    // honest reason (a Qdrant/Pinecone index name would never appear in the
    // CF list, so evaluating it against that list would produce a false
    // "index missing"). KBs with no resource row fall back to the company's
    // config VECTOR_INDEX — the same legacy binding the status route uses.
    const cfBound = [];
    const notCheckable = [];
    for (const kb of kbs) {
      let vectorIndexName;
      if (cfResourceIds.has(kb.vector_resource_id)) {
        vectorIndexName = kb.vector_external_id || getVectorIndex(req.company.company_key);
      } else if (kb.vector_resource_id != null) {
        vectorIndexName = kb.vector_external_id || null; // bound, but not ours to check
      } else {
        vectorIndexName = kb.vector_external_id || getVectorIndex(req.company.company_key) || null;
      }
      const input = {
        kbKey: kb.kb_key,
        vectorIndexName,
        lastIngestionAt: kb.last_ingestion_at,
        documentsProcessed: kb.last_ingestion_documents_processed,
      };
      if (kb.vector_resource_id != null && !cfResourceIds.has(kb.vector_resource_id)) {
        const base = evaluateKbIndexHealth(input, null);
        const providerKey = providerKeyByResourceId.get(kb.vector_resource_id);
        base.reason = `Bound to ${providerKey || "a non-Cloudflare"} vector store — only Cloudflare Vectorize indexes can be checked for stale recreations.`;
        notCheckable.push(base);
      } else {
        cfBound.push(input);
      }
    }

    // Live CF index list → { name: created_on }. A failed call degrades to
    // null (every CF-bound KB becomes uncheckable — the check never guesses);
    // an empty success is real (the account has no indexes → indexMissing).
    let byName = null;
    let indexCount = 0;
    if (cfBound.length > 0) {
      try {
        const live = await listLiveCloudflareResources(req.company, "vector_index");
        byName = {};
        for (const idx of live || []) {
          if (idx?.name) {
            byName[idx.name] = idx.createdAt ?? null;
            indexCount++;
          }
        }
      } catch {
        byName = null; // live list unavailable — uncheckable, never flagged
      }
    }

    const assessed = assessKbIndexHealth(cfBound, byName);
    const kbNameByKey = new Map(kbs.map((k) => [k.kb_key, k.kb_name]));
    const enrich = (r) => ({ ...r, kbName: kbNameByKey.get(r.kbKey) || r.kbKey });

    return res.json({
      success: true,
      checked: cfBound.length > 0 && byName != null,
      indexCount,
      healthy: assessed.healthy.map(enrich),
      flagged: assessed.flagged.map(enrich),
      uncheckable: [...assessed.uncheckable, ...notCheckable].map(enrich),
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

    const { sourceType, urls, files, rest, websiteUrl } = req.body || {};

    // Validate source_type if provided. Withdrawn types (shared/catalog-enums.js)
    // are rejected UNLESS this KB already uses that exact value — re-saving a
    // legacy WordPress/custom KB's sources is a no-op, not a new selection.
    if (sourceType && !KbService.SOURCE_TYPES.includes(sourceType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid source_type '${sourceType}'. Must be one of: ${KB_ENABLED_SOURCE_TYPES.join(", ")}.`,
      });
    }
    if (sourceType && !isSourceTypeEnabled(sourceType) && sourceType !== kb.source_type) {
      return res.status(400).json({
        success: false,
        error:
          `source_type '${sourceType}' is no longer available. ` +
          `Use one of: ${KB_ENABLED_SOURCE_TYPES.join(", ")}.`,
      });
    }

    // Validate the rest (custom source) block if provided
    let restError = null;
    if (rest != null) {
      const check = validateRestSourceConfig(rest);
      if (!check.ok) restError = check.errors.join(" ");
    } else if (sourceType === "custom") {
      restError =
        'source_type "custom" requires a "rest" block in the request body ' +
        '(e.g. { "sourceType": "custom", "rest": { "endpoint": "…" } }).';
    }
    if (restError) {
      return res.status(400).json({ success: false, error: restError });
    }

    // Build source_config from the request
    const sourceConfig = {};
    // A website URL needs no sitemap: discovery is automatic at ingest time.
    // Validated here so a typo fails the request, not a background job.
    if (websiteUrl != null) {
      if (typeof websiteUrl !== "string" || !websiteUrl.trim()) {
        return res.status(400).json({ success: false, error: "websiteUrl must be a non-empty string." });
      }
      try {
        normalizeWebsiteUrl(websiteUrl);
      } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
      }
      sourceConfig.websiteUrl = websiteUrl.trim();
    }
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
    if (req.body.maxUrls != null) sourceConfig.maxUrls = Number(req.body.maxUrls);
    if (req.body.maxDepth != null) sourceConfig.maxDepth = Number(req.body.maxDepth);
    if (rest != null) sourceConfig.rest = rest;

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

// GET /gateway/kbs/:key/documents/preview/:docKey — preview one INGESTED document.
//
// :docKey is the registry key written by the pipeline ("<type>-<slug>", e.g.
// "post-my-page"). The document's chunks live in object storage under
// <r2Prefix>/<slugified key>/chunk-N.json (r2Prefix "kb/<kbKey>" for KB runs,
// "site" for legacy runs — try KB prefix first, then legacy). Chunks are
// fetched, ordered by chunkIndex, and joined into one readable document.
router.get(
  "/kbs/:key/documents/preview/:docKey",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    const docKey = String(req.params.docKey || "");
    if (!/^[/\w.-]+$/.test(docKey)) {
      return res.status(400).json({ success: false, error: "Invalid document key." });
    }

    // Confirm the document was actually ingested (defends against probing).
    const registry = createRegistry(req.company.company_key, req.params.key);
    if (!registry.toJSON()[docKey]) {
      return res.status(404).json({ success: false, error: "Document not found in this KB's ingestion registry." });
    }

    // Resolve the bucket the same way ingest does: KB storage binding →
    // external id, then the company-config fallback (legacy "site" runs).
    let bucket = kb.storage_external_id || null;
    if (!bucket) {
      try {
        const config = parseSourceConfig(kb);
        bucket = config.bucket || null;
      } catch { /* fall through */ }
    }

    const prefixes = [`kb/${kb.kb_key}`, "site"].map((p) => documentChunkPrefix(p, docKey));
    let keys = [];
    let usedPrefix = null;
    for (const prefix of prefixes) {
      keys = await listObjectKeys(prefix, req.company.company_key, bucket || undefined);
      if (keys.length) {
        usedPrefix = prefix;
        break;
      }
    }
    if (!keys.length) {
      return res.status(404).json({ success: false, error: "No stored chunks found for this document." });
    }

    // Fetch chunks in registry order (chunk-N), parse each payload.
    keys.sort((a, b) => {
      const na = Number(a.match(/chunk-(\d+)\.json$/)?.[1] ?? 0);
      const nb = Number(b.match(/chunk-(\d+)\.json$/)?.[1] ?? 0);
      return na - nb;
    });
    const payloads = [];
    for (const key of keys) {
      const chunk = await getChunk(key, req.company.company_key);
      if (chunk) payloads.push(chunk);
    }
    if (!payloads.length) {
      return res.status(404).json({ success: false, error: "Stored chunks could not be read." });
    }

    const preview = assembleDocumentPreview(payloads);
    return res.json({
      success: true,
      kind: "ingested",
      name: docKey,
      storagePrefix: usedPrefix,
      ...preview,
    });
  })
);

// GET /gateway/kbs/:key/documents/:fileId — preview a single uploaded file.
//
// :fileId is the basename stored in source_config.files (URL-safe filename).
// The file lives on disk under content/<company>/uploads/<fileId>. For DOCX
// we extract the plain text via mammoth (so the modal can render it without
// shipping a docx renderer); for everything else we stream the raw bytes
// with the correct Content-Type so the browser can preview / download.
router.get(
  "/kbs/:key/documents/:fileId",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);

    // Locate the file in source_config (defends against path traversal).
    const config = parseSourceConfig(kb);
    const files = Array.isArray(config.files) ? config.files : [];
    const safeId = path.basename(req.params.fileId);
    const match = files.find((f) => path.basename(f) === safeId);
    if (!match) {
      return res.status(404).json({ success: false, error: "File not found in KB." });
    }
    if (!fs.existsSync(match)) {
      return res.status(410).json({ success: false, error: "File no longer exists on disk." });
    }

    const ext = path.extname(safeId).toLowerCase();

    // DOCX → return extracted text (lightweight server-side conversion).
    if (ext === ".docx") {
      try {
        const mammoth = (await import("mammoth")).default;
        const { value } = await mammoth.extractRawText({ path: match });
        return res.json({
          success: true,
          kind: "docx-text",
          name: safeId,
          text: value || "",
        });
      } catch (err) {
        return res.status(500).json({ success: false, error: `Failed to read DOCX: ${err.message}` });
      }
    }

    // Everything else → stream the raw bytes with a sensible Content-Type.
    const MIME = {
      ".pdf": "application/pdf",
      ".md": "text/markdown; charset=utf-8",
      ".txt": "text/plain; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".htm": "text/html; charset=utf-8",
    };
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(safeId)}"`);
    fs.createReadStream(match).pipe(res);
  })
);

// DELETE /gateway/kbs/:key/documents/:fileId — remove a single uploaded file
router.delete(
  "/kbs/:key/documents/:fileId",
  wrap(async (req, res) => {
    const kb = await requireKb(req.company.id, req.params.key);
    const config = parseSourceConfig(kb);
    const files = Array.isArray(config.files) ? config.files : [];
    const safeId = path.basename(req.params.fileId);
    const next = files.filter((f) => path.basename(f) !== safeId);
    if (next.length === files.length) {
      return res.status(404).json({ success: false, error: "File not found." });
    }
    const target = files.find((f) => path.basename(f) === safeId);
    try { if (target && fs.existsSync(target)) fs.unlinkSync(target); } catch { /* best-effort */ }
    await KbRepository.update(kb.id, {
      sourceType: "file",
      sourceConfig: { ...config, files: next },
    });
    await AuditRepository.log({
      ...actorFromReq(req),
      companyId: req.company.id,
      action: "kb.document.deleted",
      entityType: "kb",
      entityId: kb.id,
      afterState: { file: safeId, remaining: next.length },
      reason: "admin action",
    });
    return res.json({ success: true, message: `File '${safeId}' removed.`, totalFiles: next.length });
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
    // vector count is best-effort (F12): null on API failure. KBs bound to a
    // vector resource (Qdrant/Pinecone/OpenAI/Weaviate) count through their
    // adapter stack — the CF fast-path below only knows Vectorize indexes and
    // would fail (null) for any non-CF store. Falls back to the legacy CF
    // count for KBs without a vector resource.
    let vectorCount = null;
    if (kb.vector_resource_id) {
      try {
        const adapters = await resolveKbAdapters(kb, req.company, req.company.company_key);
        vectorCount = adapters.vector ? await adapters.vector.countVectors() : null;
      } catch {
        vectorCount = null; // best-effort
      }
    }
    if (vectorCount == null) {
      try {
        const indexName = kb.vector_external_id || getVectorIndex(req.company.company_key);
        if (indexName) vectorCount = await countVectors(indexName, req.company.company_key);
      } catch {
        vectorCount = null;
      }
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

    const pausedJob = findPausedIngestJob(req.company.company_key, req.params.key);
    return res.json({
      success: true,
      status: {
        kbKey: kb.kb_key,
        status: kb.status,
        inProgress: Boolean(runningJob),
        paused: Boolean(pausedJob),
        pausedAt: pausedJob?.pausedAt ?? null,
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
              // KB-bound embedding fallback visibility (migration 030):
              // fallbacks > 0 means the bound embedding model failed and CF
              // embeddings were used instead — surfaced as a warning card.
              embeddingFallbacks: kb.last_ingestion_embedding_fallbacks ?? null,
              embeddingAdapterError: kb.last_ingestion_embedding_error ?? null,
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
    const pausedJob = findPausedIngestJob(req.company.company_key, req.params.key);
    if (!runningJob) {
      if (pausedJob) {
        // Paused: report the last-known progress with running:false + paused:true
        // so the UI can render a resumable paused state instead of nothing.
        return res.json({
          success: true,
          running: false,
          paused: true,
          progress: pausedJob.progress || null,
          startedAt: pausedJob.startedAt,
          pausedAt: pausedJob.pausedAt,
        });
      }
      return res.json({ success: true, running: false, paused: false, progress: null });
    }
    return res.json({
      success: true,
      running: true,
      paused: false,
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
