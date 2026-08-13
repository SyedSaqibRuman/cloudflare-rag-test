import { useEffect, useState } from "react";
import { listLogs, readLog, clearLog, downloadLog, downloadAllLogs } from "../api";
import { Card, Button, Spinner, Empty, Badge, Select } from "../components/ui";
import { useHeaderActions } from "../components/Layout";
import { usePoll } from "../hooks";
import { cx, timeAgo } from "../util";

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatCount(n) {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString();
}

// Known log files → premium card personality (label, tone, friendly copy).
// Unknown files fall back to a neutral "Log" persona.
const FILE_META = {
  "error.log": {
    label: "Errors",
    tone: "red",
    desc: "Failed batches, API failures, and fatal exceptions",
  },
  "process.log": {
    label: "Process",
    tone: "indigo",
    desc: "Ingestion lifecycle — fetches, chunking, and completions",
  },
  "upload.log": {
    label: "Uploads",
    tone: "cyan",
    desc: "R2 chunk uploads and storage writes",
  },
  "vector.log": {
    label: "Vectors",
    tone: "amber",
    desc: "Embedding batches and Vectorize upserts",
  },
  "skipped.log": {
    label: "Skipped",
    tone: "slate",
    desc: "Content already in the registry — unchanged, not re-ingested",
  },
  "r2-uploads.log": {
    label: "R2 Uploads",
    tone: "cyan",
    desc: "R2 object upload tracking",
  },
};

const metaFor = (name) => FILE_META[name] || { label: "Log", tone: "slate", desc: "Server log file" };

const TAIL_OPTIONS = [
  { value: "200", label: "200 lines" },
  { value: "1000", label: "1,000 lines" },
  { value: "2000", label: "2,000 lines" },
  { value: "0", label: "Everything" },
];

