import { useEffect, useMemo, useRef, useState } from "react";
import { cx, companyStatus } from "../util";
import { Badge } from "./ui";

export default function CompanySelect({ company, companies, select, onCreate }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const selected = companies.find((c) => c.name === company);
  const st = selected ? companyStatus(selected) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.COMPANY_NAME || "").toLowerCase().includes(q)
    );
  }, [companies, query]);

  // Close on outside click / Escape; focus the search when opened.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const choose = (name) => {
    select(name);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        title={selected?.COMPANY_NAME || selected?.name || "No company selected"}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-lg bg-slate-950 border px-2.5 py-2 text-left focus:outline-none focus:border-indigo-500",
          open ? "border-indigo-500" : "border-slate-700 hover:border-slate-500"
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-300">
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
            <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
            <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
            <path d="M10 6h4" />
            <path d="M10 10h4" />
            <path d="M10 14h4" />
            <path d="M10 18h4" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block min-w-0 truncate text-sm font-semibold text-slate-100">
            {selected?.COMPANY_NAME || selected?.name || "No company selected"}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            {st && <Badge tone={st.tone} className="shrink-0 px-1.5 py-0 text-[10px]">{st.label}</Badge>}
            <span className="block min-w-0 truncate text-[11px] text-slate-500">
              {selected ? "Cloudflare Workspace" : "Select a workspace"}
            </span>
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
          aria-label="Select company"
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
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <ul role="listbox" aria-label="Company" className="max-h-[216px] overflow-y-auto py-1">
            {filtered.map((c) => {
              const isSel = c.name === company;
              return (
                <li
                  key={c.name}
                  role="option"
                  aria-selected={isSel}
                  tabIndex={0}
                  onClick={() => choose(c.name)}
                  onKeyDown={(e) => e.key === "Enter" && choose(c.name)}
                  className={cx(
                    "flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-xs",
                    isSel
                      ? "bg-indigo-500/15 text-indigo-300"
                      : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                  )}
                >
                  <span className="truncate">{c.COMPANY_NAME || c.name}</span>
                  {isSel && <CheckIcon />}
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-slate-500">No companies found</li>
            )}
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
              New Company
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
