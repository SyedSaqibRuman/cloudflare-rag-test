import { cx } from "./helpers";

// ------------------------------------------------------------------
// Card
// ------------------------------------------------------------------
export function Card({ title, subtitle, children, className, actions, footer }) {
  return (
    <div className={cx("bg-slate-900/70 border border-slate-800 rounded-xl shadow-lg overflow-hidden", className)}>
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
      {footer && footer}
    </div>
  );
}

// ------------------------------------------------------------------
// Skeleton loading placeholders
// ------------------------------------------------------------------

/** Single animated bar. Pass width/height classes to customise. */
export function Skeleton({ className }) {
  return (
    <div className={cx("animate-pulse rounded-md bg-slate-800", className)} />
  );
}

/** Card-shaped skeleton: title bar + N content rows. */
export function SkeletonCard({ rows = 3, className }) {
  return (
    <div className={cx("space-y-4 p-5", className)}>
      <div className="space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className={cx("h-3", i === rows - 1 ? "w-3/5" : "w-full")} />
        ))}
      </div>
    </div>
  );
}

/** Inline text skeleton — replaces "Loading…" spinner lines. */
export function SkeletonText({ lines = 1, className }) {
  return (
    <div className={cx("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-3.5", i === lines - 1 ? "w-2/5" : "w-full")} />
      ))}
    </div>
  );
}
