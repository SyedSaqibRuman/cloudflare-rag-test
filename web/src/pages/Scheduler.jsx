import { useState } from "react";
import { api } from "../api";
import { Card, Button, Input, Select, Badge, Empty, Spinner, Modal, Toast } from "../components/ui";
import { useCompanies } from "../context";
import { JOB_IDS } from "../models";
import { usePoll } from "../hooks";
import { useHeaderActions } from "../components/Layout";
import { formatDate } from "../util";

const JOB_LABELS = {
  ingest: "Ingest Job",
  testing: "Testing Job",
};

const JOB_DESC = {
  ingest: "Synchronizes the company knowledge source into the vector knowledge base",
  testing: "Runs the test workflow",
};

export default function Scheduler() {
  const { company, companies } = useCompanies();
  const [jobs, setJobs] = useState([]);
  const [status, setStatus] = useState(null);
  const [presets, setPresets] = useState([]);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(null);
  const [cronOpen, setCronOpen] = useState(false);
  const [cronForm, setCronForm] = useState({ jobId: JOB_IDS[0], schedule: "0 6 * * *", companyName: company });
  const [presetModal, setPresetModal] = useState(null);
  const [presetForm, setPresetForm] = useState({ name: "", schedule: "" });

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    setError(null);
    try {
      const [j, s, p] = await Promise.all([
        api("/cloudflare/jobs"),
        api("/cloudflare/status"),
        api("/cloudflare/presets"),
      ]);
      setJobs(j.jobs || []);
      setStatus(s);
      setPresets(p.presets || []);
    } catch (e) {
      setError(e.message);
    }
  };

  usePoll(load, 5000);

  const running = status?.standalone || [];
  const crons = status?.cron || [];

  const startJob = async (jobId, companyName) => {
    setBusy(jobId);
    setError(null);
    try {
      const body = { jobId };
      if (companyName) body.companyName = companyName;
      const res = await api("/cloudflare/job/start", { method: "POST", body });
      notify(res.message || `Job '${jobId}' started.`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const stopJob = async (jobId, companyName) => {
    setBusy(jobId);
    setError(null);
    try {
      const body = { jobId };
      if (companyName) body.companyName = companyName;
      const res = await api("/cloudflare/job/stop", { method: "POST", body });
      notify(res.message || "Job stopped.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const stopCron = async (jobId, companyName) => {
    setBusy(jobId);
    setError(null);
    try {
      const body = { jobId };
      if (companyName) body.companyName = companyName;
      const res = await api("/cloudflare/cron/stop", { method: "POST", body });
      notify(res.message || "Schedule stopped.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const startCron = async () => {
    setError(null);
    try {
      const body = { jobId: cronForm.jobId, schedule: cronForm.schedule };
      if (cronForm.companyName) body.companyName = cronForm.companyName;
      const res = await api("/cloudflare/cron/start", { method: "POST", body });
      notify(res.message || "Cron scheduled.");
      setCronOpen(false);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const openCronWithSchedule = (schedule) => {
    setCronForm((f) => ({ ...f, schedule }));
    setCronOpen(true);
  };

  const openPresetCreate = () => {
    setPresetForm({ name: "", schedule: "0 6 * * *" });
    setPresetModal("create");
  };

  const openPresetEdit = (preset) => {
    setPresetForm({ name: preset.name, schedule: preset.schedule });
    setPresetModal(preset.id);
  };

  const savePreset = async () => {
    if (!presetForm.name.trim() || !presetForm.schedule.trim()) return;
    setError(null);
    try {
      const body = { name: presetForm.name.trim(), schedule: presetForm.schedule.trim() };
      if (presetModal === "create") {
        await api("/cloudflare/presets", { method: "POST", body });
        notify("Preset created.");
      } else {
        await api(`/cloudflare/presets/${presetModal}`, { method: "PUT", body });
        notify("Preset updated.");
      }
      setPresetModal(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  const removePreset = async (preset) => {
    if (!window.confirm(`Delete preset '${preset.name}'?`)) return;
    setError(null);
    try {
      await api(`/cloudflare/presets/${preset.id}`, { method: "DELETE" });
      notify("Preset deleted.");
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Badge tone={status?.mode === "active" ? "green" : "slate"}>
        {status?.mode === "active" ? "Active" : "Idle"}
      </Badge>
      <Button onClick={() => setCronOpen(true)}>Schedule Cron</Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <Card title="Registered Jobs" subtitle="Job types available on this server">
        {jobs.length === 0 ? (
          <Empty message="No registered jobs." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {jobs.map((job) => (
              <div key={job.id} className="flex items-start justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{JOB_LABELS[job.id] || job.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{job.description || JOB_DESC[job.id] || "—"}</p>
                  <p className="mt-1 text-[11px] font-mono text-slate-600">id: {job.id}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Button onClick={() => startJob(job.id, company)} disabled={busy === job.id}>
                    {busy === job.id ? <Spinner className="h-3.5 w-3.5" /> : "Run now"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Schedule Presets"
        subtitle="Reusable cron schedules persisted in SQLite"
        actions={<Button onClick={openPresetCreate}>New Preset</Button>}
      >
        {presets.length === 0 ? (
          <Empty message="No presets yet. Create one to reuse a schedule." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {presets.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">{p.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-indigo-300">{p.schedule}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="secondary" onClick={() => openCronWithSchedule(p.schedule)}>
                    Use
                  </Button>
                  <Button variant="ghost" onClick={() => openPresetEdit(p)}>
                    Edit
                  </Button>
                  <Button variant="ghost" className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => removePreset(p)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title="Standalone Jobs" subtitle={`${running.length} running`}>
          {running.length === 0 ? (
            <Empty message="No standalone jobs running." />
          ) : (
            <div className="space-y-3">
              {running.map((j, idx) => (
                <div key={`${j.jobId}-${idx}`} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{JOB_LABELS[j.jobId] || j.jobId}</p>
                    <p className="text-xs text-slate-500">
                      {j.companyName ? `Company: ${j.companyName}` : "Global"} · started {formatDate(j.startedAt)}
                    </p>
                  </div>
                  <Button variant="danger" onClick={() => stopJob(j.jobId, j.companyName)} disabled={busy === j.jobId}>
                    {busy === j.jobId ? <Spinner className="h-3.5 w-3.5" /> : "Stop"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Cron Schedules" subtitle={`${crons.length} scheduled`}>
          {crons.length === 0 ? (
            <Empty message="No cron schedules active." />
          ) : (
            <div className="space-y-3">
              {crons.map((c, idx) => (
                <div key={`${c.jobId}-${idx}`} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{JOB_LABELS[c.jobId] || c.jobId}</p>
                    <p className="text-xs text-slate-500">
                      {c.companyName ? `Company: ${c.companyName}` : "Global"} · <span className="font-mono">{c.schedule}</span> · runs: <span className="tabular-nums">{c.runCount ?? 0}</span>
                    </p>
                    {c.lastRun && <p className="text-[11px] text-slate-600">last run {formatDate(c.lastRun)}</p>}
                  </div>
                  <Button variant="danger" onClick={() => stopCron(c.jobId, c.companyName)} disabled={busy === c.jobId}>
                    {busy === c.jobId ? <Spinner className="h-3.5 w-3.5" /> : "Stop"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={cronOpen}
        title="Schedule Cron Job"
        onClose={() => setCronOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCronOpen(false)}>
              Cancel
            </Button>
            <Button onClick={startCron} disabled={!cronForm.jobId || !cronForm.schedule}>
              Schedule
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Job"
            value={cronForm.jobId}
            onChange={(e) => setCronForm({ ...cronForm, jobId: e.target.value })}
            options={JOB_IDS.map((id) => ({ value: id, label: JOB_LABELS[id] || id }))}
          />
          <div>
            <Select
              label="Preset schedule"
              value={cronForm.schedule}
              onChange={(e) => setCronForm({ ...cronForm, schedule: e.target.value })}
              options={[
                { value: "", label: "Custom…" },
                ...presets.map((p) => ({ value: p.schedule, label: `${p.name} (${p.schedule})` })),
              ]}
            />
            <Input
              className="mt-2 font-mono"
              placeholder="Custom: 0 6 * * *"
              value={cronForm.schedule}
              onChange={(e) => setCronForm({ ...cronForm, schedule: e.target.value })}
            />
          </div>
          <Select
            label="Company (optional)"
            value={cronForm.companyName}
            onChange={(e) => setCronForm({ ...cronForm, companyName: e.target.value })}
            options={[
              { value: "", label: "Global (no company)" },
              ...companies.map((c) => ({ value: c.name, label: c.COMPANY_NAME || c.name })),
            ]}
          />
        </div>
      </Modal>

      <Modal
        open={presetModal !== null}
        title={presetModal === "create" ? "New Preset" : "Edit Preset"}
        onClose={() => setPresetModal(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPresetModal(null)}>
              Cancel
            </Button>
            <Button onClick={savePreset} disabled={!presetForm.name.trim() || !presetForm.schedule.trim()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Name"
            placeholder="e.g. Nightly sync"
            value={presetForm.name}
            onChange={(e) => setPresetForm({ ...presetForm, name: e.target.value })}
          />
          <Input
            label="Cron expression"
            className="font-mono"
            placeholder="0 6 * * *"
            value={presetForm.schedule}
            onChange={(e) => setPresetForm({ ...presetForm, schedule: e.target.value })}
          />
        </div>
      </Modal>

      <Toast message={toast} />
    </div>
  );
}
