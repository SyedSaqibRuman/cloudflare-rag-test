import { useState } from "react";
import { getKb, kbStatus, ingestKb, deleteKb } from "../api";
import { Card, Button, Badge, Empty, Spinner, StatCard } from "../components/ui";
import { usePoll } from "../hooks";
import { useHeaderActions } from "../components/Layout";
import { useCompanies } from "../context";
import KbModal from "../components/kb-modal";
import { timeAgo } from "../util";

const statusTone = (s) =>
  ({ active: "green", indexing: "amber", error: "red", archived: "slate" })[s] || "slate";

export default function KbDetail({ navigate, path }) {
  const kbKey = (path || "").split("/")[1];
  const { company } = useCompanies();
  const [kb, setKb] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadKb = async () => {
    if (!company || !kbKey) return;
    setError(null);
    try {
      setKb(await getKb(kbKey, company));
    } catch (e) {
      setError(e.message);
    }
  };

  const loadStatus = async () => {
    if (!company || !kbKey) return;
    try {
      setStatus(await kbStatus(kbKey, company));
    } catch (e) {
      // status is best-effort — surface without breaking the page
      setError(e.message);
    }
  };

  usePoll(loadKb, 30000, [kbKey, company]);
  const inProgress = status?.inProgress || status?.status === "indexing";
  usePoll(loadStatus, inProgress ? 10000 : 30000, [kbKey, company, inProgress]);

  const runIngest = async () => {
    if (!window.confirm(`Run ingest for '${kb?.kb_name || kbKey}'? This fetches the company's content into this KB.`)) return;
    setIngesting(true);
    setError(null);
    try {
      const res = await ingestKb(kbKey, company);
      notify(res.message || "Ingest started.");
      await loadStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setIngesting(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete knowledge base '${kbKey}'? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteKb(kbKey, company);
      notify(`Deleted '${kbKey}'.`);
      navigate("kbs");
    } catch (e) {
      setError(e.message);
    }
  };

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button onClick={runIngest} disabled={!kb || ingesting || inProgress} title={inProgress ? "An ingest is already running" : undefined}>
        {ingesting ? <Spinner className="h-3.5 w-3.5" /> : "Run Ingest"}
      </Button>
      <Button variant="secondary" onClick={() => setEditOpen(true)} disabled={!kb}>
        Edit
      </Button>
      <Button variant="danger" onClick={remove} disabled={!kb}>
        Delete
      </Button>
    </div>
  );

  if (!company) {
    return <Empty message="Select a company to manage its knowledge bases." />;
  }

  if (!kb && !error) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={() => navigate("kbs")}>
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </Button>
        <h2 className="text-lg font-bold text-slate-50">{kb?.kb_name || kbKey}</h2>
        <Badge tone={statusTone(kb?.status)}>{kb?.status || "unknown"}</Badge>
        {status?.inProgress && <Badge tone="amber">ingesting…</Badge>}
      </div>

      {status?.lastError && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Last ingest failed: {status.lastError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Vector index"
          value={kb?.vector_external_id ? kb.vector_external_id : "Company default"}
          tone={kb?.vector_external_id ? "indigo" : "slate"}
        />
        <StatCard
          label="Storage (R2)"
          value={kb?.storage_external_id ? kb.storage_external_id : "Company default"}
          tone={kb?.storage_external_id ? "cyan" : "slate"}
        />
        <StatCard
          label="Documents"
          value={status ? status.documentCount?.toLocaleString() : "—"}
          tone="green"
          meta={status ? `${status.documentCount} registry entries` : undefined}
        />
        <StatCard
          label="Vectors"
          value={status?.vectorCount != null ? status.vectorCount.toLocaleString() : "—"}
          tone="amber"
          meta={status?.vectorCount == null ? "best-effort (API)" : "in index"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Ingestion Settings" subtitle="Chunking + retrieval tuning applied on ingest">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-400">Embedding model</dt>
              <dd className="font-medium text-slate-100">
                {kb?.embedding_model_name || <span className="text-slate-500">Company default (config)</span>}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-400">Chunk size / overlap</dt>
              <dd className="font-medium text-slate-100 tabular-nums">
                {kb?.chunk_size} / {kb?.chunk_overlap} chars
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-400">Retrieval</dt>
              <dd className="font-medium text-slate-100 tabular-nums">
                Top-{kb?.retrieval_top_k} · ≥ {Number(kb?.retrieval_score_threshold).toFixed(2)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-400">Hybrid search</dt>
              <dd>
                {kb?.enable_hybrid_search ? <Badge tone="green">enabled</Badge> : <Badge tone="slate">disabled</Badge>}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-400">Graph RAG</dt>
              <dd>
                {kb?.enable_graph_rag ? <Badge tone="green">enabled</Badge> : <Badge tone="slate">disabled</Badge>}
                <span className="ml-2 text-xs text-slate-500">(deferred)</span>
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Last Ingest" subtitle="From the KB status endpoint (live job state + registry)">
          {status ? (
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-400">Status</dt>
                <dd><Badge tone={statusTone(status.status)}>{status.status}</Badge></dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-400">Last sync</dt>
                <dd className="font-medium text-slate-100">
                  {status.lastSyncAt ? timeAgo(status.lastSyncAt) : "never"}
                  <span className="ml-2 text-xs text-slate-500">(last status flip)</span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-400">Documents</dt>
                <dd className="font-medium text-slate-100 tabular-nums">{status.documentCount?.toLocaleString()}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-400">Vectors</dt>
                <dd className="font-medium text-slate-100 tabular-nums">
                  {status.vectorCount != null ? status.vectorCount.toLocaleString() : "—"}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No status yet — run an ingest to populate this KB.</p>
          )}
        </Card>
      </div>

      {kb?.description && (
        <Card title="Description">
          <p className="whitespace-pre-wrap text-sm text-slate-300">{kb.description}</p>
        </Card>
      )}

      <KbModal
        open={editOpen}
        row={kb}
        company={company}
        onClose={() => setEditOpen(false)}
        onSaved={async () => {
          setEditOpen(false);
          notify("Knowledge base updated.");
          await loadKb();
        }}
      />

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50">
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-200 shadow-xl">{toast}</div>
        </div>
      )}
    </div>
  );
}