export default function Logs() {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState({}); // name -> { lineCount, lines }
  const [active, setActive] = useState(null);
  const [data, setData] = useState(null);
  const [tail, setTail] = useState("2000");
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const load = async () => {
    setError(null);
    try {
      const res = await listLogs();
      const list = res.files || [];
      setFiles(list);
      setActive((prev) => {
        if (prev && list.some((f) => f.name === prev)) return prev;
        return list[0]?.name || null;
      });
      // Eager mini-previews (last 8 lines) so every card shows a live snippet
      // and line count without a heavy full-tail fetch.
      const entries = await Promise.all(
        list.map(async (f) => {
          try {
            const r = await readLog(f.name, 8);
            return [f.name, { lineCount: r.lineCount, lines: r.lines || [] }];
          } catch {
            return [f.name, { lineCount: 0, lines: [] }];
          }
        })
      );
      setPreviews(Object.fromEntries(entries));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  usePoll(load, 30000, []);

  useEffect(() => {
    if (!active) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoadingContent(true);
    readLog(active, Number(tail))
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setData({ error: e.message });
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, tail]);

  const clearOne = async (name) => {
    if (!window.confirm(`Clear '${name}'? This empties the file on disk.`)) return;
    try {
      await clearLog(name);
      if (active === name) {
        setActive(null);
        setData(null);
      }
      setPreviews((p) => ({ ...p, [name]: { lineCount: 0, lines: [] } }));
      notify(`Cleared '${name}'.`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const clearAll = async () => {
    if (!window.confirm(`Clear all ${files.length} log file(s)? This empties the files on disk.`)) return;
    setClearing(true);
    try {
      await clearLog();
      setActive(null);
      setData(null);
      setPreviews({});
      notify("All log files cleared.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setClearing(false);
    }
  };

  const copyActive = async () => {
    const text = data?.lines?.join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notify("Log copied to clipboard.");
    } catch {
      notify("Clipboard unavailable.");
    }
  };

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={() => downloadAllLogs().catch((e) => setError(e.message))} disabled={loading || files.length === 0}>
        Export
      </Button>
      <Button variant="danger" onClick={clearAll} disabled={loading || files.length === 0 || clearing}>
        {clearing ? <Spinner className="h-3.5 w-3.5" /> : "Clear All"}
      </Button>
      <Button variant="secondary" onClick={load} disabled={loading}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
    </div>
  );

  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {files.length === 0 && !loading ? (
        <Card>
          <Empty message={error ? "Could not load logs." : "No log files found yet — they appear here as the app writes them."} />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card
            title="Log Files"
            subtitle={
              files.length > 0
                ? `${files.length} file${files.length === 1 ? "" : "s"} · ${formatSize(totalSize)} total · auto-refreshes every 30s`
                : undefined
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {files.map((f) => {
                const meta = metaFor(f.name);
                const preview = previews[f.name] || { lineCount: 0, lines: [] };
                const isActive = active === f.name;

                return (
                  <div
                    key={f.name}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isActive}
                    onClick={() => setActive(f.name)}
                    onKeyDown={(e) => e.key === "Enter" && setActive(f.name)}
                    className={cx(
                      "group flex cursor-pointer flex-col rounded-xl border bg-slate-950/60 p-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                      isActive
                        ? "border-indigo-500/60 ring-1 ring-indigo-500/40"
                        : "border-slate-800 hover:border-indigo-500/40 hover:bg-slate-900"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={cx(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                            meta.tone === "red" && "border-rose-500/30 bg-rose-500/10 text-rose-300",
                            meta.tone === "indigo" && "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
                            meta.tone === "cyan" && "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
                            meta.tone === "amber" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
                            meta.tone === "slate" && "border-slate-600/40 bg-slate-800/60 text-slate-300"
                          )}
                        >
                          <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                            <path d="M8 13h8M8 17h5" />
                          </svg>
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm font-semibold uppercase tracking-wide text-slate-100">{f.name}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400">
                      <span className="tabular-nums">{formatSize(f.size)}</span>
                      <span className="text-slate-600">·</span>
                      <span className="tabular-nums">{formatCount(preview.lineCount)} lines</span>
                      <span className="text-slate-600">·</span>
                      <span className="tabular-nums">{timeAgo(f.mtime)}</span>
                      <span className="text-slate-600">·</span>
                      <button
                        type="button"
                        title={`Download ${f.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadLog(f.name).catch((err) => setError(err.message));
                        }}
                        className="ml-auto rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
                      >
                        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        title={`Clear ${f.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          clearOne(f.name);
                        }}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                      >
                        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {active && (
            <Card
              title={active}
              subtitle={
                data && !data.error
                  ? `${formatSize(data.size)} · ${formatCount(data.lineCount)} lines · updated ${timeAgo(data.mtime)}`
                  : undefined
              }
              actions={
                <div className="flex items-center gap-2">
                  <Select
                    aria-label="Tail limit"
                    className="w-32"
                    options={TAIL_OPTIONS}
                    value={tail}
                    onChange={(e) => setTail(e.target.value)}
                  />
                  <Button variant="secondary" onClick={copyActive} disabled={!data?.lines?.length}>
                    Copy
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => downloadLog(active).catch((e) => setError(e.message))}
                  >
                    Download
                  </Button>
                </div>
              }
            >
              {loadingContent ? (
                <div className="flex items-center justify-center py-16">
                  <Spinner className="h-6 w-6" />
                </div>
              ) : data?.error ? (
                <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{data.error}</div>
              ) : (
                <>
                  {data?.truncated && (
                    <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                      File is large — showing the last {data.tailLimit.toLocaleString()} of {data.lineCount.toLocaleString()} lines.
                    </p>
                  )}
                  <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-300">
                    {data?.lines?.length ? data.lines.join("\n") : "(empty log file)"}
                  </pre>
                </>
              )}
            </Card>
          )}
        </div>
      )}

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50">
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-200 shadow-xl">{toast}</div>
        </div>
      )}
    </div>
  );
}
