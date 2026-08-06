import { useEffect } from "react";
import { cx } from "../util";

export function Card({ title, subtitle, children, className, actions }) {
  return (
    <div className={cx("bg-slate-900/70 border border-slate-800 rounded-xl shadow-lg", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-800">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-100">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function Button({ variant = "primary", className, children, ...props }) {
  const variants = {
    primary: "bg-indigo-500 hover:bg-indigo-400 text-white",
    secondary: "bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700",
    danger: "bg-rose-600 hover:bg-rose-500 text-white",
    ghost: "text-slate-400 hover:text-slate-100 hover:bg-slate-800",
    success: "bg-emerald-600 hover:bg-emerald-500 text-white",
  };
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({ title, className, children, ...props }) {
  return (
    <button
      title={title}
      aria-label={title}
      className={cx(
        "inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-indigo-400",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ className, label, error, ...props }) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-slate-400 mb-1.5">{label}</span>}
      <input
        className={cx(
          "w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500",
          error && "border-rose-500",
          className
        )}
        {...props}
      />
      {error && <span className="block text-xs text-rose-400 mt-1">{error}</span>}
    </label>
  );
}

export function Select({ label, options = [], className, ...props }) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-slate-400 mb-1.5">{label}</span>}
      <select
        className={cx(
          "w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500",
          className
        )}
        {...props}
      >
        {options.map((o) =>
          typeof o === "string" ? (
            <option key={o} value={o}>
              {o}
            </option>
          ) : (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          )
        )}
      </select>
    </label>
  );
}

export function TextArea({ label, className, ...props }) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-slate-400 mb-1.5">{label}</span>}
      <textarea
        className={cx(
          "w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono",
          className
        )}
        {...props}
      />
    </label>
  );
}

const tones = {
  green: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  red: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  indigo: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  slate: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  cyan: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
};

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

export function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
      <span>{message}</span>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss error" className="text-rose-400 hover:text-rose-200 text-lg leading-none">
          ×
        </button>
      )}
    </div>
  );
}

export function Toast({ message, tone = "green" }) {
  if (!message) return null;
  const map = {
    green: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
    red: "border-rose-500/40 bg-rose-500/15 text-rose-200",
  };
  return (
    <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50 rounded-lg bg-white shadow-xl animate-in">
      <div className={cx("rounded-lg border px-4 py-3 text-sm", map[tone])}>
        {message}
      </div>
    </div>
  );
}

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

export function Empty({ message }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 py-10 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg overscroll-contain rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-slate-400 hover:text-slate-100 text-xl leading-none">
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-800 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
