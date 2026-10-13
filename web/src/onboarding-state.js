// --------------------------
// ONBOARDING REAL-STATE PROBES (pure ESM — shared logic, testable)
// The Dashboard onboarding wizard auto-detects which steps the selected
// company's workspace already satisfies. This module holds the detection
// logic; OnboardingWizard.jsx consumes it.
//
// DELIBERATE DIVERGENCE from the setup checkpoints
// (routes/cloudflare/setup-status.js + shared/setup-checkpoints.js):
//   - Checkpoints verify CONFIG INTEGRITY — a revoked Cloudflare token
//     (empty CLOUDFLARE_API_TOKEN in the RAG config) flips the "AI Provider"
//     checkpoint back to incomplete, because /ask will actually fail.
//   - The wizard checks WORKSPACE ARTIFACTS — step 2 ("Connect AI Services")
//     passes when ≥1 provider credential ROW exists (gateway
//     encrypted_credentials), regardless of whether that credential still
//     mirrors into the RAG config store. The wizard is a product tour, not a
//     health check; SetupCheckpoints is the health check.
// Both report on the same company and may legitimately disagree — these
// probes answer "did the user do the tour step", not "is the tenant healthy".
//
// Probe failure semantics: any API error yields `null` ("unknown") for that
// probe only — a failing endpoint never marks a step done or not-done.
// --------------------------

/**
 * Normalize the list-endpoint envelopes used across the gateway API:
 * { pagination: { total } } | { items: [...] } | a bare array.
 * @param {*} d
 * @returns {number}
 */
export function countEnvelopeItems(d) {
  if (Array.isArray(d)) return d.length;
  const total = d?.pagination?.total;
  if (Number.isFinite(total)) return total;
  return Array.isArray(d?.items) ? d.items.length : 0;
}

/**
 * Wizard step id → setup-checkpoint id (shared/setup-checkpoints.js).
 * Steps whose work is fully covered by a checkpoint deep-link into it
 * instead of re-listing the same guidance; steps with no checkpoint row
 * keep their own action button. Every wizard step now has a checkpoint
 * counterpart (the setup bar gained an "AI Assistant" step between
 * content and chat).
 */
export const STEP_TO_CHECKPOINT = {
  content: "content",
  "ai-setup": "credentials",
  assistant: "assistant",
  test: "chat",
};

/**
 * Resolve the deep-link target for a wizard step.
 * @param {string} stepId  Wizard step id
 * @returns {string|null}  Checkpoint id, or null when the step is tour-only.
 */
export function checkpointForStep(stepId) {
  return STEP_TO_CHECKPOINT[stepId] || null;
}

/**
 * Compute the deep-link wiring for every wizard step from live checkpoint
 * status. A step RENDERS AS A CHECKPOINT LINK when a checkpoint covers it;
 * the rest of the row (progress persistence, detected badges) is unchanged —
 * completion still comes from the workspace probes, the link just points at
 * the authoritative bar instead of duplicating its guidance.
 *
 * @param {Object} [status]  GET /cloudflare/setup-status payload
 *   ({ steps: [{ id, label, route, done, detail }], next, complete })
 * @returns {(stepId: string) => { checkpointId: string, label: string, route: string, done: boolean, isNext: boolean, open: boolean } | null}
 */
export function checkpointLinkResolver(status) {
  const byId = new Map((status?.steps || []).map((s) => [s.id, s]));
  const nextId = status?.next?.id || null;
  return (stepId) => {
    const checkpointId = STEP_TO_CHECKPOINT[stepId];
    if (!checkpointId) return null;
    const step = byId.get(checkpointId);
    // No status (fetch failed, checkpoints hidden) → step keeps its own action.
    if (!step) return null;
    return {
      checkpointId,
      label: step.label,
      route: step.route,
      done: !!step.done,
      isNext: nextId === checkpointId,
      open: !step.done,
    };
  };
}

/**
 * Probe the workspace for real artifacts via the injected fetchers.
 * @param {Object} opts
 * @param {string|null} opts.company    Selected company (null → no probes)
 * @param {Function} [opts.listKbs]     (company, params) => Promise<envelope>
 * @param {Function} [opts.listCredentials] (company) => Promise<array|envelope>
 * @param {Function} [opts.listAssistants]  (company, params) => Promise<envelope>
 * @returns {Promise<{content: boolean|null, "ai-setup": boolean|null, assistant: boolean|null}>}
 *   true = step satisfied by workspace state, null = probe failed (unknown).
 */
export async function checkWorkspaceState({
  company,
  listKbs,
  listCredentials,
  listAssistants,
}) {
  if (!company) return { content: null, "ai-setup": null, assistant: null };

  const probe = (p) => p.catch(() => null);
  const [kbs, creds, assistants] = await Promise.all([
    probe(listKbs(company, { page: 1, perPage: 1 }).then((d) => countEnvelopeItems(d) > 0)),
    probe(listCredentials(company).then((cs) => (Array.isArray(cs) ? cs.length : countEnvelopeItems(cs)) > 0)),
    probe(listAssistants(company, { page: 1, perPage: 1 }).then((d) => countEnvelopeItems(d) > 0)),
  ]);
  return { content: kbs, "ai-setup": creds, assistant: assistants };
}
