// --------------------------
// INGESTION COMPOSITION ROOT
// Accepts { signal, companyName, kbKey } from the job runner and wires the
// pipeline with provider-agnostic adapters resolved from the Knowledge Base.
//
// KB path: resolveKbAdapters(kb, company, companyName) → { store, embedding, vector }
// Legacy path: resolveLegacyAdapters(companyName, config) → { store, embedding, vector }
//
// All I/O is adapter-mediated — the pure pipeline in ingest/pipeline.js never
// touches Cloudflare, S3, or any specific provider directly.
// --------------------------

import { createRegistry } from "./ingest/registry.js";
import { runIngestion } from "./ingest/pipeline.js";
import { capMaxUrls, resolveEffectiveScope } from "./ingest/scope.js";
import { resolveKbAdapters, resolveLegacyAdapters } from "./ingest/resolve.js";
import { createGraphExtractor, createLlmEntityExtractor } from "./ingest/graph-extract.js";
import { createSourceAdapter } from "./ingest/sources/index.js";
import { fireIngestionWebhook } from "./ingest/webhooks.js";
import { fetchPost, fetchPage, fetchWpByIds } from "./services/wp.js";

import { CompanyRepository, KbRepository, AuditRepository } from "./mysql/repositories.js";

import { getConfig } from "./config/index.js";
import { AbortError } from "./utils/helpers.js";
import { logToFile } from "./utils/logger.js";
import { NotFoundError, ValidationError } from "./shared/errors.js";

