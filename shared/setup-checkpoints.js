// --------------------------
// SETUP CHECKPOINTS (pure model)
// The company configuration process as an ordered checklist:
//   workspace → AI provider credentials → vector index → document storage →
//   content ingested → AI assistant → chat tested.
// The backend route (routes/cloudflare/setup-status.js) maps real company
// state onto this model; the portal renders the returned steps as a
// horizontal stepper. Pure data-in/data-out — no I/O, node --test friendly.
// --------------------------

/**
 * Ordered checkpoint definitions. `route` is a portal hash-route id
 * (web/src/components/layout/nav.js) the step navigates to when clicked.
 */
export const SETUP_CHECKPOINT_DEFS = [
  {
    id: "workspace",
    label: "Workspace",
    route: "companies",
    description: "Company workspace created",
  },
  {
    id: "credentials",
    label: "AI Provider",
    route: "catalog",
    description: "Connect provider credentials (Cloudflare token & account ID)",
  },
  {
    id: "vector-index",
    label: "Vector Index",
    route: "config",
    description: "Select the search index for retrieval",
  },
  {
    id: "storage",
    label: "Document Storage",
    route: "config",
    description: "Select the object storage bucket for document chunks",
  },
  {
    id: "content",
    label: "Ingest Content",
    route: "ingestion",
    description: "Create a knowledge base and ingest your content",
  },
  {
    id: "assistant",
    label: "AI Assistant",
    route: "assistants",
    description: "Create an AI assistant with a persona, model, and knowledge base",
  },
  {
    id: "chat",
    label: "Test Chat",
    route: "ask",
    description: "Ask a question in Test AI to verify the full pipeline",
  },
];

/**
 * Compute the checkpoint steps from a flat state snapshot.
 * @param {Object<string, boolean>} state — done-flags keyed by checkpoint id
 *   (workspace / credentials / vector-index / storage / content / assistant /
 *   chat).
 * @param {Object<string, string>} [details] — optional per-id detail strings
 *   shown under each step (e.g. the selected index name).
 * @returns {{ steps: Array, complete: boolean, doneCount: number, next: Object|null }}
 *   `steps` follows SETUP_CHECKPOINT_DEFS order with { id, label, route,
 *   description, done, detail }. `next` is the first incomplete step (or null
 *   when everything is done).
 */
export function computeSetupCheckpoints(state = {}, details = {}) {
  const steps = SETUP_CHECKPOINT_DEFS.map((def) => ({
    ...def,
    done: !!state[def.id],
    detail: details[def.id] || "",
  }));
  const next = steps.find((s) => !s.done) || null;
  return {
    steps,
    next,
    doneCount: steps.length - steps.filter((s) => !s.done).length,
    complete: !next,
  };
}
