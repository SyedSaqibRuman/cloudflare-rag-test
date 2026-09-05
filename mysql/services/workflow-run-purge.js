// --------------------------
// WORKFLOW RUN PURGE
// TTL-based cleanup of old workflow_runs rows to prevent unbounded growth.
// Default retention: 30 days. Configurable per company or globally.
// --------------------------

import { getPool } from "../pool.js";

const DEFAULT_RETENTION_DAYS = 30;
let purgeTimer = null;

/**
 * Purge old workflow runs for a company.
 * @param {number} companyId
 * @param {number} [retentionDays=30]
 * @returns {Promise<number>} number of rows deleted
 */
export async function purgeOldRuns(companyId, retentionDays = DEFAULT_RETENTION_DAYS) {
  const pool = await getPool();
  const [result] = await pool.query(
    `DELETE FROM workflow_runs
     WHERE company_id = ?
       AND completed_at IS NOT NULL
       AND completed_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [companyId, retentionDays]
  );
  return result.affectedRows || 0;
}

/**
 * Purge old runs for ALL companies (called by scheduler).
 * @param {number} [retentionDays=30]
 * @returns {Promise<number>} total rows deleted
 */
export async function purgeAllOldRuns(retentionDays = DEFAULT_RETENTION_DAYS) {
  const pool = await getPool();
  const [result] = await pool.query(
    `DELETE FROM workflow_runs
     WHERE completed_at IS NOT NULL
       AND completed_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [retentionDays]
  );
  return result.affectedRows || 0;
}

/**
 * Start periodic purge (daily at 3 AM).
 * Call once at server boot. The timer is unref'd so it won't keep the process alive.
 */
export function startPurgeScheduler(retentionDays = DEFAULT_RETENTION_DAYS) {
  if (purgeTimer) return;

  const runPurge = async () => {
    try {
      const deleted = await purgeAllOldRuns(retentionDays);
      if (deleted > 0) {
        console.log(`🧹 Purged ${deleted} old workflow runs (retention: ${retentionDays} days)`);
      }
    } catch (err) {
      console.error("⚠️ Workflow run purge failed:", err.message);
    }
  };

  // Calculate ms until next 3 AM
  const now = new Date();
  const next3AM = new Date(now);
  next3AM.setHours(3, 0, 0, 0);
  if (next3AM <= now) next3AM.setDate(next3AM.getDate() + 1);
  const delayMs = next3AM - now;

  // First run at 3 AM, then every 24 hours
  purgeTimer = setTimeout(async () => {
    await runPurge();
    purgeTimer = setInterval(runPurge, 24 * 60 * 60 * 1000);
    purgeTimer?.unref?.();
  }, delayMs);
  purgeTimer?.unref?.();
}

/**
 * Stop the purge scheduler.
 */
export function stopPurgeScheduler() {
  if (purgeTimer) {
    clearTimeout(purgeTimer);
    clearInterval(purgeTimer);
    purgeTimer = null;
  }
}
