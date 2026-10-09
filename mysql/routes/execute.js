// --------------------------
// EXECUTE ROUTES — run a live provider call through a stored credential
// (9Router executor equivalent, exposed as gateway endpoints). Chat returns
// the provider's completion in a normalized OpenAI-style shape; embeddings
// return the vector arrays. Credentials are resolved by credentialId OR
// providerKey (+ optional credentialKey/environmentKey).
// --------------------------
import express from "express";
import { AuditRepository } from "../repositories.js";
import * as Executor from "../services/provider-executor.js";
import { testProviderModels, DEFAULT_TEST_CONCURRENCY, DEFAULT_TEST_TIMEOUT_MS } from "../services/model-tester.js";
import { partitionSweep } from "../services/dead-model-pruner.js";
import { wrap } from "./helpers.js";
import { actorFromReq } from "./shared-helpers.js";

const router = express.Router();

async function audit(entry) {
  try {
    await AuditRepository.log(entry);
  } catch (err) {
    // audit is best-effort — never mask the execute result
    console.warn("Audit logging failed:", err.message);
  }
}

// POST /gateway/companies/:key/execute/chat
// Body: { credentialId? | providerKey + credentialKey? + environmentKey?,
//         model?, messages: [{ role, content }], options? }
router.post(
  "/companies/:key/execute/chat",
  wrap(async (req, res) => {
    const { credentialId, providerKey, credentialKey, environmentKey, model, messages, options } =
      req.body || {};
    const result = await Executor.executeChat({
      companyKey: req.params.key,
      credentialId,
      providerKey,
      credentialKey,
      environmentKey,
      model,
      messages,
      options,
    });
    await audit({
      companyId: result.companyId,
      ...actorFromReq(req),
      action: "provider.execute.chat",
      entityType: "credential",
      entityId: result.credentialId,
      afterState: { provider_key: result.providerKey, model: result.model },
      reason: "admin action",
      isSensitive: false,
    });
    const { companyId: _companyId, raw: _raw, ...safe } = result;
    return res.json({ success: true, ...safe });
  })
);

// POST /gateway/companies/:key/execute/embeddings
// Body: { credentialId? | providerKey + credentialKey? + environmentKey?,
//         model?, texts: string[] }
router.post(
  "/companies/:key/execute/embeddings",
  wrap(async (req, res) => {
    const { credentialId, providerKey, credentialKey, environmentKey, model, texts } = req.body || {};
    const result = await Executor.executeEmbeddings({
      companyKey: req.params.key,
      credentialId,
      providerKey,
      credentialKey,
      environmentKey,
      model,
      texts,
    });
    await audit({
      companyId: result.companyId,
      ...actorFromReq(req),
      action: "provider.execute.embeddings",
      entityType: "credential",
      entityId: result.credentialId,
      afterState: { provider_key: result.providerKey, model: result.model },
      reason: "admin action",
      isSensitive: false,
    });
    const { companyId: _companyId, raw: _raw, ...safe } = result;
    return res.json({ success: true, ...safe });
  })
);

// POST /gateway/companies/:key/execute/test-models
// Batch "Test All": one minimal chat completion against every catalog model of
// a provider (optionally filtered by category / modelIds) through the company's
// stored credential — bounded concurrency + per-model timeout. Used by the
// provider detail page's Test All button; the response lists free working
// models (0/0 pricing or free-tier key naming).
// Body: { credentialId?, category?, modelIds?, concurrency?, timeoutMs? }
router.post(
  "/companies/:key/execute/test-models",
  wrap(async (req, res) => {
    const { credentialId, category, modelIds, concurrency, timeoutMs, providerKey } = req.body || {};
    if (!providerKey) {
      throw new Executor.ExecutorError(400, "providerKey is required (the provider whose catalog models should be tested).");
    }
    const result = await testProviderModels({
      companyKey: req.params.key,
      providerKey,
      credentialId,
      category,
      modelIds: Array.isArray(modelIds) ? modelIds.map(Number).filter(Number.isFinite) : undefined,
      concurrency: clampInt(concurrency, 1, 8, DEFAULT_TEST_CONCURRENCY),
      timeoutMs: clampInt(timeoutMs, 1_000, 60_000, DEFAULT_TEST_TIMEOUT_MS),
    });
    await audit({
      ...actorFromReq(req),
      action: "provider.execute.test_models",
      entityType: "provider",
      entityId: null,
      afterState: { provider_key: result.providerKey, total: result.summary.total, ok: result.summary.ok },
      reason: "batch model test",
      isSensitive: false,
    }).catch(() => {});
    return res.json({ success: true, ...result });
  })
);

