// --------------------------
// SCHEDULER — consolidated job management + content ingestion.
// Replaces the standalone IngestionPipeline page by merging its content
// into a tabbed layout alongside the existing job/cron/preset UI.
// --------------------------
import { useState, useEffect } from "react";
import { api, startIngestion, getIngestionJobs, getIngestionStatus, cancelIngestion, listKbs } from "../api";
import { Card, Button, Input, Select, Badge, Empty, Spinner, Modal, Tabs, TabPanel } from "../components/ui";
import { useCompanies } from "../context";
import { JOB_IDS } from "../models";
import { usePoll, useToast } from "../hooks";
import { useHeaderActions } from "../components/Layout";
import { formatDate, parseUtcDate } from "../util";

const JOB_LABELS = {
  ingest: "Ingest Job",
  testing: "Testing Job",
};

const JOB_DESC = {
  ingest: "Synchronizes the company knowledge source into the vector knowledge base",
  testing: "Runs the test workflow",
};

const INGEST_JOB_LABELS = {
  ingest: "Ingestion",
  testing: "Testing",
};

const SCOPE_MODES = [
  { id: "all", label: "Entire site", desc: "Ingest all available pages and posts." },
  { id: "selected", label: "Selected pages", desc: "Ingest specific WordPress pages or posts by ID." },
  { id: "limit", label: "Limit", desc: "Ingest up to a maximum number of API pages." },
];

