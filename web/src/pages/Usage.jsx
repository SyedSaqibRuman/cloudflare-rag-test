// --------------------------
// USAGE PAGE — token consumption, costs, and API call analytics
// --------------------------
import { useState, useEffect } from "react";
import { useCompanies } from "../context";
import { Card, StatCard, Empty, Spinner, Button, SkeletonCard, Toast, InfoTip } from "../components/ui";
import { getTermTooltip } from "../components/glossary";
import { useHeaderActions } from "../components/Layout";
import { getUsageSummary, getUsageAggregate, getUsageTop, getUsageRecent } from "../api";

function formatNumber(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatCost(n) {
  if (n == null || n === 0) return "$0.00";
  return `$${Number(n).toFixed(4)}`;
}

function formatDuration(ms) {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function BarChart({ data, labelKey, valueKey, maxBars = 8 }) {
  if (!data || data.length === 0) return <Empty message="No data" />;
  const sorted = [...data].sort((a, b) => Number(b[valueKey] || 0) - Number(a[valueKey] || 0)).slice(0, maxBars);
  const maxVal = Math.max(...sorted.map((d) => Number(d[valueKey] || 0)), 1);

  return (
    <div className="space-y-2">
      {sorted.map((d, i) => {
        const label = d.group_key || d.model_used || "—";
        const val = Number(d[valueKey] || 0);
        const pct = Math.max((val / maxVal) * 100, 2);
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-gray-600 dark:text-gray-400 w-32 truncate" title={label}>{label}</span>
            <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
              <div className="h-full bg-indigo-500 rounded" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-20 text-right">
              {valueKey.includes("cost") ? formatCost(val) : formatNumber(val)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function Usage() {
  const { company } = useCompanies();
  const [summary, setSummary] = useState(null);
  const [aggregate, setAggregate] = useState([]);
  const [topModels, setTopModels] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [groupBy, setGroupBy] = useState("day");
  const [period, setPeriod] = useState("7d");

  const getDateRange = () => {
    const now = new Date();
    let from;
    switch (period) {
      case "1d": from = new Date(now - 86400_000); break;
      case "30d": from = new Date(now - 30 * 86400_000); break;
      case "90d": from = new Date(now - 90 * 86400_000); break;
      case "7d":
      default: from = new Date(now - 7 * 86400_000); break;
    }
    return { from: from.toISOString(), to: now.toISOString() };
  };

  const load = async () => {
    if (!company) return;
    setLoading(true);
    try {
      const range = getDateRange();
      const [sum, agg, top, rec] = await Promise.all([
        getUsageSummary(company, range),
        getUsageAggregate(company, { ...range, groupBy }),
        getUsageTop(company, 8),
        getUsageRecent(company, 15),
      ]);
      setSummary(sum);
      setAggregate(agg);
      setTopModels(top);
      setRecent(rec);
    } catch (e) {
      setToast({ tone: "red", message: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [company, period, groupBy]);

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none">
        <option value="1d">Last 24h</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
      </select>
      <Button variant="secondary" onClick={load} disabled={loading}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Summary Cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="relative"><StatCard label="Total Requests" value={formatNumber(summary.total_requests)} /><InfoTip content="How many times the AI was called" className="absolute right-3 top-3" /></div>
          <div className="relative"><StatCard label="Total Tokens" value={formatNumber((Number(summary.total_input_tokens) || 0) + (Number(summary.total_output_tokens) || 0))} /><InfoTip content={getTermTooltip("token")} className="absolute right-3 top-3" /></div>
          <div className="relative"><StatCard label="Total Cost" value={formatCost(summary.total_cost_usd)} className="text-green-600" /><InfoTip content={getTermTooltip("cost-usd")} className="absolute right-3 top-3" /></div>
          <div className="relative"><StatCard label="Avg Latency" value={formatDuration(summary.avg_duration_ms)} /><InfoTip content={getTermTooltip("latency")} className="absolute right-3 top-3" /></div>
        </div>
      ) : null}

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Requests over time */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900 dark:text-white">Requests</h3>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="w-28 text-xs rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100">
              <option value="day">By Day</option>
              <option value="model">By Model</option>
              <option value="credential">By Credential</option>
            </select>
          </div>
          {loading ? <Spinner /> : <BarChart data={aggregate} labelKey="group_key" valueKey="request_count" />}
        </Card>

        {/* Top models by cost */}
        <Card className="p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Top Models by Cost</h3>
          {loading ? <Spinner /> : <BarChart data={topModels} labelKey="model_used" valueKey="total_cost_usd" />}
        </Card>
      </div>

      {/* Cost breakdown + Recent calls */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Cost over time */}
        <Card className="p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Cost Over Time</h3>
          {loading ? <Spinner /> : <BarChart data={aggregate} labelKey="group_key" valueKey="total_cost_usd" />}
        </Card>

        {/* Recent calls */}
        <Card className="p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Recent Calls</h3>
          {loading ? (
            <Spinner />
          ) : recent.length === 0 ? (
            <Empty message="No calls yet" />
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {recent.map((r) => (
                <div key={r.id} className="flex items-center gap-3 text-sm py-1 border-b border-gray-50 dark:border-gray-800 last:border-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.response_status < 400 ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="text-gray-500 w-20 flex-shrink-0 text-xs">{new Date(r.created_at).toLocaleTimeString()}</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{r.model_used || r.action}</span>
                  <span className="text-gray-400 text-xs flex-shrink-0">{r.response_status}</span>
                  <span className="text-gray-400 text-xs flex-shrink-0">{formatDuration(r.duration_ms)}</span>
                  <span className="text-green-600 text-xs flex-shrink-0">{formatCost(r.cost_usd)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {toast && <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
