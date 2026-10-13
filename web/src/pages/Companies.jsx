import { useState } from "react";
import { api } from "../api";
import { Card, Button, Input, Badge, Empty, Spinner, Modal } from "../components/ui";
import { useCompanies } from "../context";
import { companyStatus } from "../util";
import { useHeaderActions } from "../components/Layout";
import { useToast } from "../hooks";

export default function Companies({ navigate }) {
  const { companies, refresh, select, company } = useCompanies();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { notify } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [form, setForm] = useState({ name: "", baseUrl: "" });
  const [busy, setBusy] = useState(false);

  const openCreate = () => {
    setForm({ name: "", baseUrl: "" });
    setCreateError(null);
    setCreateOpen(true);
  };

  // Mirror of the server rule (config/validation.js): lowercase letters,
  // numbers, and hyphens, 2–63 chars.
  const name = form.name.trim();
  const slugOk = /^[a-z0-9-]+$/.test(name) && name.length >= 2 && name.length <= 63;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!slugOk) return;
    setBusy(true);
    setCreateError(null);
    try {
      const config = form.baseUrl.trim() ? { BASE_URL: form.baseUrl.trim() } : undefined;
      await api("/cloudflare/companies", {
        method: "POST",
        body: { name, config },
        toast: false, // page notify()s its own phrasing
      });
      setCreateOpen(false);
      setForm({ name: "", baseUrl: "" });
      await refresh();
      notify(`Company '${name}' created.`);
    } catch (e) {
      setCreateError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name) => {
    if (!window.confirm(`Delete company '${name}'? This cannot be undone.`)) return;
    setError(null);
    try {
      await api(`/cloudflare/companies/${encodeURIComponent(name)}`, { method: "DELETE", toast: false });
      if (company === name) select("");
      await refresh();
      notify(`Company '${name}' deleted.`);
    } catch (e) {
      setError(e.message);
    }
  };

  const reset = async (name) => {
    if (!window.confirm(`Reset company '${name}' to defaults?`)) return;
    setError(null);
    try {
      await api(`/cloudflare/companies/${encodeURIComponent(name)}/reset`, { method: "POST", toast: false });
      notify(`Company '${name}' reset to defaults.`);
    } catch (e) {
      setError(e.message);
    }
  };

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={load} disabled={loading}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
      <Button onClick={openCreate} className="whitespace-nowrap">New Company</Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <Card>
        {companies.length === 0 && !loading ? (
          <Empty message="No companies yet. Create your first company to get started." />
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-3 font-medium whitespace-nowrap">Company</th>
                  <th className="pb-3 font-medium whitespace-nowrap">Status</th>
                  <th className="pb-3 font-medium whitespace-nowrap min-w-[6rem]">Assistant</th>
                  <th className="pb-3 font-medium whitespace-nowrap max-w-[14rem]">Vector Index</th>
                  <th className="pb-3 font-medium whitespace-nowrap max-w-[14rem]">R2 Bucket</th>
                  <th className="pb-3 font-medium text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {companies.map((c) => {
                  const st = companyStatus(c);
                  return (
                  <tr key={c.name} className="text-slate-300 hover:bg-slate-800/40">
                    <td className="py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-400">
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
                        <div className="min-w-0">
                          <button
                            className="block font-medium text-indigo-300 hover:text-indigo-200 hover:underline leading-tight"
                            onClick={() => {
                              select(c.name);
                              navigate("config");
                            }}
                          >
                            {c.COMPANY_NAME || c.name}
                          </button>
                          <span className="block text-xs text-slate-500">{c.name}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3"><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="py-3">{c.assistantName || c.CONSULTANT_NAME || "—"}</td>
                    <td className="py-3">
                      {c.VECTOR_INDEX ? <Badge tone="cyan">{c.VECTOR_INDEX}</Badge> : <span className="text-slate-500">—</span>}
                    </td>
                    <td className="py-3">
                      {c.R2_BUCKET_NAME ? <Badge tone="amber">{c.R2_BUCKET_NAME}</Badge> : <span className="text-slate-500">—</span>}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" onClick={() => { select(c.name); navigate("config"); }}>
                          Configure
                        </Button>
                        <Button variant="ghost" onClick={() => reset(c.name)}>
                          Reset
                        </Button>
                        <Button variant="ghost" className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => remove(c.name)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={createOpen}
        title="Create Company"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={!slugOk || busy} title={slugOk ? undefined : "Lowercase letters, numbers, and hyphens, 2–63 characters"}>
              {busy ? <Spinner className="h-3.5 w-3.5" /> : "Create"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {createError && (
            <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {createError}
            </div>
          )}
          <Input
            label="Company slug"
            placeholder="acme-cert"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={
              form.name && (!slugOk)
                ? !/^[a-z0-9-]+$/.test(form.name)
                  ? "Lowercase letters, numbers, and hyphens only."
                  : "Between 2 and 63 characters."
                : undefined
            }
          />
          <Input
            label="Source website (optional)"
            placeholder="https://acme.com"
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
        </div>
      </Modal>

      {/* toast rendering: global <ToastViewport /> in App.jsx */}
    </div>
  );
}
