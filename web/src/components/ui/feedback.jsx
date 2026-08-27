import { cx, tones } from "./helpers";

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
// Toast
// ------------------------------------------------------------------
const toastMap = {
  green: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  red: "border-rose-500/40 bg-rose-500/15 text-rose-200",
};

export function Toast({ message, tone = "green" }) {
  if (!message) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50 animate-in">
      <div className={cx("rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur", toastMap[tone], "bg-slate-900/90")}>
        {message}
      </div>
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
