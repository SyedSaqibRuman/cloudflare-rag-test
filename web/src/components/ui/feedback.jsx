import { useEffect, useState } from "react";
import { cx, tones } from "./helpers";
import { subscribeToasts, dismissToast } from "../../toast-store";

// ------------------------------------------------------------------
// Badge
// ------------------------------------------------------------------
export function Badge({ tone = "slate", children, className }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------------
// Spinner
// ------------------------------------------------------------------
export function Spinner({ className }) {
  return (
    <span
      className={cx(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-indigo-400",
        className
      )}
    />
  );
}

// ------------------------------------------------------------------
// ErrorBanner
// ------------------------------------------------------------------
export function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss error" className="text-rose-400 hover:text-rose-200 text-lg leading-none">×</button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Toast (single, legacy-compatible) — renders the newest global toast.
// Pages using <Toast message={toast?.msg} tone={toast?.tone} /> keep working
// unchanged; new code should render <ToastViewport /> once in App instead.
// ------------------------------------------------------------------
const toastMap = {
  green: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  red: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  amber: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  indigo: "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
  cyan: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  slate: "border-slate-500/40 bg-slate-500/15 text-slate-300",
};

const toastIcon = { green: "✓", red: "✕", amber: "⚠", indigo: "ℹ", cyan: "ℹ", slate: "ℹ" };

export function Toast({ message, tone = "green" }) {
  if (!message) return null;
  return <ToastCard message={message} tone={tone} />;
}

/** One toast card — glassy surface that reads in both themes, icon + text + dismiss. */
export function ToastCard({ message, tone = "green", onClose, toastId: _toastId }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        "toast-pop-in pointer-events-auto flex w-80 max-w-[calc(100vw-3rem)] items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-xl backdrop-blur-md",
        toastMap[tone] || toastMap.green,
        "bg-slate-900/95 dark:bg-slate-900/95"
      )}
    >
      <span aria-hidden className="mt-px shrink-0 font-bold">{toastIcon[tone] || "ℹ"}</span>
      <span className="min-w-0 flex-1 break-words">{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Dismiss notification"
          className="-mr-1 shrink-0 rounded px-1 text-base leading-none opacity-60 transition hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * ToastViewport — the single app-wide toast outlet. Subscribes to the global
 * toast store and renders the stack bottom-right. Mount once (App.jsx).
 */
export function ToastViewport() {
  const [items, setItems] = useState([]);
  useEffect(() => subscribeToasts(setItems), []);
  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col-reverse gap-2">
      {items.map((t) => (
        <ToastCard
          key={t.id}
          toastId={t.id}
          message={t.msg}
          tone={t.tone}
          onClose={() => dismissToast(t.id)}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Empty
// ------------------------------------------------------------------
export function Empty({ message }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 py-10 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

// ------------------------------------------------------------------
// StatCard
// ------------------------------------------------------------------
export function StatCard({ label, value, tone, icon, meta }) {
  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl px-4 py-3.5 shadow-lg flex items-center gap-3.5">
      {icon && (
        <div className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", tones[tone])}>{icon}</div>
      )}
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-slate-50 mt-0.5 tabular-nums leading-tight">{value}</p>
        {meta && <div className="mt-1 text-xs text-slate-500">{meta}</div>}
      </div>
    </div>
  );
}
