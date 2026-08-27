// --------------------------
// 🔹 PAGINATION CONTROLS
// Reusable pagination bar for list pages.
// Shows page info + prev/next buttons + page size selector.
// --------------------------

/**
 * Pagination controls bar.
 *
 * @param {Object} props
 * @param {number} props.page — current page (1-indexed)
 * @param {number} props.perPage — items per page
 * @param {number} props.total — total items across all pages
 * @param {function(number): void} props.onPageChange — called with new page number
 * @param {function(number): void} [props.onPerPageChange] — called with new perPage
 * @param {boolean} [props.loading] — disable controls during loading
 */
export function Pagination({ page, perPage, total, onPageChange, onPerPageChange, loading }) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const hasNext = page < totalPages;
  const hasPrev = page > 1;
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-5 py-3 text-sm text-slate-400">
      {/* Left: page info */}
      <span>
        Showing <span className="font-medium text-slate-300">{from}–{to}</span> of{" "}
        <span className="font-medium text-slate-300">{total.toLocaleString()}</span>
      </span>

      {/* Right: controls */}
      <div className="flex items-center gap-2">
        {/* Per-page selector */}
        {onPerPageChange && (
          <select
            value={perPage}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            disabled={loading}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 focus:border-indigo-500 focus:outline-none"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        )}

        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <NavButton
            onClick={() => onPageChange(1)}
            disabled={!hasPrev || loading}
            title="First page"
          >
            <ChevronsLeftIcon />
          </NavButton>
          <NavButton
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPrev || loading}
            title="Previous page"
          >
            <ChevronLeftIcon />
          </NavButton>

          <span className="px-2 text-xs tabular-nums text-slate-300">
            {page} / {totalPages}
          </span>

          <NavButton
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNext || loading}
            title="Next page"
          >
            <ChevronRightIcon />
          </NavButton>
          <NavButton
            onClick={() => onPageChange(totalPages)}
            disabled={!hasNext || loading}
            title="Last page"
          >
            <ChevronsRightIcon />
          </NavButton>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Sub-components
// ------------------------------------------------------------------

function NavButton({ children, disabled, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function ChevronsLeftIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ChevronsRightIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m13 17 5-5-5-5" /><path d="m6 17 5-5-5-5" />
    </svg>
  );
}
