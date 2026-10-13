// --------------------------
// INGESTION STATS RECORDER
// Persists last-run ingestion statistics (docs processed/skipped, chunks
// created, duration) on the KB row WHILE the run is in flight, not only after
// it completes. Previously `setIngestionStats` ran solely in ingest.js's
// success path — a run that was stopped, paused, failed, or killed by a
// server restart left `last_ingestion_*` NULL, so the portal's KB cards showed
// "Chunks — / Last run never" forever (2026-10-12 propularcert-prod-kb: run
// interrupted mid-flight by a restart, docs + vectors visible but no last-run
// stats recorded).
//
// Three seams:
//   onProgress(progress)  — throttled checkpoint during the run (survives a
//                           hard process kill within the throttle window)
//   finalize(stats)       — exact final write on clean completion
//   finalizePartial()     — flush captured progress on abort/error
//
// All writes are best-effort: a stats persistence failure must never mask the
// ingest's own outcome (same policy as the original inline call).
// --------------------------
import { KbRepository } from "../mysql/repositories.js";

/** Minimum ms between throttled mid-run checkpoints (default 10s). */
export const DEFAULT_CHECKPOINT_INTERVAL_MS = 10_000;

/**
 * Create a recorder bound to one KB row + one run.
 *
 * @param {Object} opts
 * @param {number} opts.kbId             KB row id (legacy non-KB runs pass null → no-ops)
 * @param {string} [opts.mode]           run scope label ("all" | "limit" | "selected")
 * @param {() => number} [opts.now]      clock (test seam; defaults to Date.now)
 * @param {number} [opts.checkpointIntervalMs] throttle window for onProgress
 * @param {Object} [opts.embedStats]     EmbedFallbackStats live counters (may mutate during the run)
 * @returns {{ onProgress: Function, finalize: Function, finalizePartial: Function, durationMs: Function }}
 */
export function createIngestionStatsRecorder({
  kbId,
  mode = null,
  now = Date.now,
  checkpointIntervalMs = DEFAULT_CHECKPOINT_INTERVAL_MS,
  embedStats = null,
} = {}) {
  const startedAt = now();
  let latest = null; // last progress snapshot ({ processed, skipped, chunks, phase })
  let lastCheckpointAt = 0;

  /** Duration of the run so far (or up to finalize). */
  const durationMs = () => now() - startedAt;

  const persist = async (stats) => {
    if (!kbId) return; // legacy company-wide runs have no KB row to stamp
    try {
      await KbRepository.setIngestionStats(kbId, {
        durationMs: durationMs(),
        documentsProcessed: stats.processed ?? 0,
        documentsSkipped: stats.skipped ?? 0,
        chunksCreated: stats.chunks ?? 0,
        mode,
        embeddingFallbacks: embedStats?.fallbackBatches ?? null,
        embeddingAdapterError: embedStats?.lastError ?? null,
      });
    } catch (err) {
      // Best-effort — never mask the ingest's own outcome.
      console.warn(`⚠️ Could not persist ingestion stats for KB #${kbId}: ${err.message}`);
    }
  };

  return {
    durationMs,

    /**
     * Record a progress snapshot and, when the throttle window has elapsed,
     * checkpoint it to the KB row. Called from the pipeline's reportProgress —
     * must stay synchronous and cheap.
     * @param {{ processed?: number, skipped?: number, chunks?: number, phase?: string }} progress
     */
    onProgress(progress) {
      if (!progress) return;
      latest = { ...progress };
      // Nothing ingested yet (still fetching/discovering) — nothing worth
      // stamping; don't overwrite a previous run's stats with zeros.
      if ((latest.processed ?? 0) === 0 && (latest.chunks ?? 0) === 0) return;
      const t = now();
      if (t - lastCheckpointAt < checkpointIntervalMs) return;
      lastCheckpointAt = t;
      void persist(latest);
    },

    /**
     * Exact final write — called on clean completion with the run's real
     * return stats (not the throttled snapshot).
     * @param {{ processed?: number, skipped?: number, chunks?: number }} stats
     */
    async finalize(stats) {
      if (!kbId || !stats) return;
      await persist(stats);
    },

    /**
     * Flush the captured partial snapshot — called on abort (stop/pause) and
     * on error so an interrupted run still stamps docs/chunks/last-run on the
     * KB row. No-ops when no work was observed (a run aborted during
     * discovery must not overwrite the previous run's stats with zeros).
     */
    async finalizePartial() {
      if (!kbId || !latest) return;
      if ((latest.processed ?? 0) === 0 && (latest.chunks ?? 0) === 0) return;
      await persist(latest);
    },
  };
}
