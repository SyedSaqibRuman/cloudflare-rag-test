import { forwardRef } from "react";
import { cx, slugify } from "./helpers";

// ------------------------------------------------------------------
// Button
// ------------------------------------------------------------------
const buttonVariants = {
  primary: "bg-indigo-500 hover:bg-indigo-400 text-white",
  secondary: "bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700",
  danger: "bg-rose-600 hover:bg-rose-500 text-white",
  ghost: "text-slate-400 hover:text-slate-100 hover:bg-slate-800",
  success: "bg-emerald-600 hover:bg-emerald-500 text-white",
};

export function Button({ variant = "primary", className, children, ...props }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
        buttonVariants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------
// IconButton
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// Input
// ------------------------------------------------------------------
export const Input = forwardRef(function Input({ className, label, error, name, id, ...props }, ref) {
  const fieldId = id || (label ? slugify(label) : name);
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-slate-400 mb-1.5">{label}</span>}
      <input
        ref={ref}
        id={fieldId}
        name={name || fieldId}
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
});

// ------------------------------------------------------------------
// Select
// ------------------------------------------------------------------
export function Select({ label, options = [], className, name, id, ...props }) {
  const fieldId = id || (label ? slugify(label) : name);
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-slate-400 mb-1.5">{label}</span>}
      <select
        id={fieldId}
        name={name || fieldId}
        className={cx(
          "w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500",
          className
        )}
        {...props}
      >
        {options.map((o) =>
          typeof o === "string" ? (
            <option key={o} value={o}>{o}</option>
          ) : (
            <option key={o.value} value={o.value}>{o.label}</option>
          )
        )}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------
// TextArea
// ------------------------------------------------------------------
export function TextArea({ label, className, name, id, ...props }) {
  const fieldId = id || (label ? slugify(label) : name);
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-slate-400 mb-1.5">{label}</span>}
      <textarea
        id={fieldId}
        name={name || fieldId}
        className={cx(
          "w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono",
          className
        )}
        {...props}
      />
    </label>
  );
}

// ------------------------------------------------------------------
// Toggle
// ------------------------------------------------------------------
export function Toggle({ checked, onChange, disabled, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      aria-label={title}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500/30",
        checked ? "bg-indigo-500" : "bg-slate-700",
        disabled && "opacity-40 pointer-events-none"
      )}
    >
      <span
        className={cx(
          "pointer-events-none mt-0.5 inline-block size-5 rounded-full bg-white shadow-sm transition duration-200 ease-in-out",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
