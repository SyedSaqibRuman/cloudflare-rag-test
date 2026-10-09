// --------------------------
// WORKFLOWS PAGE — list + create/edit modal + run/abort lifecycle
// Design: dark theme with slate-* colors matching the rest of the app
// --------------------------
import { useState, useEffect } from "react";
import { useCompanies } from "../context.jsx";
import {
  Card, Button, Empty, Spinner, StatCard, Modal, Input, TextArea, Select, SkeletonCard, IconButton,
} from "../components/ui";
import WorkflowStepEditor from "../components/WorkflowStepEditor.jsx";
import { triggerNextStep } from "../components/NextStepPrompt";
import { useHeaderActions } from "../components/Layout";
import { parseUtcDate } from "../util";
import { api } from "../api";
import { useToast } from "../hooks";

const STATUS_COLORS = {
  draft: "bg-slate-700 text-slate-300",
  active: "bg-emerald-500/15 text-emerald-400",
  paused: "bg-amber-500/15 text-amber-400",
  archived: "bg-rose-500/15 text-rose-400",
};

const TRIGGER_COLORS = {
  manual: "bg-indigo-500/15 text-indigo-400",
  webhook: "bg-purple-500/15 text-purple-400",
  schedule: "bg-cyan-500/15 text-cyan-400",
  event: "bg-orange-500/15 text-orange-400",
};