export default function Scheduler() {
  const { company, companies } = useCompanies();
  const [activeTab, setActiveTab] = useState("jobs");

  // ── Jobs / Cron state ──
  const [jobs, setJobs] = useState([]);
  const [status, setStatus] = useState(null);
  const [presets, setPresets] = useState([]);
  const [error, setError] = useState(null);
  const { notify } = useToast();
  const [busy, setBusy] = useState(null);
  const [cronOpen, setCronOpen] = useState(false);
  const [cronForm, setCronForm] = useState({ jobId: JOB_IDS[0], schedule: "0 6 * * *", companyName: company, kbKey: "" });
  const [presetModal, setPresetModal] = useState(null);
  const [presetForm, setPresetForm] = useState({ name: "", schedule: "" });
  // KBs of the cron form's company — shown when scheduling an `ingest` job.
  const [cronKbs, setCronKbs] = useState([]);

  // ── Ingestion state ──
  const [ingestionJobs, setIngestionJobs] = useState([]);
  const [ingestingStatus, setIngestingStatus] = useState(null);
  const [ingestBusy, setIngestBusy] = useState(null);
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [scopeMode, setScopeMode] = useState("all");
  const [kbKey, setKbKey] = useState("");
  const [limit, setLimit] = useState("");
  const [selectedType, setSelectedType] = useState("pages");
  const [selectedIds, setSelectedIds] = useState("");

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

  const loadIngestion = async () => {
    try {
      const [j, s] = await Promise.all([
        getIngestionJobs(),
        getIngestionStatus(company),
      ]);
      setIngestionJobs(j.jobs || []);
      setIngestingStatus(s);
    } catch (e) {
      // Ingestion status is best-effort — don't overwrite the jobs error
      if (!error) setError(e.message);
    }
  };

  const loadAll = async () => {
    await Promise.all([load(), loadIngestion()]);
  };

  usePoll(loadAll, 5000, [company]);

  // Keep the cron form's company in sync with the selected company — the form
  // state is initialized once at mount, and scheduling against a stale tenant
  // after a company switch would be surprising.
  useEffect(() => {
    setCronForm((f) => ({ ...f, companyName: company, kbKey: "" }));
  }, [company]);

  // Load the company's KBs whenever the cron modal is open for the ingest
  // job — the KB select scopes the schedule to one knowledge base.
  useEffect(() => {
    if (!cronOpen || cronForm.jobId !== "ingest" || !cronForm.companyName) {
      setCronKbs([]);
      return undefined;
    }
    let cancelled = false;
    listKbs(cronForm.companyName)
      .then((d) => {
        if (!cancelled) {
          setCronKbs((d.items || []).map((k) => ({ value: k.kb_key, label: k.kb_name || k.kb_key })));
        }
      })
      .catch(() => { if (!cancelled) setCronKbs([]); }); // best-effort — a legacy schedule is still possible
    return () => { cancelled = true; };
  }, [cronOpen, cronForm.jobId, cronForm.companyName]);

  const running = status?.standalone || [];
  const crons = status?.cron || [];
  const ingestRunning = ingestingStatus?.running || ingestingStatus?.status === "running";

  // ── Jobs / Cron actions ──
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

  const stopJob = async (jobId, companyName, kbKey) => {
    setBusy(jobId);
    setError(null);
    try {
      const body = { jobId };
      if (companyName) body.companyName = companyName;
      if (kbKey) body.kbKey = kbKey;
      const res = await api("/cloudflare/job/stop", { method: "POST", body });
      notify(res.message || "Job stopped.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const stopCron = async (jobId, companyName, kbKey) => {
    setBusy(jobId);
    setError(null);
    try {
      const body = { jobId };
      if (companyName) body.companyName = companyName;
      if (kbKey) body.kbKey = kbKey;
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
      // KB-scoped schedule — the cron tick will run the KB-driven ingest
      // (kb's saved source config) instead of the legacy whole-company path.
      if (cronForm.jobId === "ingest" && cronForm.kbKey) body.kbKey = cronForm.kbKey;
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

  // ── Ingestion actions ──
  const resetIngestForm = () => {
    setScopeMode("all");
    setKbKey("");
    setLimit("");
    setSelectedType("pages");
    setSelectedIds("");
  };

  const buildScope = () => {
    switch (scopeMode) {
      case "selected": {
        const ids = selectedIds
          .split(/[,\\s]+/)
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n > 0);
        return {
          scope: "selected",
          contentTypes: [selectedType === "pages" ? "page" : "post"],
          items: ids.map((id) => ({ type: selectedType, id })),
        };
      }
      case "limit":
        return { scope: "limit", limit: parseInt(limit, 10) || null };
      case "all":
      default:
        return { scope: "all" };
    }
  };

  const isIngestStartDisabled = () => {
    if (ingestBusy === "ingest") return true;
    if (scopeMode === "limit" && (!limit || parseInt(limit, 10) < 1)) return true;
    if (scopeMode === "selected" && !selectedIds.trim()) return true;
    return false;
  };

  const startIngestionJob = async () => {
    if (!company) return;
    setIngestBusy("ingest");
    setError(null);
    try {
      const scope = buildScope();
      const res = await startIngestion(company, kbKey || null, scope);
      notify(res.message || "Ingestion started.");
      setShowIngestModal(false);
      resetIngestForm();
      await loadAll();
    } catch (e) {
      setError(e.message);
    } finally {
      setIngestBusy(null);
    }
  };

  const stopIngestionJob = async () => {
    setIngestBusy("ingest");
    setError(null);
    try {
      await cancelIngestion(company);
      notify("Ingestion cancelled.");
      await loadAll();
    } catch (e) {
      setError(e.message);
    } finally {
      setIngestBusy(null);
    }
  };

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      {activeTab === "jobs" ? (
        <>
          <Badge tone={status?.mode === "active" ? "green" : "slate"}>
            {status?.mode === "active" ? "Active" : "Idle"}
          </Badge>
          <Button onClick={() => setCronOpen(true)} className="whitespace-nowrap">Schedule Cron</Button>
        </>
      ) : (
        <>
          <Badge tone={ingestRunning ? "green" : "slate"}>
            {ingestRunning ? "Running" : "Idle"}
          </Badge>
          <Button onClick={() => { resetIngestForm(); setShowIngestModal(true); }} disabled={!company || ingestBusy === "ingest"} className="whitespace-nowrap">
            {ingestBusy === "ingest" ? <Spinner className="h-3.5 w-3.5" /> : "Start Ingestion"}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <Tabs
        tabs={[
          { id: "jobs", label: "Jobs & Schedules" },
          { id: "ingestion", label: "Ingestion" },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      >
        {/* ─── Tab 1: Jobs & Schedules ─── */}
        <TabPanel id="jobs" active={activeTab}>
          <div className="space-y-6">
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
                        <p className="mt-1 text-[11px] font-mono text-slate-500">id: {job.id}</p>
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
                            {j.companyName ? `Company: ${j.companyName}` : "Global"}
                            {j.kbKey ? ` · KB: ${j.kbKey}` : ""} · started {formatDate(j.startedAt)}
                          </p>
                        </div>
                        <Button variant="danger" onClick={() => stopJob(j.jobId, j.companyName, j.kbKey)} disabled={busy === j.jobId}>
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
                            {c.companyName ? `Company: ${c.companyName}` : "Global"}
                            {c.kbKey ? ` · KB: ${c.kbKey}` : ""} · <span className="font-mono">{c.schedule}</span> · runs: <span className="tabular-nums">{c.runCount ?? 0}</span>
                          </p>
                          {c.lastRun && <p className="text-[11px] text-slate-500">last run {formatDate(c.lastRun)}</p>}
                        </div>
                        <Button variant="danger" onClick={() => stopCron(c.jobId, c.companyName, c.kbKey)} disabled={busy === c.jobId}>
                          {busy === c.jobId ? <Spinner className="h-3.5 w-3.5" /> : "Stop"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        </TabPanel>

        {/* ─── Tab 2: Ingestion ─── */}
        <TabPanel id="ingestion" active={activeTab}>
          <div className="space-y-6">
            <Card title="Active Ingestion" subtitle={ingestRunning ? "Currently running" : "No active ingestion"}>
              {ingestRunning ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-100">Ingestion in progress…</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Started {parseUtcDate(ingestingStatus?.startedAt || Date.now())?.toLocaleString()} ·
                      {ingestingStatus?.documentCount || 0} documents processed
                    </p>
                  </div>
                  <Button variant="danger" onClick={stopIngestionJob} disabled={ingestBusy === "ingest"}>
                    {ingestBusy === "ingest" ? <Spinner className="h-3.5 w-3.5" /> : "Cancel"}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No active ingestion. Start one to begin processing content.</p>
              )}
            </Card>

            <Card title="Recent Jobs" subtitle="Last completed or failed ingestion runs">
              {ingestionJobs.length === 0 ? (
                <Empty message="No ingestion jobs found." />
              ) : (
                <div className="space-y-3">
                  {ingestionJobs.slice(-5).reverse().map((job) => (
                    <div key={job.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-100">
                          {INGEST_JOB_LABELS[job.jobId] || job.jobId} · {job.companyName || "Global"}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {job.status} · {parseUtcDate(job.startedAt)?.toLocaleString()}
                        </p>
                      </div>
                      <Badge
                        tone={job.status === "completed" ? "green" : job.status === "failed" ? "red" : "amber"}
                      >
                        {job.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </TabPanel>
      </Tabs>

      {/* ─── Cron Modal ─── */}
      <Modal
        open={cronOpen}
        title="Schedule Cron Job"
        onClose={() => setCronOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCronOpen(false)}>
              Cancel
            </Button>
            <Button onClick={startCron} disabled={!cronForm.jobId || !cronForm.schedule || (cronForm.jobId === "ingest" && cronForm.kbKey && !cronForm.companyName)}>
              Schedule
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Job"
            value={cronForm.jobId}
            onChange={(e) => setCronForm({ ...cronForm, jobId: e.target.value, kbKey: "" })}
            options={JOB_IDS.map((id) => ({ value: id, label: JOB_LABELS[id] || id }))}
          />
          {cronForm.jobId === "ingest" && (
            <div>
              <Select
                label="Knowledge base"
                value={cronForm.kbKey}
                onChange={(e) => setCronForm({ ...cronForm, kbKey: e.target.value })}
                options={[
                  { value: "", label: "Legacy company-wide ingest (no KB)" },
                  ...cronKbs,
                ]}
              />
              <p className="mt-1 text-xs text-slate-500">
                {cronForm.companyName
                  ? cronKbs.length
                    ? "Each tick runs the KB-driven ingest with the KB's saved source config."
                    : "This company has no knowledge bases yet — create one on the Ingestion page."
                  : "Pick a company to list its knowledge bases."}
              </p>
            </div>
          )}
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

      {/* ─── Preset Modal ─── */}
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

      {/* ─── Ingestion Modal ─── */}
      <Modal
        open={showIngestModal}
        title="Start Ingestion"
        onClose={() => setShowIngestModal(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowIngestModal(false)}>
              Cancel
            </Button>
            <Button onClick={startIngestionJob} disabled={isIngestStartDisabled()}>
              {ingestBusy === "ingest" ? <Spinner className="h-3.5 w-3.5" /> : "Start Ingestion"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">Knowledge Base (optional)</label>
            <Input
              placeholder="kb-key for KB-specific ingestion"
              className="font-mono"
              value={kbKey}
              onChange={(e) => setKbKey(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-3">Ingestion scope</label>
            <div className="grid grid-cols-3 gap-2">
              {SCOPE_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setScopeMode(mode.id)}
                  className={`rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                    scopeMode === mode.id
                      ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                      : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                  }`}
                >
                  <span className="block font-medium text-sm">{mode.label}</span>
                  <span className="mt-0.5 block leading-tight opacity-70">{mode.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {scopeMode === "all" && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
              All available pages and posts will be fetched from the WordPress API and processed.
            </div>
          )}

          {scopeMode === "limit" && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-2">Maximum API pages</label>
              <Input
                type="number"
                min="1"
                max="10000"
                placeholder="e.g., 10"
                className="font-mono"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-500">
                One API page returns up to 100 documents. Limit 10 = up to 1,000 documents.
              </p>
            </div>
          )}

          {scopeMode === "selected" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">Content type</label>
                <div className="flex gap-2">
                  {["pages", "posts"].map((ct) => (
                    <button
                      key={ct}
                      type="button"
                      onClick={() => setSelectedType(ct)}
                      className={`rounded-lg border px-4 py-2 text-xs font-medium transition-colors ${
                        selectedType === ct
                          ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                          : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600"
                      }`}
                    >
                      {ct.charAt(0).toUpperCase() + ct.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">WordPress IDs (comma-separated)</label>
                <Input
                  placeholder="e.g., 123, 456, 789"
                  className="font-mono"
                  value={selectedIds}
                  onChange={(e) => setSelectedIds(e.target.value)}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Enter WordPress post/page IDs. Find them in the WP admin URL: ?post=ID.
                </p>
              </div>
            </div>
          )}

          <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-4">
            <p className="text-xs text-slate-400 mb-2">What this does:</p>
            <ul className="text-xs text-slate-300 space-y-1">
              <li>• Fetches content from WordPress or source systems</li>
              <li>• Processes HTML to markdown</li>
              <li>• Splits into chunks according to KB settings</li>
              <li>• Stores raw chunks in configured object storage (R2 / S3)</li>
              <li>• Generates embeddings using the KB's embedding model</li>
              <li>• Upserts vectors into the configured vector store</li>
              <li>• Skips unchanged content (incremental by default)</li>
            </ul>
          </div>
        </div>
      </Modal>

      {/* toast rendering: global <ToastViewport /> in App.jsx */}
    </div>
  );
}
