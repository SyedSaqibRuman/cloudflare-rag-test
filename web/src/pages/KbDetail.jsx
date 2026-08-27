// --------------------------
// KB DETAIL — dedicated page for a single knowledge base.
// Tabs: Overview / Documents / Ingestion / Configuration.
// Reached via #ingestion/kbs/:key — routed by Ingestion.jsx.
// --------------------------

import { useState, useRef, useEffect } from "react";
import { getKb, kbStatus, ingestKb, deleteKb, uploadKbDocuments, clearKbDocuments } from "../api";
import { Card, Button, Badge, Empty, Spinner, StatCard, SkeletonCard, Toast } from "../components/ui";
import ScrollToTop from "../components/ui/ScrollToTop.jsx";
import { usePoll, useToast } from "../hooks";
import { useCompanies } from "../context";
import KbModal from "../components/kb-modal";
import { timeAgo } from "../util";
import { statusTone, kbLifecycle } from "#shared/status.js";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------
const TABS = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "documents", label: "Documents", icon: "📄" },
  { id: "ingestion", label: "Ingestion", icon: "📥" },
  { id: "configuration", label: "Configuration", icon: "⚙️" },
];

// ---------------------------------------------------------------------------
// Inline file preview (for file-type KBs)
// ---------------------------------------------------------------------------
function FilePreview({ path }) {
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const match = path.match(/content\/(_uploads\/.+)$/);
    if (!match) { setError("Preview not available."); setLoading(false); return; }
    const ext = (path.split(".").pop() || "").toLowerCase();
    if (["pdf", "docx"].includes(ext)) {
      setContent(`[${ext.toUpperCase()} file — upload complete, ready for ingestion]`);
      setLoading(false);
      return;
    }
    fetch(`/content/${match[1]}`)
      .then((r) => { if (!r.ok) throw new Error("Not accessible"); return r.text(); })
      .then((text) => { setContent(text.length > 500 ? text.slice(0, 500) + "…" : text); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [path]);

  return (
    <div className="mt-2 rounded-md border border-slate-700/50 bg-slate-900/50 p-2.5">
      {loading && <p className="text-[11px] text-slate-500">Loading preview…</p>}
      {error && <p className="text-[11px] text-slate-500">{error}</p>}
      {content && <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-400">{content}</pre>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function KbDetail({ navigate, path }) {
  const kbKey = (path || "").split("/")[1];
  const { company } = useCompanies();
  const [kb, setKb] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const { toast, notify } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // Ingestion state (scoped to Ingestion tab)
  const [ingesting, setIngesting] = useState(false);
  const [scope, setScope] = useState("all");
  const [docLimit, setDocLimit] = useState("100");
  const [scopeOpen, setScopeOpen] = useState(false);

  // File upload state (scoped to Documents tab)
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const fileInputRef = useRef(null);

  const loadKb = async () => {
    if (!company || !kbKey) return;
    setError(null);
    try { setKb(await getKb(kbKey, company)); } catch (e) { setError(e.message); }
  };

  const loadStatus = async () => {
    if (!company || !kbKey) return;
    try { setStatus(await kbStatus(kbKey, company)); } catch (e) { setError(e.message); }
  };

  usePoll(loadKb, 30000, [kbKey, company]);
  const inProgress = status?.inProgress || status?.status === "indexing";
  usePoll(loadStatus, inProgress ? 10000 : 30000, [kbKey, company, inProgress]);

  const runIngest = async () => {
    setIngesting(true);
    setError(null);
    try {
      const ingestScope = scope === "limit" ? { scope: "limit", limit: Number(docLimit) } : { scope: "all" };
      const res = await ingestKb(kbKey, company, ingestScope);
      notify(res.message || "Ingest started.");
      await loadStatus();
    } catch (e) { setError(e.message); } finally { setIngesting(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete knowledge base '${kbKey}'? This cannot be undone.`)) return;
    try { await deleteKb(kbKey, company); notify(`Deleted '${kbKey}'.`); navigate("ingestion"); } catch (e) { setError(e.message); }
  };

  const handleUpload = async (files) => {
    setUploading(true);
    setUploadProgress({ loaded: 0, total: 0, percent: 0 });
    try {
      const res = await uploadKbDocuments(kbKey, files, company, { onProgress: (p) => setUploadProgress(p) });
      notify(res.message || `${files.length} file(s) uploaded.`);
      await loadKb();
    } catch (e) { setError(e.message); } finally { setUploading(false); setUploadProgress(null); }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return "0 B";
    const k = 1024; const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const fileIcon = (name) => {
    const ext = (name.split(".").pop() || "").toLowerCase();
    const map = { txt: "text-slate-400", md: "text-indigo-400", html: "text-amber-400", pdf: "text-rose-400", docx: "text-blue-400" };
    return map[ext] || "text-slate-400";
  };

  const lifecycle = kbLifecycle(kb, status);

  if (!company) return <Empty message="Select a company to manage its knowledge bases." />;

  if (!kb && !error) {
    return (
      <div className="space-y-6">
        <Card><SkeletonCard rows={3} /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={() => navigate("ingestion")}>
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </Button>
        <h2 className="text-lg font-bold text-slate-50">{kb?.kb_name || kbKey}</h2>
        <Badge tone={lifecycle.tone}>{lifecycle.label}</Badge>
        {inProgress && <Badge tone="amber">ingesting…</Badge>}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(true)} disabled={!kb} className="whitespace-nowrap">Edit</Button>
          <button
            type="button"
            onClick={remove}
            disabled={!kb}
            title={`Delete ${kbKey}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 text-sm font-medium text-slate-300 transition-colors hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            Delete
          </button>
        </div>
      </div>

      {status?.lastError && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Last ingest failed: {status.lastError}
        </div>
      )}

      {/* ── Tab bar ─────────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "border-indigo-500 text-indigo-300"
                : "border-transparent text-slate-500 hover:text-slate-300"
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: Overview                                                    */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Documents"
              value={status?.documentCount != null ? status.documentCount.toLocaleString() : "—"}
              tone="green"
            />
            <StatCard
              label="Vectors"
              value={status?.vectorCount != null ? status.vectorCount.toLocaleString() : "—"}
              tone="cyan"
              meta={status?.vectorCount == null ? "best-effort (API)" : undefined}
            />
            <StatCard
              label="Chunks"
              value={status?.lastIngestion?.chunksCreated?.toLocaleString() || "—"}
              tone="amber"
            />
            <StatCard
              label="Last Run"
              value={status?.lastIngestion?.at ? timeAgo(status.lastIngestion.at) : "never"}
              tone="slate"
            />
          </div>

          <Card title="Infrastructure">
            <dl className="space-y-3 text-sm">
              <InfoRow label="Embedding" value={kb?.embedding_model_name || "Company default"} />
              <InfoRow label="Vector Store" value={kb?.vector_external_id || kb?.vector_resource_name || "Company default"} />
              <InfoRow label="Object Storage" value={kb?.storage_external_id || kb?.storage_resource_name || "Company default"} />
              <InfoRow label="Graph" value={kb?.enable_graph_rag ? "Enabled" : "Disabled"} />
              <InfoRow label="Source" value={kb?.source_type || "wordpress"} />
              {kb?.description && <InfoRow label="Description" value={kb.description} />}
            </dl>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: Documents                                                   */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "documents" && (
        <div className="space-y-4">
          {kb?.source_type === "file" ? (
            <Card title="Uploaded Files" subtitle="Files staged for ingestion">
              {(() => {
                const cfg = typeof kb.source_config === "string" ? JSON.parse(kb.source_config) : kb.source_config;
                const files = cfg?.files || [];
                return (
                  <>
                    {/* Drop zone */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={async (e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) await handleUpload(Array.from(e.dataTransfer.files)); }}
                      onClick={() => !uploading && fileInputRef.current?.click()}
                      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors ${
                        dragOver ? "border-indigo-400 bg-indigo-500/10" : "border-slate-700 hover:border-slate-500"
                      } ${uploading ? "pointer-events-none opacity-60" : ""}`}
                    >
                      <svg aria-hidden="true" className="mb-2 h-8 w-8 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      <p className="text-sm text-slate-400">Drop files here or click to browse</p>
                      <p className="mt-1 text-xs text-slate-600">.txt, .md, .html, .pdf, .docx — max 50 MB each</p>
                    </div>
                    <input
                      ref={fileInputRef} type="file" multiple accept=".txt,.md,.html,.htm,.pdf,.docx" className="hidden"
                      onChange={async (e) => { if (e.target.files.length) await handleUpload(Array.from(e.target.files)); e.target.value = ""; }}
                    />

                    {uploading && uploadProgress && (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>Uploading…</span><span>{uploadProgress.percent}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${uploadProgress.percent}%` }} />
                        </div>
                        <p className="mt-1 text-[11px] text-slate-600">{formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)}</p>
                      </div>
                    )}

                    {files.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-400">{files.length} file(s)</span>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!window.confirm("Remove all uploaded files?")) return;
                              try { await clearKbDocuments(kbKey, company); notify("Files removed."); await loadKb(); } catch (e) { setError(e.message); }
                            }}
                            className="text-xs text-rose-400 hover:text-rose-300"
                          >Clear all</button>
                        </div>
                        <div className="max-h-60 space-y-1 overflow-y-auto">
                          {files.map((f, i) => {
                            const name = f.split(/[\\/]/).pop();
                            const ext = (name.split(".").pop() || "").toLowerCase();
                            const isPreviewable = ["txt", "md", "pdf", "docx"].includes(ext);
                            return (
                              <div key={i} className="group rounded-md bg-slate-800/50 px-2.5 py-2">
                                <div className="flex items-center gap-2">
                                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded bg-slate-700/50 text-[10px] font-bold uppercase ${fileIcon(name)}`}>{ext || "?"}</span>
                                  <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{name}</span>
                                  {isPreviewable && (
                                    <button type="button" onClick={() => setPreviewFile(previewFile === i ? null : i)}
                                      className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
                                      title={previewFile === i ? "Hide preview" : "Show preview"}>
                                      <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        {previewFile === i
                                          ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>
                                          : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></>
                                        }
                                      </svg>
                                    </button>
                                  )}
                                </div>
                                {previewFile === i && isPreviewable && <FilePreview path={f} name={name} />}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </Card>
          ) : (
            <Card title="Documents">
              <p className="text-sm text-slate-500">
                {kb?.source_type === "wordpress" && "Content is fetched from the WordPress REST API during ingestion."}
                {kb?.source_type === "url" && "Content is fetched from configured URLs during ingestion."}
                {kb?.source_type === "custom" && "Content is provided via the API or a custom pipeline."}
                {!kb?.source_type && "Content source not configured."}
              </p>
              <dl className="mt-3 space-y-2 text-sm">
                <InfoRow label="Source type" value={kb?.source_type || "N/A"} />
                {kb?.source_type === "url" && (() => {
                  const cfg = typeof kb.source_config === "string" ? JSON.parse(kb.source_config) : kb.source_config;
                  const urls = cfg?.urls || [];
                  return urls.length > 0 ? <InfoRow label="URLs" value={`${urls.length} configured`} /> : null;
                })()}
                <InfoRow label="Registry count" value={status?.documentCount?.toLocaleString() || "0"} />
              </dl>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: Ingestion                                                   */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "ingestion" && (
        <div className="space-y-4">
          {/* Ingest controls */}
          <Card title="Run Ingestion" subtitle="Fetch content from the source and index it">
            <div className="flex flex-wrap items-center gap-3">
              {/* Scope selector */}
              <div className="relative shrink-0">
                <Button
                  variant="ghost"
                  onClick={() => setScopeOpen(!scopeOpen)}
                  disabled={!kb || ingesting || inProgress}
                  className="gap-1.5 whitespace-nowrap"
                >
                  <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                  </svg>
                  Scope: {scope === "all" ? "All" : `Limit ${docLimit}`}
                </Button>
                {scopeOpen && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
                    <div className="p-2">
                      <p className="mb-2 px-2 text-[11px] font-medium text-slate-500">Ingestion scope</p>
                      <button type="button" onClick={() => { setScope("all"); setScopeOpen(false); }}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${scope === "all" ? "bg-indigo-500/15 text-indigo-300" : "text-slate-300 hover:bg-slate-700"}`}>
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${scope === "all" ? "border-indigo-400 bg-indigo-400" : "border-slate-600"}`}>
                          {scope === "all" && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </span>
                        All documents
                      </button>
                      <button type="button" onClick={() => { setScope("limit"); setScopeOpen(false); }}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${scope === "limit" ? "bg-indigo-500/15 text-indigo-300" : "text-slate-300 hover:bg-slate-700"}`}>
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${scope === "limit" ? "border-indigo-400 bg-indigo-400" : "border-slate-600"}`}>
                          {scope === "limit" && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </span>
                        Limit documents
                      </button>
                      {scope === "limit" && (
                        <div className="mt-2 px-2">
                          <label className="mb-1 block text-[11px] text-slate-500">Max documents</label>
                          <input type="number" min={1} max={10000} value={docLimit}
                            onChange={(e) => setDocLimit(e.target.value)}
                            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <Button onClick={runIngest} disabled={!kb || ingesting || inProgress} className="whitespace-nowrap">
                {ingesting ? <Spinner className="h-3.5 w-3.5" /> : "Run Ingest"}
              </Button>
            </div>
          </Card>

          {/* Last ingest details */}
          <Card title="Last Ingestion" subtitle="From the KB status endpoint (live job state + registry)">
            {status ? (
              <dl className="space-y-3 text-sm">
                <InfoRow label="Status">
                  <Badge tone={statusTone(status.status)}>{status.status}</Badge>
                </InfoRow>
                <InfoRow label="Last sync" value={status.lastSyncAt ? timeAgo(status.lastSyncAt) : "never"} />
                <InfoRow label="Documents processed" value={status.documentCount?.toLocaleString() || "—"} />
                <InfoRow label="Vectors in index" value={status.vectorCount != null ? status.vectorCount.toLocaleString() : "—"} />
                {status.lastIngestion?.chunksCreated != null && (
                  <InfoRow label="Chunks created" value={status.lastIngestion.chunksCreated.toLocaleString()} />
                )}
                {status.lastIngestion?.durationMs != null && (
                  <InfoRow label="Duration" value={`${(status.lastIngestion.durationMs / 1000).toFixed(1)}s`} />
                )}
              </dl>
            ) : (
              <p className="text-sm text-slate-500">No ingestion data yet — run an ingest to populate this KB.</p>
            )}
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: Configuration                                               */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "configuration" && (
        <div className="space-y-4">
          <Card title="Ingestion Settings" subtitle="Chunking + retrieval tuning applied on ingest">
            <dl className="space-y-3 text-sm">
              <InfoRow label="Source type" value={kb?.source_type || "wordpress"} />
              <InfoRow label="Embedding model" value={kb?.embedding_model_name || "Company default"} />
              <InfoRow label="Chunk size / overlap" value={`${kb?.chunk_size} / ${kb?.chunk_overlap} chars`} />
              <InfoRow label="Retrieval" value={`Top-${kb?.retrieval_top_k} · ≥ ${Number(kb?.retrieval_score_threshold).toFixed(2)}`} />
              <InfoRow label="Hybrid search" value={kb?.enable_hybrid_search ? "Enabled" : "Disabled"} />
              <InfoRow label="Graph RAG" value={kb?.enable_graph_rag ? "Enabled" : "Disabled"} />
            </dl>
          </Card>

          {kb?.webhook_url && (
            <Card title="Webhook" subtitle="Notification endpoint for ingestion events">
              <dl className="space-y-2 text-sm">
                <InfoRow label="URL" value={kb.webhook_url} />
                <InfoRow label="HMAC secret" value={kb.has_webhook_secret ? "Configured" : "Not set"} />
              </dl>
            </Card>
          )}
        </div>
      )}

      {/* ── Edit modal ──────────────────────────────────────────────── */}
      <KbModal
        open={editOpen}
        row={kb}
        company={company}
        onClose={() => setEditOpen(false)}
        onSaved={async () => { setEditOpen(false); notify("Knowledge base updated."); await loadKb(); }}
      />

      <ScrollToTop className="fixed bottom-20 right-6 z-50" size="md" threshold={300} />
      <Toast message={toast?.msg} tone={toast?.tone} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

/** Information row: label on left, value on right — used in Overview + Config tabs. */
function InfoRow({ label, value, children }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-medium text-slate-100">{children || value || "—"}</dd>
    </div>
  );
}
