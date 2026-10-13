// --------------------------
// GLOBAL TOAST STORE (module-level pub/sub)
// One app-wide notification channel: any module — React pages via useToast()
// or the api.js fetch wrapper — pushes toasts here and the single
// <ToastViewport> mounted in App.jsx renders them.
//
// Design notes:
// - Module-level state + listener set, NOT React context: the api() wrapper
//   emits success/error toasts for every mutation without prop-drilling or
//   wrapping the tree, and pages outside a provider (Login) still get toasts.
// - A toast stack (max 4) instead of one slot: rapid successive actions (bulk
//   deletes, wizard save + navigate) each stay visible for their full ttl
//   instead of the older one being silently replaced.
// - Every toast is mirrored to logs/UI.logs on the server (fire-and-forget)
//   so the admin keeps an audit trail of UI notifications.
//
// logUiToast is lazy-imported (not a top-level import) so this module stays
// importable by bare `node --test` (no Vite resolver, no fetch side effects) —
// same pattern the wiki validator's pure-ESM modules use.
// --------------------------

const MAX_TOASTS = 4;
const DEFAULT_TTL = 3500;
// Identical messages within this window collapse to one toast. This kills the
// double-toast from the api() auto-toaster + a page's own notify(res.message)
// of the same server string (both fire for one action).
const DEDUPE_WINDOW_MS = 1200;

let toasts = [];
let nextId = 1;
const listeners = new Set();
const recent = new Map(); // msg → last pushed timestamp

function emit() {
  for (const listener of listeners) listener(toasts);
}

/**
 * Push a toast. Same signature as the legacy notify(msg, tone) so existing
 * call sites keep working.
 * @param {string} msg  Message text ("" or null clears — legacy compat)
 * @param {"green"|"red"|"amber"|"indigo"|"cyan"|"slate"} [tone="green"]
 * @param {{ ttl?: number }} [opts]  ttl overrides the auto-dismiss delay
 * @returns {number} toast id (usable with dismissToast)
 */
export function pushToast(msg, tone = "green", { ttl = DEFAULT_TTL } = {}) {
  if (!msg) return null; // legacy notify("") cleared the single toast
  const text = String(msg);
  const now = Date.now();
  const last = recent.get(text) || 0;
  if (now - last < DEDUPE_WINDOW_MS) return null; // duplicate — swallow
  recent.set(text, now);
  // Prune old dedupe entries so the map can't grow unbounded.
  for (const [k, t] of recent) if (now - t > DEDUPE_WINDOW_MS) recent.delete(k);

  const id = nextId++;
  toasts = [...toasts, { id, msg: text, tone }].slice(-MAX_TOASTS);
  emit();
  import("./api")
    .then((m) => m.logUiToast(text, tone))
    .catch(() => {}); // fire-and-forget — toast UX never depends on the audit log
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl);
  return id;
}

/** Remove one toast by id (close button, or auto-dismiss timer). */
export function dismissToast(id) {
  const before = toasts.length;
  toasts = toasts.filter((t) => t.id !== id);
  if (toasts.length !== before) emit();
}

/** Subscribe to toast-list changes. Returns the unsubscribe function. */
export function subscribeToasts(listener) {
  listeners.add(listener);
  listener(toasts); // sync new subscribers immediately
  return () => listeners.delete(listener);
}

/**
 * Subscribe to just the NEWEST toast, as { msg, tone } | null — the shape the
 * legacy useToast().toast consumers render. Used by the useToast hook so old
 * <Toast message={toast?.msg} /> sites keep working.
 */
export function subscribeNewestToast(listener) {
  return subscribeToasts((list) => {
    const newest = list.length ? list[list.length - 1] : null;
    listener(newest ? { msg: newest.msg, tone: newest.tone } : null);
  });
}
