// --------------------------
// SOURCE PAGE PICKER
// Fetches available WordPress pages/posts for a KB and lets the user
// select specific ones for "selected" scope ingestion.
// --------------------------

import { useState, useEffect, useMemo } from "react";
import { listSourcePages } from "../api";
import { Spinner } from "../components/ui";

/**
 * @param {{ kbKey: string, company: string, selected: number[], onSelect: (ids: number[]) => void }} props
 */
export default function SourcePagePicker({ kbKey, company, selected, onSelect, pages: cachedPages, onPagesCached }) {
  const [pages, setPages] = useState(cachedPages || []);
  const [loading, setLoading] = useState(!cachedPages);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!kbKey || !company) return;
    if (cachedPages && cachedPages.length > 0) return;
    let cancel = false;
    setLoading(true);
    setError(null);
    listSourcePages(kbKey, company)
      .then((p) => { if (!cancel) { setPages(p); onPagesCached?.(p); } })
      .catch((e) => { if (!cancel) setError(e.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
    // Deliberately keyed on kbKey/company only: this fetches pages once per
    // KB and caches upward via onPagesCached; cachedPages must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbKey, company]);

  const filtered = useMemo(() => {
    if (!search.trim()) return pages;
    const q = search.toLowerCase();
    return pages.filter((p) => p.title.toLowerCase().includes(q) || p.url.toLowerCase().includes(q));
  }, [pages, search]);

  const pagesByType = useMemo(() => {
    const map = {};
    for (const p of filtered) {
      (map[p.type] ||= []).push(p);
    }
    return map;
  }, [filtered]);

  const toggle = (id) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onSelect(next);
  };

  const toggleType = (type) => {
    const ids = (pagesByType[type] || []).map((p) => p.id);
    const allSelected = ids.every((id) => selected.includes(id));
    if (allSelected) {
      onSelect(selected.filter((id) => !ids.includes(id)));
    } else {
      onSelect([...new Set([...selected, ...ids])]);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Spinner className="h-4 w-4" />
        <span className="ml-2 text-xs text-slate-400">Loading pages…</span>
      </div>
    );
  }

  if (error) {
    return <p className="py-3 text-center text-xs text-rose-400">{error}</p>;
  }

  if (pages.length === 0) {
    return <p className="py-3 text-center text-xs text-slate-500">No pages found on this WordPress source.</p>;
  }

  return (
    <div className="space-y-2">
      {/* Search */}
      <div className="relative">
        <svg className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input
          type="text"
          placeholder={`Search ${pages.length} pages…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-slate-600 bg-slate-800 py-1.5 pl-7 pr-2 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-indigo-500"
        />
      </div>

      {/* Selected count */}
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>{selected.length} of {pages.length} selected</span>
        {selected.length > 0 && (
          <button type="button" className="text-indigo-400 hover:text-indigo-300" onClick={() => onSelect([])}>
            Clear all
          </button>
        )}
      </div>

      {/* Page list */}
      <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-700/50">
        {Object.entries(pagesByType).map(([type, items]) => {
          const allSelected = items.every((p) => selected.includes(p.id));
          return (
            <div key={type}>
              {/* Type header with select-all */}
              <button
                type="button"
                onClick={() => toggleType(type)}
                className="flex w-full items-center gap-2 bg-slate-800/50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 hover:bg-slate-800 hover:text-slate-300"
              >
                <span className={`inline-block h-3 w-3 rounded border ${allSelected ? "border-indigo-500 bg-indigo-500" : "border-slate-600"} flex items-center justify-center`}>
                  {allSelected && (
                    <svg className="h-2 w-2 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>
                  )}
                </span>
                {type} ({items.length})
              </button>
              {/* Items */}
              {items.map((p) => {
                const checked = selected.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-slate-800/50 ${checked ? "text-indigo-300" : "text-slate-400"}`}
                  >
                    <span className={`inline-block h-3 w-3 shrink-0 rounded border ${checked ? "border-indigo-500 bg-indigo-500" : "border-slate-600"} flex items-center justify-center`}>
                      {checked && (
                        <svg className="h-2 w-2 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>
                      )}
                    </span>
                    <span className="truncate">{p.title}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
