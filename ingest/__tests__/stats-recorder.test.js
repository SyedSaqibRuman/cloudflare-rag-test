// --------------------------
// INGESTION STATS RECORDER TESTS — locks the KB-card fix: last-run stats
// (docs/chunks/last-run) must be persisted on the KB row DURING the run and
// on abort/error, not only after a clean completion. A run killed by a server
// restart, stopped, or failed used to leave last_ingestion_* NULL → the
// portal's KB cards showed "Chunks — / Last run never" forever
// (2026-10-12 propularcert-prod-kb regression).
// Pure module — KbRepository stubbed in-place, no MySQL, no network.
// Run with: node --test ingest/__tests__/stats-recorder.test.js
// --------------------------
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// env.js freezes MYSQL_* at import time — dummies BEFORE the repository import
// so the lazy pool is never touched (setIngestionStats stubbed below).
process.env.MYSQL_HOST = "127.0.0.1";
process.env.MYSQL_DATABASE = "gateway_test";
process.env.MYSQL_USER = "test";
process.env.MYSQL_PASSWORD = "test";
process.env.APP_ENCRYPTION_KEY = "cd".repeat(32);

const { KbRepository } = await import("../../mysql/repositories.js");
const { createIngestionStatsRecorder, DEFAULT_CHECKPOINT_INTERVAL_MS } = await import(
  "../stats-recorder.js"
);

/** Stub setIngestionStats, returning { calls, restore }. */
function stubStats() {
  const calls = [];
  const original = KbRepository.setIngestionStats;
  KbRepository.setIngestionStats = async (kbId, stats) => {
    calls.push([kbId, stats]);
  };
  return { calls, restore: () => { KbRepository.setIngestionStats = original; } };
}

/** Controllable clock. */
function clock(startMs = 1_000_000) {
  let t = startMs;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe("ingest stats recorder", () => {
  test("clean completion: finalize writes the run's exact return stats", async () => {
    const { calls, restore } = stubStats();
    const clk = clock();
    try {
      const rec = createIngestionStatsRecorder({
        kbId: 42,
        mode: "limit",
        now: clk.now,
        embedStats: { fallbackBatches: 2, lastError: "model offline" },
      });
      clk.advance(5_000);
      await rec.finalize({ processed: 24, skipped: 6, chunks: 1028 });
      assert.equal(calls.length, 1);
      const [kbId, stats] = calls[0];
      assert.equal(kbId, 42);
      assert.deepEqual(stats, {
        durationMs: 5_000,
        documentsProcessed: 24,
        documentsSkipped: 6,
        chunksCreated: 1028,
        mode: "limit",
        embeddingFallbacks: 2,
        embeddingAdapterError: "model offline",
      });
    } finally {
      restore();
    }
  });

  test("mid-run: onProgress checkpoints after the throttle window, not before", async () => {
    const { calls, restore } = stubStats();
    const clk = clock();
    try {
      const rec = createIngestionStatsRecorder({ kbId: 7, mode: "all", now: clk.now });
      // Discovery phase (0 processed, 0 chunks) never stamps — a run aborted
      // during fetching must not overwrite the previous run's stats with zeros.
      rec.onProgress({ processed: 0, skipped: 0, chunks: 0, phase: "fetching" });
      assert.equal(calls.length, 0);

      rec.onProgress({ processed: 1, skipped: 0, chunks: 12, phase: "processing" });
      assert.equal(calls.length, 1, "first real progress checkpoints immediately");

      // Second progress inside the throttle window is captured but not written.
      rec.onProgress({ processed: 2, skipped: 0, chunks: 24, phase: "processing" });
      assert.equal(calls.length, 1);

      clk.advance(DEFAULT_CHECKPOINT_INTERVAL_MS);
      rec.onProgress({ processed: 3, skipped: 1, chunks: 36, phase: "processing" });
      assert.equal(calls.length, 2);
      assert.equal(calls[1][1].documentsProcessed, 3);
      assert.equal(calls[1][1].chunksCreated, 36);
    } finally {
      restore();
    }
  });

  test("abort/error: finalizePartial flushes captured work", async () => {
    const { calls, restore } = stubStats();
    const clk = clock();
    try {
      const rec = createIngestionStatsRecorder({ kbId: 9, mode: "all", now: clk.now });
      rec.onProgress({ processed: 2, skipped: 0, chunks: 18, phase: "processing" }); // checkpoint #1
      clk.advance(DEFAULT_CHECKPOINT_INTERVAL_MS + 1);
      rec.onProgress({ processed: 3, skipped: 0, chunks: 27, phase: "processing" }); // checkpoint #2
      await rec.finalizePartial();
      assert.equal(calls.length, 3);
      const last = calls[2][1];
      assert.equal(last.documentsProcessed, 3);
      assert.equal(last.chunksCreated, 27);
      assert.equal(last.durationMs, DEFAULT_CHECKPOINT_INTERVAL_MS + 1);
    } finally {
      restore();
    }
  });

  test("finalizePartial is a no-op when no work was observed", async () => {
    const { calls, restore } = stubStats();
    try {
      const rec = createIngestionStatsRecorder({ kbId: 9, mode: "all" });
      // Never progressed, or only the zero-stats discovery snapshot.
      await rec.finalizePartial();
      rec.onProgress({ processed: 0, skipped: 2, chunks: 0, phase: "fetching" });
      await rec.finalizePartial();
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });

  test("legacy runs (no kbId) never write", async () => {
    const { calls, restore } = stubStats();
    try {
      const rec = createIngestionStatsRecorder({ kbId: null, mode: "all" });
      rec.onProgress({ processed: 5, skipped: 0, chunks: 50, phase: "processing" });
      await rec.finalizePartial();
      await rec.finalize({ processed: 5, skipped: 0, chunks: 50 });
      assert.equal(calls.length, 0);
    } finally {
      restore();
    }
  });

  test("a setIngestionStats failure never throws back into the pipeline", async () => {
    const original = KbRepository.setIngestionStats;
    KbRepository.setIngestionStats = async () => {
      throw new Error("MySQL down");
    };
    try {
      const rec = createIngestionStatsRecorder({ kbId: 3, mode: "all" });
      rec.onProgress({ processed: 1, skipped: 0, chunks: 4, phase: "processing" });
      await rec.finalizePartial(); // must not reject
      await rec.finalize({ processed: 1, skipped: 0, chunks: 4 }); // must not reject
    } finally {
      KbRepository.setIngestionStats = original;
    }
  });
});
