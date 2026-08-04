import { useState } from "react";
import { api } from "../api";
import { Card, Button, Input, Badge, Empty, Spinner, Modal } from "../components/ui";
import { useCompanies } from "../context";
import { shorten } from "../util";

export default function Companies({ navigate }) {
  const { companies, refresh, select, company } = useCompanies();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", baseUrl: "" });
  const [busy, setBusy] = useState(false);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

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
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const config = form.baseUrl.trim() ? { BASE_URL: form.baseUrl.trim() } : undefined;
      await api("/cloudflare/companies", {
        method: "POST",
        body: { name: form.name.trim(), config },
      });
      setCreateOpen(false);
      setForm({ name: "", baseUrl: "" });
      await refresh();
      notify(`Company '${form.name.trim()}' created.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name) => {
    if (!window.confirm(`Delete company '${name}'? This cannot be undone.`)) return;
    setError(null);
    try {
      await api(`/cloudflare/companies/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (company === name) select("");
      await refresh();
      notify(`Company '${name}' deleted.`);
    } catch (e) {
      setError(e.message);
    }
  };

  const reset = async (name) => {
    if (!window.confirm(`Reset company '${name}' to environment defaults?`)) return;
    setError(null);
    try {
      await api(`/cloudflare/companies/${encodeURIComponent(name)}/reset`, { method: "POST" });
      notify(`Company '${name}' reset to defaults.`);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Companies</h1>
          <p className="text-sm text-slate-400 mt-1">Tenants with isolated config, vector index, and R2 bucket</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>
            {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>New Company</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <Card>
        {companies.length === 0 && !loading ? (
          <Empty message="No companies yet. Create your first company to get started." />
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Display Name</th>
                  <th className="pb-3 font-medium">Assistant</th>
                  <th className="pb-3 font-medium">Source</th>
                  <th className="pb-3 font-medium">Vector Index</th>
                  <th className="pb-3 font-medium">R2 Bucket</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {companies.map((c) => (
                  <tr key={c.name} className="text-slate-300 hover:bg-slate-800/40">
                    <td className="py-3">
                      <button
                        className="font-medium text-indigo-300 hover:text-indigo-200 hover:underline"
                        onClick={() => {
                          select(c.name);
                          navigate("config");
                        }}
                      >
                        {c.name}
                      </button>
                    </td>
                    <td className="py-3">{c.COMPANY_NAME || "—"}</td>
                    <td className="py-3">{c.CONSULTANT_NAME || "—"}</td>
                    <td className="py-3">{shorten(c.BASE_URL, 32)}</td>
                    <td className="py-3">
                      {c.VECTOR_INDEX ? <Badge tone="cyan">{c.VECTOR_INDEX}</Badge> : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-3">
                      {c.R2_BUCKET_NAME ? <Badge tone="amber">{c.R2_BUCKET_NAME}</Badge> : <span className="text-slate-600">—</span>}
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
                ))}
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
            <Button onClick={create} disabled={!form.name.trim() || busy}>
              {busy ? <Spinner className="h-3.5 w-3.5" /> : "Create"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Company slug"
            placeholder="acme-cert"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={
              form.name && !/^[a-z0-9-]+$/.test(form.name)
                ? "Lowercase letters, numbers, and hyphens only."
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

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-200 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