// --------------------------
// 🔹 Main
// --------------------------
export async function main({ signal, companyName, kbKey, maxPages, scope, setProgress } = {}) {
  // Hoisted so the single failure recorder in the catch below can reach them
  // from every stage — adapter config guards, source resolution, pipeline run.
  let kbId = null;
  let company = null;
  let webhookConfig = null; // { webhookUrl, webhookSecret, webhookEvents } from KB row
  let embedStatsRef = null; // EmbedFallbackStats from the KB adapter resolution
  let savedScope = null; // KB's saved scope from source_config (also caps URL discovery)
  let savedMaxUrls; // explicit source_config.maxUrls (undefined → adapter default)
  let ingestionScope = null; // effective run scope (request override wins over saved)

  try {
    console.log("🔧 Initializing...");

    let r2Prefix = "site";
    let chunkOptions = {};
    let registry = createRegistry(companyName);
    let kb = null;

    // 🔹 Resolve adapters from the Knowledge Base or legacy config
    let store, index;
    let sourceAdapter = { fetchPost, fetchPage, fetchWpByIds };

    if (kbKey) {
      // KB-driven path: resolve all infrastructure from the KB's resource bindings
      company = await CompanyRepository.findByKey(companyName);
      if (!company) throw new NotFoundError(`Company '${companyName}' not found.`, "COMPANY_NOT_FOUND");

      kb = await KbRepository.findByKey(company.id, kbKey);
      if (!kb) throw new NotFoundError(`Knowledge base '${kbKey}' not found.`, "KB_NOT_FOUND");
      kbId = kb.id;

      await KbRepository.setStatus(kb.id, "indexing");

      // Resolve all adapters from the KB's resource bindings (D11).
      // embedStats: counts KB-bound embedding fallbacks so a dead embedding
      // model is visible on the KB detail page (not just in server logs).
      const { createEmbedFallbackStats } = await import("./mysql/adapters/embed-fallback.js");
      const embedStats = createEmbedFallbackStats();
      const adapters = await resolveKbAdapters(kb, company, companyName, { embedStats });
      embedStatsRef = embedStats;

      // Config guards: a KB run must have both storage and vector resolved.
      // These throw BEFORE any work — the catch below records the failure on
      // the KB row so the portal shows WHY the run exited instead of a
      // silent fast-exit (the KB_VECTOR_NOT_CONFIGURED papercut).
      if (!adapters.store) {
        throw new ValidationError(
          adapters.storeError
            ? `Object storage is not configured for KB '${kbKey}': ${adapters.storeError}`
            : `Object storage is not configured for KB '${kbKey}'.`,
          "KB_STORAGE_NOT_CONFIGURED"
        );
      }
      if (!adapters.vector) {
        throw new ValidationError(
          adapters.vectorError
            ? `Vector store is not configured for KB '${kbKey}': ${adapters.vectorError}`
            : `Vector store is not configured for KB '${kbKey}'.`,
          "KB_VECTOR_NOT_CONFIGURED"
        );
      }

      r2Prefix = `kb/${kbKey}`;
      chunkOptions = { size: kb.chunk_size || 512 };
      registry = createRegistry(companyName, kbKey, { chunkSize: chunkOptions.size });

      store = adapters.store;
      index = adapters.vector;

      // Store webhook config for post-ingest notifications
      if (kb.webhook_url) {
        webhookConfig = {
          webhookUrl: kb.webhook_url,
          webhookSecret: kb.webhook_secret,
          webhookEvents: kb.webhook_events || "completed,failed",
        };
      }

      // Parse the KB's SAVED scope and resolve the EFFECTIVE run scope
      // BEFORE building the source adapter: when the run's scope is "limit N"
      // (saved docLimit, or a per-run request override), URL/sitemap discovery
      // is capped at N so a 1000-page sitemap is never fetched just to be
      // trimmed downstream — over-fetching is what ingested 288 docs for a
      // docLimit-3 KB (maxicert-web-auto, 2026-09-29). An explicit
      // { scope: "all" } request override still fetches the whole site: the
      // request defines the run; the saved config defines the default.
      if (kb?.source_config) {
        try {
          const cfg = typeof kb.source_config === "string" ? JSON.parse(kb.source_config) : kb.source_config;
          if (cfg.scope) savedScope = { scope: cfg.scope, limit: cfg.docLimit || undefined, items: cfg.selectedPages || undefined };
          if (cfg.maxUrls != null) savedMaxUrls = Number(cfg.maxUrls);
        } catch { /* ignore parse errors */ }
      }
      ingestionScope = resolveEffectiveScope(scope, savedScope, maxPages);
      const adapterMaxUrls = capMaxUrls(savedMaxUrls, ingestionScope);

      // Resolve the source adapter based on KB source_type
      sourceAdapter = createSourceAdapter({
        sourceType: kb.source_type,
        kb,
        companyName,
        wpAdapters: { fetchPost, fetchPage, fetchWpByIds },
        maxUrls: adapterMaxUrls,
      });
    } else {
      // Legacy path: company-level config (backward compatible)
      const config = getConfig(companyName);
      const adapters = resolveLegacyAdapters(companyName, config);

      if (!adapters.store) {
        throw new ValidationError("R2_BUCKET_NAME is not configured.", "R2_BUCKET_NOT_CONFIGURED");
      }
      if (!adapters.vector) {
        throw new ValidationError("VECTOR_INDEX is not configured.", "VECTOR_INDEX_NOT_CONFIGURED");
      }

      store = adapters.store;
      index = adapters.vector;
    }

    // 🔹 Graph adapter: optional Neo4j extraction during ingestion
    // Only when the KB explicitly enables GraphRAG (kb.enable_graph_rag)
    let graphAdapter = null;
    if (kbKey && company && kb?.enable_graph_rag) {
      try {
        const { getGraphConfig } = await import("./query/graph.js");
        const graphConfig = getGraphConfig(companyName);
      if (graphConfig) {
        graphAdapter = createGraphExtractor({
          companyName,
          kbKey,
          graphConfig,
          extractEntities: createLlmEntityExtractor(companyName),
          // Per-KB tuning (migration 023); null → global defaults (10 / 4).
          maxChunks: kb.graph_extract_max_chunks ?? null,
          concurrency: kb.graph_extract_concurrency ?? null,
        });
        const tuning =
          kb.graph_extract_max_chunks != null || kb.graph_extract_concurrency != null
            ? ` (maxChunks=${kb.graph_extract_max_chunks ?? "default"}, concurrency=${kb.graph_extract_concurrency ?? "default"})`
            : "";
        console.log(`🕸️ Graph extraction enabled for KB '${kbKey}'${tuning}`);
      }
      } catch {
        // Graph extraction is best-effort — missing deps or bad config
      }
    }

    // Normalize scope: prefer the explicit scope from the API request;
    // fall back to the KB's saved source_config; then legacy maxPages; then
    // "all". The KB path resolved this BEFORE creating the source adapter so
    // the discovery cap could use the same effective scope — keep the legacy
    // path's computation here.
    if (!ingestionScope) ingestionScope = resolveEffectiveScope(scope, savedScope, maxPages);

    const startedAt = Date.now();
    const stats = await runIngestion({
      fetchPost: sourceAdapter.fetchPost,
      fetchPage: sourceAdapter.fetchPage,
      fetchWpByIds: sourceAdapter.fetchWpByIds,
      store,
      index,
      registry,
      signal,
      companyName,
      r2Prefix,
      chunkOptions,
      scope: ingestionScope,
      setProgress,
      graphAdapter,
    });
    const durationMs = Date.now() - startedAt;

    if (kbId) {
      await KbRepository.setStatus(kbId, "active");
      // Persist ingestion stats on the KB row so the status endpoint
      // can return them without re-querying the registry.
      try {
        await KbRepository.setIngestionStats(kbId, {
          durationMs,
          documentsProcessed: stats.processed,
          documentsSkipped: stats.skipped,
          chunksCreated: stats.chunks,
          mode: ingestionScope.scope || "all",
          // KB-bound embedding fallback visibility (may be null on the legacy path)
          embeddingFallbacks: embedStatsRef?.fallbackBatches ?? null,
          embeddingAdapterError: embedStatsRef?.lastError ?? null,
        });
      } catch {
        /* stats persistence is best-effort */
      }
      try {
        await AuditRepository.log({
          actorType: "system",
          companyId: company?.id || null,
          action: "kb.ingest.completed",
          entityType: "kb",
          entityId: kbId,
          afterState: {
            mode: ingestionScope.scope || "all",
            documentsProcessed: stats.processed,
            documentsSkipped: stats.skipped,
            chunksCreated: stats.chunks,
            durationMs,
          },
          reason: "ingest completion",
        });
      } catch {
        /* audit is best-effort */
      }

      // Fire webhook on success (fire-and-forget)
      if (webhookConfig) {
        fireIngestionWebhook({
          ...webhookConfig,
          stats: {
            documentsProcessed: stats.processed,
            documentsSkipped: stats.skipped,
            chunksCreated: stats.chunks,
            durationMs,
            mode: ingestionScope.scope || "all",
          },
          kbKey,
          companyName,
          status: "completed",
        });
      }
    }
  } catch (error) {
    // Aborts own the lifecycle (stop/pause flows restore the status) — the
    // row is left as-is and the exit is clean.
    if (error instanceof AbortError || error.name === "AbortError") {
      console.log("🛑 Ingestion stopped by user.");
      logToFile("process.log", "🛑 Ingestion aborted by user");
      return; // clean exit — do not rethrow
    }

    // D12: record the failure on the KB row for ANY non-abort error after the
    // KB row was resolved — including pre-flight config guards (storage/vector
    // not configured, unknown source_type) that previously exited silently,
    // leaving the row stuck "indexing" with no visible error anywhere.
    if (kbId) {
      try {
        await KbRepository.setStatus(kbId, "error");
      } catch {
        /* best-effort */
      }
      try {
        await KbRepository.setIngestionError(kbId, error.message);
      } catch {
        /* best-effort */
      }
      try {
        await AuditRepository.log({
          actorType: "system",
          companyId: company?.id || null,
          action: "kb.ingest.failed",
          entityType: "kb",
          entityId: kbId,
          afterState: { error: error.message },
          reason: "ingest failure",
        });
      } catch {
        // audit is best-effort — never mask the real ingest error
      }

      // Fire webhook on failure (fire-and-forget)
      if (webhookConfig) {
        fireIngestionWebhook({
          ...webhookConfig,
          stats: {},
          kbKey,
          companyName,
          status: "failed",
          error: error.message,
        });
      }
    }

    console.error("Fatal error:", error);
    throw error;
  }
}
