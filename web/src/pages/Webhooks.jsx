// --------------------------
// WEBHOOKS PAGE — manage webhook endpoints + delivery history
// Design: dark theme with slate-* colors matching the rest of the app
// --------------------------
import { useState, useEffect, useCallback } from "react";
import { useCompanies } from "../context.jsx";
import {
  Card, Button, Badge, Empty, Spinner, StatCard, Modal, Toast, Input, SkeletonCard, IconButton,
} from "../components/ui";
import { useHeaderActions } from "../components/Layout";
import { api } from "../api";

const EVENT_TYPES = [
  "ingestion.completed",
  "ingestion.failed",
  "workflow.completed",
  "workflow.failed",
  "credential.rotated",
  "cost.threshold",
];

export default function Webhooks() {
  const { company } = useCompanies();
  const [webhooks, setWebhooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsModal, setLogsModal] = useState(null);

  const closeModal = useCallback(() => setModal(null), []);
  const closeLogsModal = useCallback(() => setLogsModal(null), []);

  const load = async () => {
    if (!company) return;
    setLoading(true);
    try {
      const data = await api("/gateway/webhooks", { company });
      setWebhooks(data.webhooks || []);
    } catch (e) {
      setToast({ tone: "red", message: e.message });
    } finally {
      setLoading(false);
    }
  };

  // Reload on company change
  useEffect(() => { load(); }, [company]);

  const openCreate = () => {
    setForm({ url: "", events: ["ingestion.completed", "ingestion.failed"], secret: "" });
    setModal("create");
  };

  const openEdit = (wh) => {
    setForm({ url: wh.url, events: wh.events || [], secret: wh.secret || "" });
    setModal({ edit: wh });
  };

  const handleSave = async () => {
    if (!company) return;
    setSaving(true);
    try {
      if (modal === "create") {
        await api("/gateway/webhooks", { method: "POST", body: form, company });
        setToast({ tone: "green", message: "Webhook created." });
      } else {
        await api(`/gateway/webhooks/${modal.edit.id}`, { method: "PUT", body: form, company });
        setToast({ tone: "green", message: "Webhook updated." });
      }
      setModal(null);
      // Retry load up to 3 times with delay (server may need a moment after write)
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await load();
          break;
        } catch {
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
        }
      }
    } catch (e) {
      setToast({ tone: "red", message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!company) return;
    if (!window.confirm("Delete this webhook?")) return;
    try {
      await api(`/gateway/webhooks/${id}`, { method: "DELETE", company });
      setToast({ tone: "green", message: "Webhook deleted." });
      load();
    } catch (e) {
      // If webhook not found (stale after server restart), refresh the list
      if (e.message?.includes("not found")) {
        setToast({ tone: "amber", message: "Webhook no longer exists. Refreshing list." });
        load();
      } else {
        setToast({ tone: "red", message: e.message });
      }
    }
  };

  const handleTest = async (id) => {
    if (!company) return;
    try {
      await api(`/gateway/webhooks/${id}/test`, { method: "POST", company });
      setToast({ tone: "green", message: "Test webhook sent." });
    } catch (e) {
      setToast({ tone: "red", message: e.message });
    }
  };

  const viewLogs = async (wh) => {
    setLogsModal(wh);
    setLogsLoading(true);
    setLogs([]);
    try {
      const data = await api(`/gateway/webhooks/${wh.id}/logs`, { company });
      setLogs(data.logs || []);
    } catch (e) {
      setToast({ tone: "red", message: e.message });
    } finally {
      setLogsLoading(false);
    }
  };

  const active = webhooks.filter((w) => w.is_active !== false).length;

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={load} disabled={loading}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
      <Button onClick={openCreate} className="whitespace-nowrap">+ Add Webhook</Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Total" value={webhooks.length} />
        <StatCard label="Active" value={active} className="text-emerald-400" />
        <StatCard label="Events" value={EVENT_TYPES.length} />
      </div>

      {/* Webhook cards */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>
      ) : webhooks.length === 0 ? (
        <Empty message="No webhooks configured. Add one to receive event notifications." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {webhooks.map((wh) => (
            <Card key={wh.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-slate-100 text-sm font-mono truncate">{wh.url}</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {wh.events?.length || 0} event types
                  </p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ml-2 shrink-0 ${
                  wh.is_active !== false ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-700 text-slate-400"
                }`}>
                  {wh.is_active !== false ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="flex flex-wrap gap-1 mb-3">
                {(wh.events || []).map((ev) => (
                  <span key={ev} className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                    {ev}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-800">
                <IconButton title="Test webhook" className="hover:text-emerald-300" onClick={() => handleTest(wh.id)}>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><path d="M9 15l2 2 4-4" /></svg>
                </IconButton>
                <IconButton title="View delivery logs" className="hover:text-cyan-300" onClick={() => viewLogs(wh)}>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" /></svg>
                </IconButton>
                <IconButton title="Edit webhook" onClick={() => openEdit(wh)}>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                </IconButton>
                <IconButton title="Delete webhook" className="hover:text-rose-300" onClick={() => handleDelete(wh.id)}>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </IconButton>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Delivery Logs Modal */}
      {logsModal && (
        <Modal open={logsModal !== null} onClose={closeLogsModal} title="Recent Deliveries" wide>
          {logsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-6 w-6" />
            </div>
          ) : logs.length === 0 ? (
            <Empty message="No deliveries yet. Click '🧪 Test' to send a test webhook." />
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 truncate">{logsModal.url}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                      <th className="pb-2 font-medium">Time</th>
                      <th className="pb-2 font-medium">Event</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Response</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {logs.map((log, i) => (
                      <tr key={i} className="text-slate-300">
                        <td className="py-2 text-xs text-slate-500">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 text-xs font-mono">{log.event}</td>
                        <td className="py-2">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                            log.status_code < 300
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-rose-500/15 text-rose-400"
                          }`}>
                            {log.status_code}
                          </span>
                        </td>
                        <td className="py-2 text-xs text-slate-500 truncate max-w-[200px]">{log.response}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">Showing {logs.length} most recent deliveries.</p>
            </div>
          )}
        </Modal>
      )}

      {/* Create/Edit Modal */}
      {modal && (
        <Modal open={modal !== null} onClose={closeModal} title={modal.edit ? "Edit Webhook" : "Add Webhook"}>
          <div className="space-y-4 p-1">
            <Input
              label="Webhook URL"
              value={form.url || ""}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://hooks.slack.com/services/..."
            />
            <Input
              label="Secret (optional)"
              value={form.secret || ""}
              onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
              placeholder="Signing secret for verification"
            />
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Events</label>
              <div className="space-y-1">
                {EVENT_TYPES.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={(form.events || []).includes(ev)}
                      onChange={(e) => {
                        setForm((f) => {
                          const events = f.events || [];
                          return {
                            ...f,
                            events: e.target.checked
                              ? [...events, ev]
                              : events.filter((x) => x !== ev),
                          };
                        });
                      }}
                      className="rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500/30"
                    />
                    <span className="font-mono text-xs text-slate-400">{ev}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-800">
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <><Spinner className="h-3.5 w-3.5" /> Saving…</> : "Save"}</Button>
          </div>
        </Modal>
      )}

      {toast && <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
