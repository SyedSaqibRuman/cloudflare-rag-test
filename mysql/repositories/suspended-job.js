// --------------------------
// suspended_jobs — persistence for paused standalone jobs.
// A paused job is written here when it enters the `suspended` state and the
// row is deleted when it is resumed (or explicitly stopped). On boot the
// lifecycle re-registers every row as a suspended in-memory job so paused
// ingests survive server restarts. MySQL unavailable → fire-and-forget
// failures are logged; the in-memory map remains the source of truth at
// runtime, the table only adds cross-restart durability.
// --------------------------
import { getPool } from "../pool.js";
import { mapRow } from "./helpers.js";
import { logToFile } from "../../utils/logger.js";

export const SuspendedJobRepository = {
  /** Insert or update the suspended row for a job key (idempotent). */
  async upsert({ jobId, companyName, kbKey, startedAt, pausedAt, progress }) {
    try {
      const pool = await getPool();
      await pool.query(
        `INSERT INTO suspended_jobs
           (job_id, company_name, kb_key, started_at, paused_at, progress)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           started_at = VALUES(started_at),
           paused_at  = VALUES(paused_at),
           progress   = VALUES(progress)`,
        [
          jobId,
          companyName ?? null,
          kbKey ?? null,
          startedAt,
          pausedAt,
          progress ? JSON.stringify(progress) : null,
        ]
      );
    } catch (err) {
      // Best-effort durability — pause still works without MySQL.
      logToFile("error.log", `⚠️ suspended_jobs upsert failed: ${err.message}`);
    }
  },

  /** Delete the suspended row for a job key (resume / stop). */
  async remove(jobId, companyName, kbKey) {
    try {
      const pool = await getPool();
      await pool.query(
        `DELETE FROM suspended_jobs WHERE job_id = ? AND company_name <=> ? AND kb_key <=> ?`,
        [jobId, companyName ?? null, kbKey ?? null]
      );
    } catch (err) {
      logToFile("error.log", `⚠️ suspended_jobs remove failed: ${err.message}`);
    }
  },

  /** List every persisted suspended job (boot restore). */
  async listAll() {
    try {
      const pool = await getPool();
      const [rows] = await pool.query(`SELECT * FROM suspended_jobs ORDER BY id`);
      return rows.map(mapRow);
    } catch (err) {
      logToFile("error.log", `⚠️ suspended_jobs list failed: ${err.message}`);
      return [];
    }
  },
};