export default function Workflows() {
  const { company } = useCompanies();
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const { notify } = useToast();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [historyModal, setHistoryModal] = useState(null);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async () => {
    if (!company) return;
    setLoading(true);
    try {
      const data = await api("/gateway/workflows", { company });
      setWorkflows(data.workflows || []);
    } catch (e) {
      notify(e.message, "red");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [company]);

  const openCreate = () => {
    setForm({
      workflowName: "", workflowKey: "", description: "",
      triggerType: "manual", definition: { steps: [] },
    });
    setModal("create");
  };

  const openEdit = (wf) => {
    setForm({
      workflowName: wf.workflow_name,
      workflowKey: wf.workflow_key,
      description: wf.description || "",
      triggerType: wf.trigger_type || "manual",
      definition: wf.definition || { steps: [] },
    });
    setModal({ edit: wf });
  };

  const autoSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const handleSave = async () => {
    if (!company) return;
    setSaving(true);
    try {
      const body = { ...form };
      if (!body.workflowKey && modal === "create") body.workflowKey = autoSlug(body.workflowName);
      if (modal === "create") {
        await api("/gateway/workflows", { method: "POST", body, company });
        notify(`Workflow '${body.workflowKey}' created.`, "green");
        triggerNextStep("workflow-created");
      } else {
        await api(`/gateway/workflows/${modal.edit.workflow_key}`, { method: "PUT", body, company });
        notify("Workflow updated.", "green");
      }
      setModal(null);
      load();
    } catch (e) {
      notify(e.message, "red");
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async (key) => {
    if (!company) return;
    setRunning(key);
    setRunResult(null);
    try {
      const result = await api(`/gateway/workflows/${key}/run`, { method: "POST", company });
      setRunResult({ key, ...result });
      notify(`Run ${result.status}: ${result.durationMs}ms`, result.status === "completed" ? "green" : "amber");
      load();
    } catch (e) {
      notify(e.message, "red");
    } finally {
      setRunning(null);
    }
  };

  const handleActivate = async (key) => {
    if (!company) return;
    try {
      await api(`/gateway/workflows/${key}/activate`, { method: "POST", company });
      notify("Workflow activated.", "green");
      load();
    } catch (e) {
      notify(e.message, "red");
    }
  };

  const handlePause = async (key) => {
    if (!company) return;
    try {
      await api(`/gateway/workflows/${key}/pause`, { method: "POST", company });
      notify("Workflow paused.", "green");
      load();
    } catch (e) {
      notify(e.message, "red");
    }
  };

  const handleDelete = async (key) => {
    if (!company) return;
    if (!window.confirm(`Delete workflow '${key}'?`)) return;
    try {
      await api(`/gateway/workflows/${key}`, { method: "DELETE", company });
      notify("Workflow deleted.", "green");
      load();
    } catch (e) {
      notify(e.message, "red");
    }
  };

  const loadHistory = async (wf) => {
    if (!company) return;
    setHistoryModal({ workflowKey: wf.workflow_key, workflowName: wf.workflow_name });
    setHistoryLoading(true);
    setHistoryRuns([]);
    try {
      const data = await api(`/gateway/workflows/${wf.workflow_key}/runs`, { company });
      setHistoryRuns(data.runs || []);
    } catch (e) {
      notify(e.message, "red");
    } finally {
      setHistoryLoading(false);
    }
  };

  const active = workflows.filter((w) => w.status === "active").length;

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={load} disabled={loading}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
      <Button onClick={openCreate} className="whitespace-nowrap">+ Create Workflow</Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Total" value={workflows.length} />
        <StatCard label="Active" value={active} className="text-emerald-400" />
        <StatCard label="Drafts" value={workflows.filter((w) => w.status === "draft").length} />
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>
      ) : workflows.length === 0 ? (
        <Empty message="No workflows yet. Create one to automate tasks." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {workflows.map((wf) => (
            <Card key={wf.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-slate-100">{wf.workflow_name}</h3>
                  <p className="text-xs text-slate-500 font-mono">{wf.workflow_key}</p>
                </div>
                <div className="flex gap-1">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[wf.status] || STATUS_COLORS.draft}`}>
                    {wf.status}
                  </span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${TRIGGER_COLORS[wf.trigger_type] || TRIGGER_COLORS.manual}`}>
                    {wf.trigger_type}
                  </span>
                </div>
              </div>

              {wf.description && (
                <p className="text-xs text-slate-400 mb-3 line-clamp-2">{wf.description}</p>
              )}

              <div className="text-xs text-slate-500 mb-3">
                {wf.definition?.steps?.length || 0} steps
                {wf.assistant_name && <> · Assistant: {wf.assistant_name}</>}
              </div>

              {runResult?.key === wf.workflow_key && (
                <div className={`text-xs p-2 rounded mb-3 border ${runResult.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border-rose-500/20"}`}>
                  Last run: {runResult.status} · {runResult.durationMs}ms · {runResult.steps?.length} steps
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-800">
                <Button size="sm" onClick={() => handleRun(wf.workflow_key)} disabled={running === wf.workflow_key}>
                  {running === wf.workflow_key ? <><Spinner className="h-3 w-3" /> Running…</> : "▶ Run"}
                </Button>
                {wf.status === "draft" && (
                  <Button size="sm" variant="outline" onClick={() => handleActivate(wf.workflow_key)}>Activate</Button>
                )}
                {wf.status === "active" && (
                  <Button size="sm" variant="outline" onClick={() => handlePause(wf.workflow_key)} className="text-amber-400">Pause</Button>
                )}
                <IconButton title="View run history" className="hover:text-cyan-300" onClick={() => loadHistory(wf)}>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                </IconButton>
                <IconButton title="Edit workflow" onClick={() => openEdit(wf)}>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                </IconButton>
                <IconButton title="Delete workflow" className="hover:text-rose-300" onClick={() => handleDelete(wf.workflow_key)}>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </IconButton>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {modal && (
        <Modal open={modal !== null} onClose={() => setModal(null)} title={modal.edit ? "Edit Workflow" : "Create Workflow"} wide>
          <div className="space-y-4 p-1">
            <Input
              label="Name"
              value={form.workflowName || ""}
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({
                  ...f,
                  workflowName: name,
                  workflowKey: modal === "create" ? autoSlug(name) : f.workflowKey,
                }));
              }}
              placeholder="Nightly Ingestion"
            />
            <Input
              label="Key"
              value={form.workflowKey || ""}
              onChange={(e) => setForm((f) => ({ ...f, workflowKey: e.target.value }))}
              disabled={!!modal.edit}
            />
            <TextArea
              label="Description"
              value={form.description || ""}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Automatically ingest content every night"
              rows={2}
            />
            <Select
              label="Trigger Type"
              options={["manual", "webhook", "schedule", "event"]}
              value={form.triggerType || "manual"}
              onChange={(e) => setForm((f) => ({ ...f, triggerType: e.target.value }))}
            />
            <WorkflowStepEditor
              steps={form.definition?.steps || []}
              onChange={(steps) => setForm((f) => ({ ...f, definition: { ...f.definition, steps } }))}
            />
          </div>
          <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-800">
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? <><Spinner className="h-3.5 w-3.5" /> Saving…</> : "Save"}</Button>
          </div>
        </Modal>
      )}

      {/* Run History Modal */}
      {historyModal && (
        <Modal open={historyModal !== null} onClose={() => setHistoryModal(null)} title={`Run History — ${historyModal.workflowName}`} wide>
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-6 w-6" />
            </div>
          ) : historyRuns.length === 0 ? (
            <Empty message="No runs yet. Click '▶ Run' to execute this workflow." />
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Trigger</th>
                      <th className="pb-2 font-medium">Steps</th>
                      <th className="pb-2 font-medium">Duration</th>
                      <th className="pb-2 font-medium">Started</th>
                      <th className="pb-2 font-medium">Run ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {historyRuns.map((run) => (
                      <tr key={run.runId || run.id} className="text-slate-300">
                        <td className="py-2">
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                            run.status === "completed" ? "bg-emerald-500/15 text-emerald-400" :
                            run.status === "failed" ? "bg-rose-500/15 text-rose-400" :
                            run.status === "aborted" ? "bg-amber-500/15 text-amber-400" :
                            run.status === "running" ? "bg-blue-500/15 text-blue-400" :
                            "bg-slate-700 text-slate-300"
                          }`}>{run.status}</span>
                        </td>
                        <td className="py-2 text-xs">{run.triggerType || "—"}</td>
                        <td className="py-2 text-xs">
                          {Array.isArray(run.steps) ? (
                            <div className="flex flex-wrap gap-1">
                              {run.steps.map((s, i) => (
                                <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  s.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                                  s.status === "failed" ? "bg-rose-500/10 text-rose-400" :
                                  s.status === "skipped" ? "bg-slate-700 text-slate-400" :
                                  "bg-blue-500/10 text-blue-400"
                                }`}>{s.type}:{s.status}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-2 text-xs font-mono">
                          {run.durationMs != null ? `${run.durationMs}ms` : "—"}
                        </td>
                        <td className="py-2 text-xs text-slate-500">
                          {run.startedAt ? parseUtcDate(run.startedAt)?.toLocaleString() : "—"}
                        </td>
                        <td className="py-2 text-[10px] font-mono text-slate-500 max-w-[120px] truncate">
                          {run.runId || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-slate-500">Showing {historyRuns.length} most recent runs.</p>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
