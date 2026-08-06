import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Badge, StatCard, Empty, Spinner, Button } from "../components/ui";
import { useCompanies } from "../context";
import { formatDate, shorten, companyStatus, cx } from "../util";

function Dot({ tone = "green" }) {
  const colors = {
    green: "bg-emerald-400",
    amber: "bg-amber-400",
    slate: "bg-slate-500",
  };
  return <span className={cx("inline-block h-1.5 w-1.5 shrink-0 rounded-full", colors[tone])} />;
}

export default function Dashboard({ navigate }) {
  const { company } = useCompanies();
  const [companies, setCompanies] = useState([]);
  const [indexes, setIndexes] = useState([]);
  const [buckets, setBuckets] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setError(null);
    try {
      const [c, i, b, s] = await Promise.all([
        api("/cloudflare/companies"),
        company ? api("/cloudflare/indexes", { company }) : Promise.resolve({ indexes: [] }),
        company ? api("/cloudflare/buckets", { company }) : Promise.resolve({ buckets: [] }),
        api("/cloudflare/status"),
      ]);
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
  }, [company]);

  const running = status?.standalone || [];
  const crons = status?.cron || [];
  const totalJobs = running.length + crons.length;
  const anyCreds = companies.some((c) => c.hasCredentials);
  const needSetup = companies.filter((c) => companyStatus(c).label !== "Healthy").length;

  const services = [
    { name: "Cloudflare", ok: anyCreds, detail: anyCreds ? "Credentials configured" : "No credentials yet" },
    { name: "Workers AI", ok: anyCreds, detail: anyCreds ? "Healthy" : "Needs credentials" },
    { name: "Vectorize", ok: indexes.length > 0, detail: indexes.length > 0 ? `${indexes.length} index${indexes.length === 1 ? "" : "es"}` : "No index in workspace" },
    { name: "R2 Storage", ok: buckets.length > 0, detail: buckets.length > 0 ? `${buckets.length} bucket${buckets.length === 1 ? "" : "s"}` : "No bucket in workspace" },
  ];

  const actions = [
    { label: "New Company", desc: "Register a tenant", onClick: () => navigate("companies"), icon: <PlusIcon /> },
    { label: "Create Vector Index", desc: "Provision a Vectorize index", onClick: () => navigate("cloudflare"), icon: <LayersIcon /> },
    { label: "Run Ingestion", desc: "Sync content from the source", onClick: () => navigate("scheduler"), icon: <PlayIcon /> },
    { label: "Open Ask Console", desc: "Test the assistant live", onClick: () => navigate("ask"), icon: <ChatIcon /> },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
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
          meta={
            loading || companies.length === 0 ? (
              <span className="text-slate-500">{loading ? "Checking…" : "No tenants"}</span>
            ) : needSetup === 0 ? (
              <span className="flex items-center gap-1.5 text-emerald-400"><Dot />All configured</span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-400"><Dot tone="amber" />{needSetup} need setup</span>
            )
          }
        />
        <StatCard
          label="Vector Indexes"
          value={loading ? "…" : indexes.length}
          tone="cyan"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
          }
          meta={
            loading ? (
              <span className="text-slate-500">Checking…</span>
            ) : indexes.length > 0 ? (
              <span className="flex items-center gap-1.5 text-emerald-400"><Dot />Configured</span>
            ) : (
              <span className="flex items-center gap-1.5 text-slate-500"><Dot tone="slate" />Not configured</span>
            )
          }
        />
        <StatCard
          label="R2 Buckets"
          value={loading ? "…" : buckets.length}
          tone="amber"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v10l9 4 9-4V7l-9-4-9 4z" /><path d="M3 7l9 4 9-4M12 11v10" /></svg>
          }
          meta={
            loading ? (
              <span className="text-slate-500">Checking…</span>
            ) : buckets.length > 0 ? (
              <span className="flex items-center gap-1.5 text-emerald-400"><Dot />Connected</span>
            ) : (
              <span className="flex items-center gap-1.5 text-slate-500"><Dot tone="slate" />Not configured</span>
            )
          }
        />
        <StatCard
          label="Active Jobs"
          value={loading ? "…" : totalJobs}
          tone="green"
          icon={
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
          }
          meta={
            loading ? (
              <span className="text-slate-500">Checking…</span>
            ) : totalJobs > 0 ? (
              <span className="flex items-center gap-1.5 text-emerald-400"><Dot />Active</span>
            ) : (
              <span className="flex items-center gap-1.5 text-slate-500"><Dot tone="slate" />Idle</span>
            )
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="System Health" subtitle="Connectivity across the stack">
          <div className="space-y-1">
            {services.map((s) => (
              <div key={s.name} className="flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-slate-800/40">
                <span className="flex items-center gap-2.5 text-sm font-medium text-slate-200">
                  <Dot tone={s.ok ? "green" : "amber"} />
                  {s.name}
                </span>
                <span className={cx("text-xs", s.ok ? "text-emerald-400" : "text-amber-400")}>{s.detail}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Quick Actions" subtitle="Common tasks">
          <div className="space-y-1">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={a.onClick}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-slate-800/40"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-300">{a.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-slate-100">{a.label}</span>
                  <span className="block text-xs text-slate-500">{a.desc}</span>
                </span>
                <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}
          </div>
        </Card>
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
                    <th className="pb-2 font-medium">Company</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Vector Index</th>
                    <th className="pb-2 font-medium">R2 Bucket</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {companies.map((c) => {
                    const st = companyStatus(c);
                    return (
                      <tr key={c.name} className="text-slate-300">
                        <td className="py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-400">
                              <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
                                <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
                                <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
                                <path d="M10 6h4" />
                                <path d="M10 10h4" />
                                <path d="M10 14h4" />
                                <path d="M10 18h4" />
                              </svg>
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium text-slate-100 leading-tight">{c.COMPANY_NAME || c.name}</p>
                              <p className="text-xs text-slate-500 truncate">
                                {c.CONSULTANT_NAME ? `${c.CONSULTANT_NAME} · ` : ""}{shorten(c.BASE_URL, 24)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5"><Badge tone={st.tone}>{st.label}</Badge></td>
                        <td className="py-2.5">{c.VECTOR_INDEX ? <Badge tone="cyan">{c.VECTOR_INDEX}</Badge> : <span className="text-slate-600">—</span>}</td>
                        <td className="py-2.5">{c.R2_BUCKET_NAME ? <Badge tone="amber">{c.R2_BUCKET_NAME}</Badge> : <span className="text-slate-600">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Active Jobs" subtitle="Standalone and scheduled tasks">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Spinner /></div>
          ) : totalJobs === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800 text-slate-400">
                <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">No active jobs</p>
                <p className="text-xs text-slate-500 mt-1 max-w-[260px]">Start an ingestion job or create a schedule to keep content in sync.</p>
              </div>
              <Button variant="secondary" onClick={() => navigate("scheduler")}>Go to Scheduler</Button>
            </div>
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

function PlusIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 2 8.5 4.5L12 11 3.5 6.5 12 2z" />
      <path d="m3.5 12 8.5 4.5L20.5 12" />
      <path d="m3.5 17.5 8.5 4.5 8.5-4.5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