/** Small int clamp for the optional knobs (NaN/undefined → fallback). */
function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// POST /gateway/companies/:key/execute/prune-dead-models
// One-click cleanup after a Test-All sweep: run a fresh sweep, classify the
// failures, and DELETE only the models the provider definitively disowns
// ("Function '<uuid>': Not found" / bare 404). Timeouts and soft failures are
// kept. Body: { providerKey, credentialId?, concurrency?, timeoutMs?, dryRun? }
//  - dryRun (default true): classification only — returns what WOULD be deleted.
//  - dryRun:false: deletes the classified models (pricing + grants cascade),
//    skipping any model still referenced by an assistant or company config.
router.post(
  "/companies/:key/execute/prune-dead-models",
  wrap(async (req, res) => {
    const { credentialId, concurrency, timeoutMs, dryRun } = req.body || {};
    const providerKey = req.body?.providerKey;
    if (!providerKey) {
      throw new Executor.ExecutorError(400, "providerKey is required (the provider whose catalog models should be pruned).");
    }
    // 1. Fresh sweep — never trust a client-supplied failure list.
    const sweep = await testProviderModels({
      companyKey: req.params.key,
      providerKey,
      credentialId,
      category: "chat",
      concurrency: clampInt(concurrency, 1, 8, DEFAULT_TEST_CONCURRENCY),
      timeoutMs: clampInt(timeoutMs, 1_000, 60_000, DEFAULT_TEST_TIMEOUT_MS),
    });
    const { prune, keep, ok } = partitionSweep(sweep.results);

    // 2. Dry run — the preview the UI shows before confirming.
    if (dryRun !== false) {
      return res.json({
        success: true,
        providerKey,
        dryRun: true,
        summary: sweep.summary,
        prune: prune.map((r) => ({ modelId: r.modelId, modelKey: r.modelKey, modelName: r.modelName, error: r.error })),
        keep: keep.map((r) => ({ modelId: r.modelId, modelKey: r.modelKey, reason: /timeout after/i.test(r.error || "") ? "timeout (capacity/outage)" : "soft failure — model exists" })),
        okCount: ok.length,
      });
    }

    // 3. Real prune — reference-guarded deletes through the repository.
    const { ModelRepository } = await import("../repositories.js");
    const { getPool } = await import("../pool.js");
    const pool = await getPool();
    const deleted = [];
    const skipped = [];
    for (const r of prune) {
      if (r.modelId == null) {
        skipped.push({ modelKey: r.modelKey, reason: "no catalog row id" });
        continue;
      }
      const [refs] = await pool.query(
        "SELECT COUNT(*) AS n FROM assistants WHERE model_id = ? AND deleted_at IS NULL",
        [r.modelId]
      );
      if (refs[0].n > 0) {
        skipped.push({ modelKey: r.modelKey, reason: `${refs[0].n} assistant(s) still reference it` });
        continue;
      }
      try {
        await ModelRepository.remove(r.modelId);
        deleted.push({ modelId: r.modelId, modelKey: r.modelKey });
      } catch (err) {
        skipped.push({ modelKey: r.modelKey, reason: err.message });
      }
    }
    await audit({
      ...actorFromReq(req),
      action: "provider.execute.prune_dead_models",
      entityType: "provider",
      entityId: null,
      afterState: { provider_key: providerKey, deleted: deleted.length, skipped: skipped.length },
      reason: "prune dead models",
      isSensitive: false,
    }).catch(() => {});
    return res.json({
      success: true,
      providerKey,
      dryRun: false,
      summary: sweep.summary,
      deleted,
      skipped,
      kept: keep.length,
      okCount: ok.length,
      message: `Pruned ${deleted.length} dead model(s)${skipped.length ? `, skipped ${skipped.length}` : ""}; kept ${keep.length} timeout/soft-failure and ${ok.length} working.`,
    });
  })
);

export default router;
