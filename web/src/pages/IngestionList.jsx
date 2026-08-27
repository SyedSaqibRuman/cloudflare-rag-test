// --------------------------
// INGESTION LIST — KB table with CRUD, stats, and pagination.
// Extracted from Ingestion.jsx to fix the hooks-after-early-return violation.
// All hooks are called unconditionally here — the sub-route check lives in
// the parent IngestionRouter.
// --------------------------

import { useState, useCallback } from "react";
import { listKbs, kbStatus, deleteKb, ingestKb, getKbProgress } from "../api";
import SourcePagePicker from "./SourcePagePicker.jsx";
import { Card, Button, Badge, Empty, StatCard, SkeletonCard, Spinner, Toast } from "../components/ui";
import { Popover, PopoverTrigger, PopoverContent, PopoverItem, PopoverSeparator } from "../components/ui/overlay";
import { Pagination } from "../components/ui/pagination";
import ScrollToTop from "../components/ui/ScrollToTop.jsx";
import { usePoll, useToast, usePagination } from "../hooks";
import { useHeaderActions } from "../components/Layout";
import { useCompanies } from "../context";
import KbModal from "../components/kb-modal";
import { timeAgo, cx } from "../util";
import { kbLifecycle } from "#shared/status.js";

export default function IngestionList({ navigate }) {
  const { company } = useCompanies();
  const [kbs, setKbs] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { toast, notify } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [ingesting, setIngesting] = useState({});
  const [scopes, setScopes] = useState({});
  const { page, perPage, setPage, setPerPage, paginationParams } = usePagination();

  const [selectedPages, setSelectedPages] = useState({});
  const [progress, setProgress] = useState({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const getScope = (key) => scopes[key] || { type: "all", limit: 100 };
  const setScope = (key, patch) => setScopes((prev) => ({ ...prev, [key]: { ...getScope(key), ...patch } }));

  const load = useCallback(async () => {
    if (!company) return;
    setError(null);
    try {
      const result = await listKbs(company, paginationParams);
      const kbList = result.items ?? [];
      setKbs(kbList);
      setPagination(result.pagination);

      const statusResults = await Promise.allSettled(
        kbList.map(async (kb) => {
          const s = await kbStatus(kb.kb_key, company);
          return { key: kb.kb_key, status: s };
        })
      );

      const statusMap = {};
      for (const r of statusResults) {
        if (r.status === "fulfilled") {
          statusMap[r.value.key] = r.value.status;
        }
      }
      setStatuses(statusMap);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, page, perPage]);

  usePoll(load, 30000, [company, page, perPage]);

  const pollProgress = useCallback(async () => {
    if (!company || kbs.length === 0) return;
    const results = await Promise.allSettled(
      kbs.map(async (kb) => {
        const s = statuses[kb.kb_key];
        if (!s?.inProgress) return null;
        const p = await getKbProgress(kb.kb_key, company);
        return { key: kb.kb_key, progress: p };
      })
    );
    const map = {};
    for (const r of results) {
      if (r.status === "fulfilled" && r.value?.progress?.running) {
        map[r.value.key] = r.value.progress;
      }
    }
    setProgress((prev) => ({ ...prev, ...map }));
  }, [company, kbs, statuses]);

  usePoll(pollProgress, 2000, [company, kbs, statuses]);

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={load} disabled={loading || !company}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
      <Button onClick={() => setCreateOpen(true)} disabled={!company} className="whitespace-nowrap">+ Create KB</Button>
    </div>
  );

  const [sourcePagesCache, setSourcePagesCache] = useState({});

  const startIngestion = async (kb) => {
    if (ingesting[kb.kb_key]) return;
    const { type, limit } = getScope(kb.kb_key);
    let scope;
    if (type === "limit") {
      scope = { scope: "limit", limit: Number(limit) || 100 };
    } else if (type === "selected") {
      const ids = selectedPages[kb.kb_key] || [];
      if (ids.length === 0) {
        setError("Select at least one page to ingest.");
        return;
      }
      scope = {
        scope: "selected",
        items: ids.map((id) => {
          const pg = (sourcePagesCache[kb.kb_key] || []).find((p) => p.id === id);
          return { type: pg?.type === "page" ? "pages" : "posts", id };
        }),
      };
    } else {
      scope = { scope: "all" };
    }
    setIngesting((prev) => ({ ...prev, [kb.kb_key]: true }));
    try {
      await ingestKb(kb.kb_key, company, scope);
      const label = type === "limit" ? `limit ${limit}` : type === "selected" ? `${(selectedPages[kb.kb_key] || []).length} pages` : "all";
      notify(`Ingestion started for '${kb.kb_key}' (${label}).`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setIngesting((prev) => ({ ...prev, [kb.kb_key]: false }));
    }
  };

  const remove = async (kb) => {
    if (!window.confirm(`Delete knowledge base '${kb.kb_key}'? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteKb(kb.kb_key, company);
      notify(`Deleted '${kb.kb_key}'.`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const totalDocs = Object.values(statuses).reduce((sum, s) => sum + (s?.documentCount || 0), 0);
  const totalVectors = Object.values(statuses).reduce((sum, s) => {
    const v = s?.vectorCount;
    return sum + (v != null ? v : 0);
  }, 0);
  const activeCount = kbs.filter((kb) => kb.status === "active").length;
  const indexingCount = kbs.filter((kb) => kb.status === "indexing").length;

  // ── Client-side search + lifecycle filter over the current page ───────
  const filteredKbs = kbs.filter((kb) => {
    if (statusFilter !== "all") {
      const life = kbLifecycle(kb, statuses[kb.kb_key]).label.toLowerCase();
      if (life !== statusFilter) return false;
    }
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      kb.kb_name?.toLowerCase().includes(q) ||
      kb.kb_key?.toLowerCase().includes(q) ||
      kb.description?.toLowerCase().includes(q)
    );
  });

  if (!company) {
    return <Empty message="Select a company to view and manage its knowledge bases." />;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* ── Aggregate stat cards: health at a glance ────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Knowledge Bases"
          value={loading ? "…" : kbs.length}
          tone="indigo"
          meta={
            loading ? "Checking…" : (
              <span className="flex items-center gap-2">
                {indexingCount > 0 && <span className="text-amber-400">{indexingCount} indexing</span>}
                {activeCount > 0 && <span className="text-emerald-400">{activeCount} active</span>}
                {indexingCount === 0 && activeCount === 0 && <span>idle</span>}
              </span>
            )
          }
        />
        <StatCard
          label="Documents"
          value={loading ? "…" : totalDocs.toLocaleString()}
          tone="green"
          meta="across all KBs"
        />
        <StatCard
          label="Vectors"
          value={loading ? "…" : totalVectors.toLocaleString()}
          tone="cyan"
          meta="indexed"
        />
        <StatCard
          label="Active Indexes"
          value={loading ? "…" : activeCount}
          tone="amber"
          meta={errorCount > 0 ? `${kbs.length - activeCount} not active` : "healthy"}
        />
      </div>

      {/* ── KB table with CRUD + ingest stats ────────────────────────── */}
      <Card
        title="Knowledge Bases"
        subtitle={`${pagination?.total ?? kbs.length} KB${(pagination?.total ?? kbs.length) === 1 ? "" : "s"} — ingestion settings, live status, and config`}
        footer={pagination && pagination.total > perPage && statusFilter === "all" && !search && (
          <Pagination
            page={page}
            perPage={perPage}
            total={pagination.total}
            onPageChange={setPage}
            onPerPageChange={setPerPage}
            loading={loading}
          />
        )}
      >
        {loading ? (
          <SkeletonCard rows={4} />
        ) : kbs.length === 0 ? (
          <Empty message="No knowledge bases yet. Create one to start ingesting content." />
        ) : filteredKbs.length === 0 ? (
          <Empty message={`No knowledge bases match ${statusFilter !== "all" ? `the “${statusFilter}” filter` : `“${search}”`}.`} />
        ) : (
          <div className="space-y-4">
            {/* ── Search + lifecycle filter bar ─────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
                <svg aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or key…"
                  aria-label="Search knowledge bases"
                  className="h-8 w-full rounded-lg border border-slate-700 bg-slate-800/60 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div className="flex shrink-0 gap-1">
                {["all", "ready", "indexing", "active", "paused", "error"].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setStatusFilter(f)}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
                      statusFilter === f
                        ? "bg-indigo-500/15 text-indigo-300"
                        : "text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                    }`}
                  >
                    {f === "all" ? "All" : f}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
            {filteredKbs.map((kb) => {
              const s = statuses[kb.kb_key];
              const lastRun = s?.lastIngestion;
              const prog = progress[kb.kb_key];
              const scope = getScope(kb.kb_key);
              const vectorIndex = kb.vector_external_id || kb.vector_resource_name || "Default";
              return (
                <div
                  key={kb.id}
                  className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition-colors hover:border-slate-700"
                >
                  {/* ── Identity ─────────────────────────────────── */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => navigate(`ingestion/kbs/${kb.kb_key}`)}
                          className="truncate text-sm font-semibold text-indigo-300 hover:text-indigo-200 hover:underline"
                        >
                          {kb.kb_name}
                        </button>
                        <Badge tone={kbLifecycle(kb, s).tone}>{kbLifecycle(kb, s).label}</Badge>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500" title={`key: ${kb.kb_key}`}>
                        {kb.kb_key}
                      </p>
                    </div>
                    <Badge tone={kb.source_type === "wordpress" ? "cyan" : kb.source_type === "file" ? "amber" : "indigo"}>
                      {kb.source_type || "wordpress"}
                    </Badge>
                  </div>

                  {/* ── Live progress (running) ──────────────────── */}
                  {prog?.running && (
                    <div className="mt-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-2.5">
                      <div className="flex items-center justify-between text-[10px] text-indigo-200/80">
                        <span className="flex items-center gap-1.5">
                          <Spinner className="h-3 w-3" />
                          {prog.progress?.phase === "fetching" ? "Fetching…" : "Processing…"}
                        </span>
                        <span className="tabular-nums">
                          {(prog.progress?.processed ?? 0) + (prog.progress?.skipped ?? 0)}/{prog.progress?.discovered ?? 0}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-700">
                        <div
                          className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                          style={{
                            width: (() => {
                              const pr = prog.progress;
                              const total = (pr?.processed ?? 0) + (pr?.skipped ?? 0);
                              const pct = (pr?.discovered ?? 0) > 0 ? Math.round((total / pr.discovered) * 100) : 0;
                              return `${Math.min(pct, 100)}%`;
                            })(),
                          }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">{prog.progress?.chunks ?? 0} chunks created so far</p>
                    </div>
                  )}

                  {/* ── Stats ────────────────────────────────────── */}
                  <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-slate-800/40 p-2.5">
                    <KbStat label="Docs" value={s?.documentCount?.toLocaleString() ?? "—"} muted={s?.documentCount == null} />
                    <KbStat label="Vectors" value={s?.vectorCount != null ? s.vectorCount.toLocaleString() : "—"} muted={s?.vectorCount == null} />
                    <KbStat label="Chunks" value={lastRun?.chunksCreated?.toLocaleString() ?? "—"} muted={!lastRun?.chunksCreated} />
                    <KbStat
                      label="Last run"
                      value={lastRun?.at ? timeAgo(lastRun.at) : "never"}
                      muted={!lastRun?.at}
                      title={lastRun?.at ? new Date(lastRun.at).toLocaleString() : undefined}
                    />
                  </div>

                  {/* ── Architecture: embedding · vector · storage · features ── */}
                  <div className="mt-3 space-y-1.5 text-[11px] text-slate-500">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex min-w-0 items-center gap-1" title={`Embedding model`}>
                        <span className="uppercase tracking-wider">Embedding</span>
                        <span className="truncate text-slate-400">{shortenModel(kb.embedding_model_name)}</span>
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1" title={`Vector index: ${vectorIndex}`}>
                        <IconLayers />
                        <span className="truncate text-slate-400">{vectorIndex}</span>
                      </span>
                      {storageLabel(kb) && (
                        <span className="inline-flex min-w-0 items-center gap-1" title={`Storage bucket: ${storageLabel(kb)}`}>
                          <IconBucket />
                          <span className="truncate text-slate-400">{storageLabel(kb)}</span>
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-1">
                        chunk <span className="text-slate-400">{kb.chunk_size}</span>/ overlap <span className="text-slate-400">{kb.chunk_overlap}</span>
                      </span>
                      {kb.enable_hybrid_search ? <Badge tone="green">Hybrid ✓</Badge> : null}
                      {kb.enable_graph_rag ? <Badge tone="indigo">GraphRAG ✓</Badge> : null}
                      {lastRun?.durationMs != null && (
                        <span className="inline-flex items-center gap-1">
                          last <span className="text-slate-400">{(lastRun.durationMs / 1000).toFixed(1)}s</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Actions ──────────────────────────────────── */}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    <div className="inline-flex">
                      <Button
                        onClick={() => startIngestion(kb)}
                        disabled={ingesting[kb.kb_key]}
                        className="rounded-r-none px-3 py-1 text-xs"
                        title={`Ingest (${scope.type === "all" ? "all documents" : scope.type === "limit" ? `max ${scope.limit}` : "selected pages"})`}
                      >
                        {ingesting[kb.kb_key] ? <Spinner className="h-3 w-3" /> : "Ingest"}
                      </Button>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            disabled={ingesting[kb.kb_key]}
                            title="Ingest scope"
                            className="inline-flex items-center rounded-r-lg border border-l-0 border-slate-600 bg-slate-800 px-1.5 text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200 disabled:opacity-50"
                          >
                            <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="currentColor"><path d="M2.5 4.5l3.5 3.5 3.5-3.5" /></svg>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" side="top" sideOffset={6} className={`${scope.type === "selected" ? "min-w-[22rem]" : "min-w-[13rem]"} p-1`}>
                          <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">Ingest scope</p>
                          <PopoverItem
                            onClick={() => setScope(kb.kb_key, { type: "all" })}
                            className={scope.type === "all" ? "bg-indigo-500/15 text-indigo-300" : ""}
                          >
                            <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${scope.type === "all" ? "bg-indigo-400" : "bg-slate-600"}`} />
                            All documents
                          </PopoverItem>
                          <PopoverSeparator />
                          <PopoverItem
                            onClick={() => setScope(kb.kb_key, { type: "limit" })}
                            className={scope.type === "limit" ? "bg-indigo-500/15 text-indigo-300" : ""}
                          >
                            <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${scope.type === "limit" ? "bg-indigo-400" : "bg-slate-600"}`} />
                            Limit documents
                          </PopoverItem>
                          <PopoverSeparator />
                          <PopoverItem
                            onClick={() => setScope(kb.kb_key, { type: "selected" })}
                            className={scope.type === "selected" ? "bg-indigo-500/15 text-indigo-300" : ""}
                          >
                            <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${scope.type === "selected" ? "bg-indigo-400" : "bg-slate-600"}`} />
                            Selected pages
                            {(selectedPages[kb.kb_key]?.length ?? 0) > 0 && (
                              <span className="ml-auto rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[9px] text-indigo-300">
                                {selectedPages[kb.kb_key].length}
                              </span>
                            )}
                          </PopoverItem>
                          {scope.type === "limit" && (
                            <div className="px-3 py-2">
                              <label className="mb-1 block text-[10px] text-slate-500">Max documents</label>
                              <input
                                type="number"
                                min="1"
                                max="10000"
                                value={scope.limit}
                                onChange={(e) => setScope(kb.kb_key, { limit: e.target.value })}
                                className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-indigo-500"
                              />
                            </div>
                          )}
                          {scope.type === "selected" && (
                            <div className="px-2 py-2">
                              <SourcePagePicker
                                kbKey={kb.kb_key}
                                company={company}
                                selected={selectedPages[kb.kb_key] || []}
                                onSelect={(ids) => setSelectedPages((prev) => ({ ...prev, [kb.kb_key]: ids }))}
                                pages={sourcePagesCache[kb.kb_key]}
                                onPagesCached={(p) => setSourcePagesCache((prev) => ({ ...prev, [kb.kb_key]: p }))}
                              />
                            </div>
                          )}
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="secondary" className="px-2 py-1 text-[11px]" onClick={() => setEditRow(kb)}>
                        Edit
                      </Button>
                      <Button variant="secondary" className="px-2 py-1 text-[11px]" onClick={() => navigate(`ingestion/kbs/${kb.kb_key}`)}>
                        Open
                      </Button>
                      <button
                        type="button"
                        title={`Delete ${kb.kb_key}`}
                        onClick={() => remove(kb)}
                        className="rounded p-1.5 text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        )}
      </Card>

      {/* ── Recent ingestion timeline ─────────────────────────────────── */}
      <Card title="Recent Ingestions" subtitle="Last 5 completed ingestion runs">
        {loading ? (
          <SkeletonCard rows={3} />
        ) : (() => {
          const runs = Object.entries(statuses)
            .map(([key, s]) => ({ key, ...s?.lastIngestion, kbKey: key }))
            .filter((r) => r.at)
            .sort((a, b) => new Date(b.at) - new Date(a.at))
            .slice(0, 5);

          if (runs.length === 0) {
            return <p className="text-sm text-slate-500">No ingestion runs yet.</p>;
          }

          return (
            <div className="space-y-2">
              {runs.map((run, i) => {
                const kb = kbs.find((k) => k.kb_key === run.kbKey);
                return (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-slate-800/30 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-200 truncate">
                        {kb?.kb_name || run.kbKey}
                      </p>
                      <p className="text-xs text-slate-500">
                        {run.mode || "all"} · {run.documentsProcessed ?? 0} processed · {run.chunksCreated ?? 0} chunks
                      </p>
                    </div>
                    <div className="ml-4 shrink-0 text-right">
                      <p className="text-xs text-slate-400">{timeAgo(run.at)}</p>
                      {run.durationMs != null && (
                        <p className="text-[11px] text-slate-600">{(run.durationMs / 1000).toFixed(1)}s</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Card>

      {/* ── Create / Edit KB modal ──────────────────────────────────── */}
      <KbModal
        open={createOpen}
        row={null}
        company={company}
        onClose={() => setCreateOpen(false)}
        onSaved={async () => {
          setCreateOpen(false);
          notify("Knowledge base created.");
          await load();
        }}
      />
      <KbModal
        open={!!editRow}
        row={editRow}
        company={company}
        onClose={() => setEditRow(null)}
        onSaved={async () => {
          setEditRow(null);
          notify("Knowledge base updated.");
          await load();
        }}
      />

      <ScrollToTop
        className="fixed bottom-20 right-6 z-50"
        size="md"
        threshold={300}
      />

      <Toast message={toast?.msg} tone={toast?.tone} />
    </div>
  );
}

// ------------------------------------------------------------------
// KB card helpers (card-grid redesign of the former 13-column table)
// ------------------------------------------------------------------

/** Compact stat cell: uppercase label + bold value; dims when no data. */
function KbStat({ label, value, muted, title }) {
  return (
    <div title={title} className="min-w-0">
      <p className="truncate text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cx("mt-0.5 truncate text-sm font-semibold tabular-nums", muted ? "text-slate-600" : "text-slate-200")}>
        {value}
      </p>
    </div>
  );
}

/** Shorten an embedding model name for card display. */
function shortenModel(name) {
  if (!name) return "default";
  return name.replace(/^@?cf\//, "").split("/").pop();
}

/** Storage bucket display label from a KB row (null when on company default). */
function storageLabel(kb) {
  return kb.storage_external_id || kb.storage_resource_name || null;
}

function IconLayers() {
  return (
    <svg aria-hidden="true" className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 2 8.5 4.5L12 11 3.5 6.5 12 2z" />
      <path d="m3.5 12 8.5 4.5L20.5 12" />
      <path d="m3.5 17.5 8.5 4.5 8.5-4.5" />
    </svg>
  );
}

function IconBucket() {
  return (
    <svg aria-hidden="true" className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}
