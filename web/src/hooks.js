import { useEffect, useState, useCallback } from "react";
import { pushToast, subscribeNewestToast } from "./toast-store";

// Shared toast hook — thin wrapper over the GLOBAL toast store
// (toast-store.js + <ToastViewport /> mounted once in App.jsx). Every portal
// page uses this instead of its own local notify/setToast pair, so toasts:
//   • survive page-internal navigation (they render in the App-level viewport)
//   • stack (up to 4) instead of the older one being replaced mid-flight
//   • are recorded to logs/UI.logs on the server (fire-and-forget) — the
//     admin gets an audit trail of every UI notification.
// `toast` is { msg, tone } — the newest toast, kept for the legacy
// <Toast message={toast?.msg} tone={toast?.tone} /> render sites.
// notify(msg, tone) keeps its original signature.
export function useToast(duration = 3500) {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    // Mirror the newest global toast into this hook's local view so legacy
    // <Toast message={toast?.msg} /> renders stay meaningful.
    return subscribeNewestToast(setToast);
  }, []);

  const notify = useCallback(
    (msg, tone = "green") => {
      pushToast(msg, tone, { ttl: duration });
    },
    [duration]
  );

  return { toast, notify };
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || "dashboard");

  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || "dashboard");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((r) => {
    // Set hash — in most browsers this fires hashchange synchronously.
    window.location.hash = r;
    // Fallback: if the hashchange listener didn't pick it up (e.g. the
    // assignment was a no-op because the hash was already equal), force the
    // route state so navigation still completes.
    setRoute(r || "dashboard");
  }, []);

  return [route, navigate];
}

// --------------------------
// 🔹 usePagination HOOK
// Manages page + perPage state for paginated API calls.
// Usage:
//   const { page, perPage, setPage, setPerPage, paginationParams } = usePagination();
//   const data = await fetchItems({ ...paginationParams });
// --------------------------
export function usePagination(initialPerPage = 50) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPageState] = useState(initialPerPage);

  const setPerPage = useCallback((n) => {
    setPerPageState(n);
    setPage(1);
  }, []);

  const resetPage = useCallback(() => setPage(1), []);

  const paginationParams = { page, perPage };

  return { page, perPage, setPage, setPerPage, resetPage, paginationParams };
}

export function usePoll(fn, interval = 5000, deps = []) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // fn is async by contract; a rejection must not become an unhandled
    // promise rejection (callers render their own error state).
    Promise.resolve(fn()).catch((e) => console.error("poll failed:", e));
    const id = setInterval(() => {
      // Skip ticks while the tab is hidden — no wasted requests when the
      // portal is backgrounded; the next visible tick catches up.
      if (!document.hidden) setTick((t) => t + 1);
    }, interval);
    return () => clearInterval(id);
    // Deps are injected by the caller by design (dynamic list), and fn/interval
    // are stable-by-contract for a polling hook — hence the disable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
}
