// --------------------------
// SHARED STATUS HELPERS
// Maps KB status strings to UI color tones, plus a UI-only lifecycle
// derivation that combines status + is_active + running jobs + errors
// into ONE meaningful user-facing state.
// --------------------------

/**
 * Map a raw KB status string to a UI color tone for <Badge> and <StatCard>.
 *
 * @param {string} status  KB status: "active" | "indexing" | "error" | "archived" | unknown
 * @returns {string}  Tailwind tone key: "green" | "amber" | "red" | "slate"
 */
export function statusTone(status) {
  const map = {
    active: "green",
    indexing: "amber",
    error: "red",
    archived: "slate",
  };
  return map[status] || "slate";
}

/**
 * Derive the single user-facing lifecycle state for a KB. The DB keeps
 * `status`, `is_active`, and the live job state separate — this collapses
 * them into one meaningful badge so the UI never shows two conflicting
 * states (e.g. "active" while an ingest is running).
 *
 * Priority order (highest wins):
 *   Indexing  — an ingest job is currently running for this KB
 *   PausedRun — an ingest run is suspended (pause/resume, resumable)
 *   Error     — last ingest failed
 *   Paused    — KB exists but is_active = false
 *   Active    — ingested at least once successfully
 *   Ready     — created and configured, never ingested
 *
 * @param {Object|null} kb       KB row (needs is_active).
 * @param {Object|null} status   KB status payload (needs status, inProgress,
 *                               paused, documentCount, lastError).
 * @returns {{ label: string, tone: string }}  Badge label + tone key.
 */
export function kbLifecycle(kb, status) {
  if (status?.inProgress) return { label: "Indexing", tone: "amber" };
  if (status?.paused) return { label: "PausedRun", tone: "amber" };
  if (status?.status === "error" || status?.lastError) return { label: "Error", tone: "red" };
  if (kb && kb.is_active === false) return { label: "Paused", tone: "slate" };
  if (status?.status === "active" || (status?.documentCount ?? 0) > 0) {
    return { label: "Active", tone: "green" };
  }
  return { label: "Ready", tone: "indigo" };
}
