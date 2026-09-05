// --------------------------
// WORKFLOW EVENT BUS
// Internal event emitter for workflow triggers.
// Fires events that workflows can subscribe to:
//   - ingest.complete (KB ingestion finished)
//   - credential.rotated (API key rotated)
//
// Best-effort by design — event handling must never block the caller.
// --------------------------

/** @type {Map<string, Set<{ workflowKey: string, companyName: string, handler: Function }>>} */
const listeners = new Map();

/**
 * Register a workflow to listen for an event.
 * @param {string} event — e.g. "ingest.complete", "credential.rotated"
 * @param {string} workflowKey
 * @param {string} companyName
 * @param {Function} handler — async (payload) => void
 */
export function onWorkflowEvent(event, workflowKey, companyName, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add({ workflowKey, companyName, handler });
}

/**
 * Unregister a workflow's event listener.
 */
export function offWorkflowEvent(event, workflowKey, companyName) {
  const set = listeners.get(event);
  if (!set) return;
  for (const entry of set) {
    if (entry.workflowKey === workflowKey && entry.companyName === companyName) {
      set.delete(entry);
    }
  }
}

/**
 * Emit an event to all registered workflows.
 * Best-effort — errors are logged but never thrown.
 *
 * @param {string} event
 * @param {object} payload — event-specific data
 * @param {string} [companyName] — if set, only notify workflows for this company
 */
export async function emitWorkflowEvent(event, payload, companyName = null) {
  const set = listeners.get(event);
  if (!set || set.size === 0) return;

  for (const entry of set) {
    if (companyName && entry.companyName !== companyName) continue;
    try {
      // Best-effort — never block the caller
      entry.handler(payload).catch?.((err) => {
        console.error(`⚠️ Workflow event handler error [${event}/${entry.workflowKey}]:`, err.message);
      });
    } catch (err) {
      console.error(`⚠️ Workflow event handler error [${event}/${entry.workflowKey}]:`, err.message);
    }
  }
}

/**
 * List all registered event subscriptions (for debugging/admin).
 * @returns {Array<{ event: string, workflowKey: string, companyName: string }>}
 */
export function listSubscriptions() {
  const result = [];
  for (const [event, set] of listeners) {
    for (const entry of set) {
      result.push({ event, workflowKey: entry.workflowKey, companyName: entry.companyName });
    }
  }
  return result;
}
