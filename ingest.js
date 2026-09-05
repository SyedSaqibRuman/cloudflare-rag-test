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
  try {
    console.log("🔧 Initializing...");

    let r2Prefix = "site";
    let chunkOptions = {};
    let registry = createRegistry(companyName);
    let kbId = null;
    let company = null;
    let kb = null;
    let webhookConfig = null; // { webhookUrl, webhookSecret } from KB row

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

      // Resolve all adapters from the KB's resource bindings (D11)
      const adapters = await resolveKbAdapters(kb, company, companyName);

      // Config guards: a KB run must have both storage and vector resolved
      if (!adapters.store) {
        throw new ValidationError(`Object storage is not configured for KB '${kbKey}'.`, "KB_STORAGE_NOT_CONFIGURED");
      }
      if (!adapters.vector) {
        throw new ValidationError(`Vector store is not configured for KB '${kbKey}'.`, "KB_VECTOR_NOT_CONFIGURED");
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

      // Resolve the source adapter based on KB source_type
      sourceAdapter = createSourceAdapter({
        sourceType: kb.source_type,
        kb,
        companyName,
        wpAdapters: { fetchPost, fetchPage, fetchWpByIds },
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
          });
          console.log(`🕸️ Graph extraction enabled for KB '${kbKey}'`);
        }
      } catch {
        // Graph extraction is best-effort — missing deps or bad config
      }
    }

    try {
      // Normalize scope: prefer the explicit scope from the API request;
      // fall back to the KB's saved source_config (set during creation/edit);
      // then fall back to legacy maxPages; finally default to "all".
      let kbScope = null;
      if (kb?.source_config) {
        try {
          const cfg = typeof kb.source_config === "string" ? JSON.parse(kb.source_config) : kb.source_config;
          if (cfg.scope) kbScope = { scope: cfg.scope, limit: cfg.docLimit || undefined, items: cfg.selectedPages || undefined };
        } catch { /* ignore parse errors */ }
      }
      const ingestionScope = scope || kbScope || (maxPages ? { scope: "limit", limit: maxPages } : { scope: "all" });

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
      // KB status flip + audit on failure (D12); abort leaves the row as-is.
      if (kbId && !(error instanceof AbortError || error.name === "AbortError")) {
        await KbRepository.setStatus(kbId, "error");
        try {
          await KbRepository.setIngestionError(kbId, error.message);
        } catch {
          /* best-effort */
        }
        try {
          await AuditRepository.log({
            actorType: "system",
            companyId: company.id,
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
      throw error;
    }
  } catch (error) {
    if (error instanceof AbortError || error.name === "AbortError") {
      console.log("🛑 Ingestion stopped by user.");
      logToFile("process.log", "🛑 Ingestion aborted by user");
      return; // clean exit — do not rethrow
    }
    console.error("Fatal error:", error);
    throw error;
  }
}
