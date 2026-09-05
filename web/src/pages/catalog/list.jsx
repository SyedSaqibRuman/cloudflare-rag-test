// --------------------------
// CatalogList — list view for the Catalog page.
// Search, provider cards grouped into type sections, quick-add toolbar,
// batch test results modal.
// --------------------------
import { lazy, Suspense } from "react";
import { Button, Card, Empty, Spinner, Toast } from "../../components/ui";
import { TYPE_SECTIONS } from "./constants";
import { ProviderCard, TestResultsView } from "./components";
import { ChunkErrorBoundary } from "./chunk-error-boundary";

const AddCompatibleModal = lazy(() =>
  import("./modals").then((m) => ({ default: m.AddCompatibleModal }))
);

const TYPE_SECTION_VISIBLE = 20;

export function CatalogList({
  search,
  setSearch,
  providers,
  loading,
  error,
  statsOf,
  toggleProvider,
  navigate,
  expandedSections,
  setExpandedSections,
  collapsedSections,
  setCollapsedSections,
  addOpenAI,
  setAddOpenAI,
  addAnthropic,
  setAddAnthropic,
  compatibleCreated,
  testResults,
  setTestResults,
  toast,
  categoryFilter,
  setCategoryFilter,
  matchSearch,
  sortCards,
}) {
  const known = new Set(TYPE_SECTIONS.map((s) => s.id));
  const sections = TYPE_SECTIONS.map((s) => ({
    ...s,
    entries: sortCards(providers.filter((p) => p.category === s.id && matchSearch(p))),
  })).filter((s) => s.entries.length > 0);
  const uncategorized = providers.filter((p) => !known.has(p.category) && matchSearch(p));
  if (uncategorized.length > 0) {
    sections.push({
      id: "other",
      label: "Other",
      note: "Uncategorized",
      emoji: "📎",
      tone: "slate",
      entries: sortCards(uncategorized),
    });
  }
  const isSearching = !!search.trim() || !!categoryFilter;
  const hasAnyResult = sections.length > 0;

  const toggleCollapse = (id) =>
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleExpand = (id) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sectionHeader = (section, count, collapsed, onToggle) => (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={collapsed ? `Expand ${section.label}` : `Collapse ${section.label}`}
        className="group flex w-full items-center justify-between gap-2 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-500 rounded-md"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold leading-tight text-slate-100 group-hover:text-indigo-300">
          <span aria-hidden="true">{section.emoji}</span>
          {section.label}
          <span className="text-xs font-normal text-slate-500">{section.note}</span>
          <span className="text-xs text-slate-500">({count})</span>
        </h2>
        <span
          aria-hidden="true"
          className={`text-slate-500 transition-transform ${collapsed ? "" : "rotate-180"}`}
        >
          ▾
        </span>
      </button>
    </div>
  );

  const grid = (items) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((p) => (
        <ProviderCard
          key={p.providerKey}
          provider={p}
          stats={statsOf(p.providerKey)}
          onToggle={(active) => toggleProvider(p.providerKey, active)}
          onOpen={() => navigate(`catalog/${p.providerKey}`)}
        />
      ))}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Search + Category Filter */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers…"
            aria-label="Search providers"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:w-48"
        >
          <option value="">All categories</option>
          {TYPE_SECTIONS.map((s) => (
            <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
          ))}
        </select>
      </div>

      {/* Quick-add toolbar */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" onClick={() => setAddAnthropic(true)}>
          Add Anthropic Compatible
        </Button>
        <Button onClick={() => setAddOpenAI(true)}>Add OpenAI Compatible</Button>
      </div>

      {providers.length === 0 && !loading ? (
        <Card>
          <Empty message="No providers in the catalog yet. Use the buttons above to add an OpenAI/Anthropic compatible provider to get started." />
        </Card>
      ) : (
        <>
          {!hasAnyResult && (
            <div className="rounded-xl border border-dashed border-slate-700 py-8 text-center">
              <span aria-hidden="true" className="mb-2 block text-[32px] text-slate-600">🔍</span>
              <p className="text-sm text-slate-500">No providers match your search</p>
            </div>
          )}

          {sections.map((s) => {
            const collapsed = !isSearching && collapsedSections.has(s.id);
            const visible =
              isSearching || expandedSections.has(s.id)
                ? s.entries
                : s.entries.slice(0, TYPE_SECTION_VISIBLE);
            const hidden = s.entries.length - visible.length;
            return (
              <section key={s.id} className="flex flex-col gap-4">
                {sectionHeader(s, s.entries.length, collapsed, () => toggleCollapse(s.id))}
                {!collapsed && (
                  <>
                    {grid(visible)}
                    {!isSearching && (expandedSections.has(s.id) || hidden > 0) && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(s.id)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-indigo-500/40 px-3 py-2.5 text-sm font-medium text-indigo-300 transition-colors hover:border-indigo-400 hover:bg-indigo-500/5"
                      >
                        <span aria-hidden="true">{expandedSections.has(s.id) ? "▴" : "▾"}</span>
                        {expandedSections.has(s.id)
                          ? `Show fewer — ${TYPE_SECTION_VISIBLE} of ${s.entries.length}`
                          : `Show all ${s.entries.length} providers`}
                      </button>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </>
      )}

      {addOpenAI && (
        <ChunkErrorBoundary>
          <Suspense fallback={<Spinner className="h-5 w-5" />}>
            <AddCompatibleModal
              variant="openai"
              open={addOpenAI}
              onClose={() => setAddOpenAI(false)}
              onCreated={compatibleCreated}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}
      {addAnthropic && (
        <ChunkErrorBoundary>
          <Suspense fallback={<Spinner className="h-5 w-5" />}>
            <AddCompatibleModal
              variant="anthropic"
              open={addAnthropic}
              onClose={() => setAddAnthropic(false)}
              onCreated={compatibleCreated}
            />
          </Suspense>
        </ChunkErrorBoundary>
      )}

      {/* Test Results modal */}
      {testResults && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[6vh] sm:pt-[10vh]"
          onClick={() => setTestResults(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative max-h-[86vh] w-full max-w-[600px] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl sm:max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b border-slate-800 bg-slate-900/95 px-5 py-3 backdrop-blur-sm">
              <h3 className="font-semibold text-slate-100">Test Results</h3>
              <button
                onClick={() => setTestResults(null)}
                aria-label="Close test results"
                className="text-xl leading-none text-slate-400 hover:text-slate-100"
              >
                x
              </button>
            </div>
            <div className="p-5">
              <TestResultsView results={testResults} />
            </div>
          </div>
        </div>
      )}

      <Toast message={toast?.msg} tone={toast?.tone} />
    </div>
  );
}
