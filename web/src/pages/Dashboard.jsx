import { useEffect, useState } from "react";
import { api, health as fetchHealth } from "../api";
import { Card, Badge, StatCard, Empty, Spinner } from "../components/ui";
import { useCompanies } from "../context";
import { formatDate, timeAgo, shorten } from "../util";

export default function Dashboard() {
  const { company } = useCompanies();
  const [health, setHealth] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [indexes, setIndexes] = useState([]);
  const [buckets, setBuckets] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setError(null);
    try {
      const [h, c, i, b, s] = await Promise.all([
        fetchHealth(),
        api("/cloudflare/companies"),
        api("/cloudflare/indexes"),
        api("/cloudflare/buckets"),
        api("/cloudflare/status"),
      ]);
      setHealth(h);
      setCompanies(c.companies || []);
      setIndexes(i.indexes || []);
      setBuckets(b.buckets || []);
      setStatus(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  const running = status?.standalone || [];
  const crons = status?.cron || [];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Dashboard</h1>
          <p className="text-sm text-slate-400 mt-1">Platform overview and live system state</p>
        </div>
        <div className="text-right text-xs text-slate-500">
          {health ? (
            <>
              <p>Uptime: <span className="text-slate-300">{Math.floor(health.uptime)}s</span></p>
              <p>Last check: {timeAgo(health.timestamp ? new Date(health.timestamp).toISOString() : null)}</p>
            </>
          ) : (
            <span className="text-rose-400">Server not reachable</span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Companies"
          value={loading ? "…" : companies.length}
          tone="indigo"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M19 21V9a2 2 0 0 0-2-2h-2" /></svg>
          }
        />
        <StatCard
          label="Vector Indexes"
          value={loading ? "…" : indexes.length}
          tone="cyan"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
          }
        />
        <StatCard
          label="R2 Buckets"
          value={loading ? "…" : buckets.length}
          tone="amber"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v10l9 4 9-4V7l-9-4-9 4z" /><path d="M3 7l9 4 9-4M12 11v10" /></svg>
          }
        />
        <StatCard
          label="Active Jobs"
          value={loading ? "…" : running.length + crons.length}
          tone="green"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card
          title="Companies"
          subtitle="Tenants registered on the platform"
        >
          {companies.length === 0 ? (
            <Empty message="No companies registered yet." />
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Assistant</th>
                    <th className="pb-2 font-medium">Source</th>
                    <th className="pb-2 font-medium">Vector Index</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {companies.map((c) => (
                    <tr key={c.name} className="text-slate-300">
                      <td className="py-2.5 font-medium text-slate-100">{c.name}</td>
                      <td className="py-2.5">{c.CONSULTANT_NAME || "—"}</td>
                      <td className="py-2.5">{shorten(c.BASE_URL, 30)}</td>
                      <td className="py-2.5">{c.VECTOR_INDEX ? <Badge tone="cyan">{c.VECTOR_INDEX}</Badge> : <span className="text-slate-600">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Active Jobs" subtitle="Standalone and scheduled tasks">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Spinner /></div>
          ) : running.length === 0 && crons.length === 0 ? (
            <Empty message="No jobs currently running or scheduled." />
          ) : (
            <div className="space-y-3">
              {running.map((j, idx) => (
                <div key={`s-${idx}`} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{j.jobId}</p>
                    <p className="text-xs text-slate-500">{j.companyName ? `Company: ${j.companyName}` : "Global"} · started {formatDate(j.startedAt)}</p>
                  </div>
                  <Badge tone="green">Running</Badge>
                </div>
              ))}
              {crons.map((c, idx) => (
                <div key={`c-${idx}`} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{c.jobId}</p>
                    <p className="text-xs text-slate-500">
                      {c.companyName ? `Company: ${c.companyName}` : "Global"} · {c.schedule} · runs: {c.runCount ?? 0}
                    </p>
                  </div>
                  <Badge tone="indigo">Scheduled</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
