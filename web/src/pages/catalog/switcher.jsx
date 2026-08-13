// --------------------------
// CATALOG — provider switcher dropdown (mirrors the sidebar company picker).
// --------------------------
import { useRef, useState } from "react";
import { cx } from "../../util";
import { groupFor } from "./constants";

export function ProviderSwitcher({ providers, selected, onSelect, onCreate }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const current = providers.find((p) => p.providerKey === selected);

  const filtered = providers.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return p.providerKey.toLowerCase().includes(q) || p.providerName.toLowerCase().includes(q);
  });

  const choose = (k) => {
    onSelect(k);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        title={current?.providerName || selected || "Select a provider"}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) inputRef.current?.focus();
        }}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-lg bg-slate-950 border px-2.5 py-2 text-left focus:outline-none focus:border-indigo-500",
          open ? "border-indigo-500" : "border-slate-700 hover:border-slate-500"
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-300">
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 2 7l10 5 10-5z" />
            <path d="m2 17 10 5 10-5" />
            <path d="m2 12 10 5 10-5" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block min-w-0 truncate text-sm font-semibold text-slate-100">
            {current?.providerName || selected || "Select a provider"}
          </span>
          <span className="mt-0.5 block min-w-0 truncate text-[11px] text-slate-500">
            {current ? `${selected} · ${groupFor(current.category).label}` : "Global catalog"}
          </span>
        </span>
        <svg
          aria-hidden="true"
          className={cx("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Select provider"
          className="absolute left-0 top-full z-50 mt-1.5 w-[236px] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        >
          <div className="border-b border-slate-800 p-2">
            <div className="relative">
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={inputRef}
                name="provider-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search providers"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <ul role="listbox" aria-label="Provider" className="max-h-[216px] overflow-y-auto py-1">
            {filtered.map((p) => {
              const isSel = p.providerKey === selected;
              return (
                <li
                  key={p.providerKey}
                  role="option"
                  aria-selected={isSel}
                  tabIndex={0}
                  onClick={() => choose(p.providerKey)}
                  onKeyDown={(e) => e.key === "Enter" && choose(p.providerKey)}
                  className={cx(
                    "flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs",
                    isSel
                      ? "bg-indigo-500/15 text-indigo-300"
                      : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                  )}
                >
                  <span className="truncate">{p.providerName}</span>
                  {isSel && (
                    <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </li>
              );
            })}
            {filtered.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No providers found</li>}
          </ul>
          <div className="border-t border-slate-800 p-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setQuery("");
                onCreate?.();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-indigo-500/15 hover:text-indigo-200"
            >
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5v14" />
              </svg>
              New Provider
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
