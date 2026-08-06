import { useEffect, useState } from "react";
import { listLogs, readLog } from "../api";
import { Card, Button, Spinner, Empty } from "../components/ui";
import { useHeaderActions } from "../components/Layout";
import { formatDate } from "../util";

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function Logs() {
  const [files, setFiles] = useState([]);
  const [active, setActive] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setError(null);
    try {
      const res = await listLogs();
      setFiles(res.files || []);
      setActive((prev) => {
        if (prev && (res.files || []).some((f) => f.name === prev)) return prev;
        return res.files?.[0]?.name || null;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!active) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoadingContent(true);
    readLog(active)
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
  }, [active, files]);

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={load} disabled={loading}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {files.length === 0 && !loading ? (
        <Card>
          <Empty message={error ? "Could not load logs." : "No log files found yet."} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
          <Card title="Log Files" subtitle={`${files.length} files`} className="h-fit">
            <div className="-mx-5 -mb-5 space-y-1 px-2 py-2">
              {files.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => setActive(f.name)}
                  className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                    active === f.name ? "bg-indigo-500/15 text-indigo-200" : "text-slate-300 hover:bg-slate-800/70 hover:text-slate-100"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs">{f.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{formatSize(f.size)}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{formatDate(f.mtime)}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card
            title={active || "Log"}
            subtitle={
              data && !data.error
                ? `${formatSize(data.size)} · ${data.lineCount.toLocaleString()} lines · updated ${formatDate(data.mtime)}`
                : undefined
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
                <pre className="max-h-[70vh] overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-300">
                  {data?.lines?.length ? data.lines.join("\n") : "(empty log file)"}
                </pre>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
