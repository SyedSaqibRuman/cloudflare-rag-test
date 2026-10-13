// --------------------------
// KB DETAIL — dedicated page for a single knowledge base.
// Tabs: Overview / Documents / Ingestion / Configuration.
// Reached via #ingestion/kbs/:key — routed by Ingestion.jsx.
// --------------------------

import { useState, useRef, useEffect } from "react";
import { getKb, kbStatus, ingestKb, deleteKb, uploadKbDocuments, clearKbDocuments, listKbDocuments, previewKbDocument, previewIngestedDocument, deleteKbDocument, api, listKbQa, addKbQa, updateKbQa, deleteKbQa, matchKbQa, getKbProgress, stopIngestJob, pauseIngestJob, resumeIngestJob } from "../api";
import { Card, Button, Badge, Empty, Spinner, StatCard, SkeletonCard, Popover, PopoverTrigger, PopoverContent, PopoverItem, PopoverSeparator, InfoTip, Modal } from "../components/ui";
import { getTermTooltip } from "../components/glossary";
import ScrollToTop from "../components/ui/ScrollToTop.jsx";
import { usePoll, useToast } from "../hooks";
import { useCompanies } from "../context";
import KbModal from "../components/kb-modal";
import KnowledgeGraphTab from "./kb-knowledge/KnowledgeGraphTab";
import { timeAgo } from "../util";
import { safeLinkUrl } from "../markdown-sanitize.js";
import { statusTone, kbLifecycle } from "#shared/status.js";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------
const TABS = [
  { id: "overview", label: "Overview", icon: "📊" },
  { id: "documents", label: "Documents", icon: "📄" },
  { id: "ingestion", label: "Ingestion", icon: "📥" },
  { id: "qa", label: "Custom Q&A", icon: "💬" },
  { id: "knowledge", label: "Knowledge Graph", icon: "🕸️" },
  { id: "configuration", label: "Configuration", icon: "⚙️" },
];

// ---------------------------------------------------------------------------
// Inline file preview (for file-type KBs)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// FilePreviewModal — preview an uploaded file inline.
//   MD    → rendered as sanitized HTML
//   TXT   → shown in a <pre>
//   PDF   → embedded in an <iframe>
//   DOCX  → shown as extracted text (server does the conversion)
//   other → raw blob with the correct MIME type
// ---------------------------------------------------------------------------
const PREVIEWABLE = ["txt", "md", "pdf", "docx", "html", "htm"];
const TYPE_BADGE = { txt: "TXT", md: "MD", pdf: "PDF", docx: "DOCX", html: "HTML", htm: "HTML" };

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Very small MD renderer: handles #/##/###, **bold**, *italic*, [text](url), `code`, ```fence```, - list.
// Anything fancier should use a real library — this is intentionally minimal.
function renderMarkdown(md) {
  const escape = escapeHtml;
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let out = "";
  let inFence = false;
  let inList = false;
  const flushList = () => { if (inList) { out += "</ul>"; inList = false; } };

  for (let raw of lines) {
    const line = escape(raw);
    if (line.startsWith("```")) {
      // The fence's language tag (line.slice(3)) is intentionally not rendered —
      // this preview treats all fences the same. (The old `fenceLang = …`
      // assignment created an implicit global: assigned, never read.)
      if (!inFence) { flushList(); inFence = true; out += `<pre class="rounded-md bg-slate-950 p-3 text-xs overflow-x-auto"><code class="text-slate-300">`; }
      else { inFence = false; out += "</code></pre>"; }
      continue;
    }
    if (inFence) { out += line + "\n"; continue; }

    if (/^#{1,6}\s/.test(line)) {
      flushList();
      const level = line.match(/^#+/)[0].length;
      out += `<h${level} class="mt-3 mb-1 font-semibold text-slate-100">${line.replace(/^#+\s+/, "")}</h${level}>`;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out += '<ul class="ml-5 list-disc space-y-0.5">'; inList = true; }
      out += `<li>${line.replace(/^[-*]\s+/, "")}</li>`;
      continue;
    }
    flushList();

    if (line.trim() === "") { out += ""; continue; }

    // inline: links, bold, italic, code. Link targets pass the shared scheme
    // sanitizer — KB content is untrusted, so javascript:/data:/etc. degrade
    // to inert text instead of anchors (React 18 does not strip them).
    let formatted = line
      .replace(/`([^`]+)`/g, '<code class="rounded bg-slate-800 px-1 text-[12px] text-amber-300">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, linkText, url) => {
        const href = safeLinkUrl(url);
        if (!href) {
          return `<span class="text-indigo-300/70 underline decoration-dotted" title="Link removed (unsafe URL)">${linkText}</span>`;
        }
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-indigo-300 underline">${linkText}</a>`;
      });
    out += `<p class="my-1.5 leading-relaxed">${formatted}</p>`;
  }
  flushList();
  if (inFence) out += "</code></pre>";
  return out || "<p class='text-slate-500'>Empty file.</p>";
}

function FilePreviewModal({ open, name, kbKey, company, onClose }) {
  const [state, setState] = useState({ loading: true, kind: null, payload: null, error: null });

  useEffect(() => {
    if (!open || !name) return;
    let blobUrl = null;
    setState({ loading: true, kind: null, payload: null, error: null });

    previewKbDocument(kbKey, name, company)
      .then((res) => {
        if (res.kind === "docx-text") {
          if (res.blob) blobUrl = URL.createObjectURL(res.blob);
          setState({
            loading: false,
            kind: "docx-text",
            payload: { text: res.text, name: res.name, downloadUrl: blobUrl },
            error: null,
          });
        } else {
          blobUrl = URL.createObjectURL(res.blob);
          setState({ loading: false, kind: "blob", payload: { url: blobUrl, mime: res.mime, name: res.name }, error: null });
        }
      })
      .catch((e) => setState({ loading: false, kind: null, payload: null, error: e.message }));

    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [open, name, kbKey, company]);

  const ext = (name.split(".").pop() || "").toLowerCase();
  const downloadUrl = state.kind === "blob" ? state.payload?.url : state.payload?.downloadUrl;

  return (
    <Modal
      open={open}
      title={`Preview — ${name}`}
      onClose={onClose}
      maxScreen
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >Close</button>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={name}
              className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
            >Download</a>
          )}
        </>
      }
    >
      <div className="flex h-full min-h-[60vh] flex-col">
        {state.loading && (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            Loading preview…
          </div>
        )}
        {state.error && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
            {state.error}
          </div>
        )}

        {/* MD / HTML — rendered */}
        {!state.loading && !state.error && state.kind === "blob" && (ext === "md" || ext === "html" || ext === "htm") && state.payload?.url && (
          ext === "md"
            ? <MarkdownPreview url={state.payload.url} />
            : (
              /* Sandboxed: allow-same-origin is required for the browser to
                 fetch the blob: URL, and NO allow-scripts means uploaded HTML
                 cannot execute in our origin (no XSS via inline handlers or
                 injected script tags). PDFs keep their own unsandboxed iframe
                 below — the built-in viewer needs scripts. */
              <iframe
                title={name}
                src={state.payload.url}
                sandbox="allow-same-origin"
                className="h-full min-h-[60vh] w-full flex-1 rounded-md border border-slate-800 bg-slate-950"
              />
            )
        )}

        {/* TXT — <pre> */}
        {!state.loading && !state.error && state.kind === "blob" && ext === "txt" && state.payload?.url && (
          <TxtPreview url={state.payload.url} />
        )}

        {/* PDF — iframe */}
        {!state.loading && !state.error && state.kind === "blob" && ext === "pdf" && state.payload?.url && (
          <iframe title={name} src={state.payload.url} className="h-full min-h-[60vh] w-full flex-1 rounded-md border border-slate-800 bg-slate-950" />
        )}

        {/* DOCX — extracted text (server-side) */}
        {!state.loading && !state.error && state.kind === "docx-text" && (
          <div className="flex-1 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/40 p-4">
            <p className="mb-3 text-[11px] uppercase tracking-wide text-slate-500">Extracted text (DOCX → plain text)</p>
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{state.payload?.text || "(no extractable text)"}</pre>
          </div>
        )}

        {/* Other binary — placeholder */}
        {!state.loading && !state.error && state.kind === "blob" && !PREVIEWABLE.includes(ext) && (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            No inline preview for <code className="rounded bg-slate-800 px-1 text-xs">.{ext || "?"}</code>. Use Download.
          </div>
        )}
      </div>
    </Modal>
  );
}

function MarkdownPreview({ url }) {
  const [md, setMd] = useState("");
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error("Not accessible"); return r.text(); })
      .then(setMd)
      .catch((e) => setError(e.message));
  }, [url]);
  if (error) return <p className="text-sm text-rose-300">{error}</p>;
  return (
    <div
      className="prose prose-invert max-w-none flex-1 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/40 p-4 text-sm leading-relaxed text-slate-200"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(md || "") }}
    />
  );
}

function TxtPreview({ url }) {
  const [text, setText] = useState("");
  useEffect(() => {
    fetch(url).then((r) => r.text()).then(setText);
  }, [url]);
  return (
    <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950/40 p-4 text-sm leading-relaxed text-slate-200">
      {text || "Loading…"}
    </pre>
  );
}


// ---------------------------------------------------------------------------
// IngestProgressBox — live run / paused snapshot, shared with IngestionList's
// card rendering (same payload from GET /gateway/kbs/:key/ingest-progress).
//   live:   { running: true, progress: { processed, skipped, chunks, discovered, phase, sub? } }
//   paused: { running: false, paused: true, progress: <persisted snapshot>, pausedAt }
// ---------------------------------------------------------------------------
function IngestProgressBox({ prog, pausedAt, busy, onPause, onStop, onResume }) {
  const pr = prog?.progress;
  const total = (pr?.processed ?? 0) + (pr?.skipped ?? 0);
  const pct = (pr?.discovered ?? 0) > 0 ? Math.min(Math.round((total / pr.discovered) * 100), 100) : 0;
  const phaseLabel =
    pr?.phase === "fetching"
      ? "Fetching…"
      : pr?.sub
        ? `Processing · graph ${pr.sub.subPhase} — ${pr.sub.detail}`
        : "Processing…";

  return (
    <div className={`rounded-lg border p-2.5 ${prog?.running ? "border-indigo-500/30 bg-indigo-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
      <div className="flex items-center justify-between text-[10px] text-indigo-200/80">
        <span className={`flex items-center gap-1.5 font-medium ${prog?.running ? "text-indigo-200/80" : "text-amber-200/90"}`}>
          {prog?.running ? (
            <>
              <Spinner className="h-3 w-3" />
              {phaseLabel}
            </>
          ) : (
            <>
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="1.5" width="3" height="9" rx="0.8" /><rect x="7" y="1.5" width="3" height="9" rx="0.8" /></svg>
              Ingestion paused
            </>
          )}
        </span>
        <span className="tabular-nums">
          {total}/{pr?.discovered ?? 0}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-700">
        <div
          className={`h-full rounded-full transition-all duration-500 ${prog?.running ? "bg-indigo-500" : "bg-amber-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        {pr?.chunks ?? 0} chunks created so far
        {!prog?.running && pausedAt && ` · paused ${timeAgo(pausedAt)}`}
        {!prog?.running && pr && " · snapshot from the pause point"}
      </p>
      <div className="mt-2 flex items-center gap-2">
        {prog?.running ? (
          <>
            <button
              type="button"
              title="Pause at the next document boundary (resumable)"
              onClick={onPause}
              disabled={busy}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-600 bg-slate-800/60 px-2 text-[10px] font-medium text-slate-300 transition-colors hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-50"
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="1.5" width="3" height="9" rx="0.8" /><rect x="7" y="1.5" width="3" height="9" rx="0.8" /></svg>
              Pause
            </button>
            <button
              type="button"
              title="Stop the run (completed documents stay ingested)"
              onClick={onStop}
              disabled={busy}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-600 bg-slate-800/60 px-2 text-[10px] font-medium text-slate-300 transition-colors hover:border-rose-500/60 hover:text-rose-300 disabled:opacity-50"
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1" /></svg>
              Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            title="Resume ingestion (completed documents are skipped)"
            onClick={onResume}
            disabled={busy}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-amber-500/90 px-2.5 text-[10px] font-semibold text-slate-900 transition-colors hover:bg-amber-400 disabled:opacity-50"
          >
            <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M3 1.8v8.4a.8.8 0 0 0 1.22.68l6.4-4.2a.8.8 0 0 0 0-1.36l-6.4-4.2A.8.8 0 0 0 3 1.8z" /></svg>
            Resume
          </button>
        )}
      </div>
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
  const { notify } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // Ingestion state (scoped to Ingestion tab)
  const [ingesting, setIngesting] = useState(false);
  const [scope, setScope] = useState("all");
  const [docLimit, setDocLimit] = useState("100");
  const [selectedPages, _setSelectedPages] = useState([]); // selection read-only today (Ingestion tab)

  // Initialize scope from KB source_config when kb loads
  useEffect(() => {
    if (kb?.source_config) {
      try {
        const cfg = typeof kb.source_config === "string" ? JSON.parse(kb.source_config) : kb.source_config;
        if (cfg.scope) setScope(cfg.scope);
        if (cfg.docLimit) setDocLimit(String(cfg.docLimit));
      } catch { /* ignore parse errors */ }
    }
  }, [kb?.source_config]);


  // File upload state (scoped to Documents tab)
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState(null); // { name, path } | null
  const fileInputRef = useRef(null);

  // Processed documents list (for WordPress/URL KBs)
  const [processedDocs, setProcessedDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  // Ingested-document preview (Processed Documents table): { loading, error, data }
  const [docPreview, setDocPreview] = useState(null);

  const openDocPreview = async (docKey) => {
    setDocPreview({ loading: true, error: null, data: null });
    try {
      const data = await previewIngestedDocument(kbKey, docKey, company);
      setDocPreview({ loading: false, error: null, data });
    } catch (e) {
      setDocPreview({ loading: false, error: e.message, data: null });
    }
  };

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
  const paused = Boolean(status?.paused);
  usePoll(loadStatus, inProgress ? 10000 : 30000, [kbKey, company, inProgress]);

  // Live/paused ingestion progress (same source as the KB card list):
  // fast-poll (2s) only while a run is live or paused — paused keeps the
  // "Paused Xs ago" clock fresh and catches a resume from elsewhere. When
  // idle, back off to 30s: the tick's only idle-time job is noticing a run
  // started on another page, which the status poll (above) detects too.
  const [progress, setProgress] = useState(null); // ingest-progress payload
  const [actionBusy, setActionBusy] = useState(false);
  const loadProgress = async () => {
    if (!company || !kbKey) return;
    try {
      const p = await getKbProgress(kbKey, company);
      setProgress(p?.running || p?.paused ? p : null);
    } catch { /* progress is best-effort */ setProgress(null); }
  };
  const progressLive = inProgress || paused || Boolean(progress?.running || progress?.paused);
  usePoll(loadProgress, progressLive ? 2000 : 30000, [company, kbKey, inProgress, paused, progress?.running, progress?.paused]);

  // Load processed documents when Documents tab is active and KB is not file-based
  useEffect(() => {
    if (activeTab !== "documents" || !company || !kbKey) return;
    if (kb?.source_type === "file") return; // file KBs show uploaded files, not registry
    let cancelled = false;
    (async () => {
      setDocsLoading(true);
      try {
        const res = await listKbDocuments(kbKey, company);
        if (!cancelled) setProcessedDocs(res.documents || []);
      } catch {
        if (!cancelled) setProcessedDocs([]);
      } finally {
        if (!cancelled) setDocsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, kbKey, company, kb?.source_type]);

  const runIngest = async () => {
    setIngesting(true);
    setError(null);
    try {
      const ingestScope = scope === "limit"
        ? { scope: "limit", limit: Number(docLimit) || 100 }
        : scope === "selected" && selectedPages.length > 0
          ? { scope: "selected", items: selectedPages }
          : { scope: "all" };
      const res = await ingestKb(kbKey, company, ingestScope);
      notify(res.message || "Ingest started.");
      await loadStatus();
    } catch (e) { setError(e.message); } finally { setIngesting(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete knowledge base '${kbKey}'? This cannot be undone.`)) return;
    try { await deleteKb(kbKey, company); notify(`Deleted '${kbKey}'.`); navigate("ingestion"); } catch (e) { setError(e.message); }
  };

  // Ingestion controls — same contract as the KB cards on the Ingestion page.
  const pauseIngest = async () => {
    setActionBusy(true);
    try { notify((await pauseIngestJob(company, kbKey)).message || "Ingestion paused."); }
    catch (e) { setError(e.message); }
    finally { setActionBusy(false); }
  };
  const stopIngest = async () => {
    setActionBusy(true);
    try {
      notify((await stopIngestJob(company, kbKey)).message || "Ingestion stopped.");
      setProgress(null);
      await loadStatus();
    } catch (e) { setError(e.message); }
    finally { setActionBusy(false); }
  };
  const resumeIngest = async () => {
    setActionBusy(true);
    try { notify((await resumeIngestJob(company, kbKey)).message || "Ingestion resumed."); }
    catch (e) { setError(e.message); }
    finally { setActionBusy(false); }
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

      {/* KB-bound embedding model failed during the last ingest → vectors were
          written with the company's CF embeddings instead (silent vector-space
          substitution). Surfaced here so it never requires reading logs. */}
      {status?.lastIngestion?.embeddingFallbacks > 0 && (
        <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <p className="font-medium">⚠️ Embedding model failed during the last ingest — Cloudflare fallback used</p>
          <p className="mt-1 text-amber-200/80">
            {status.lastIngestion.embeddingFallbacks.toLocaleString()} batch(es) could not use the bound embedding model
            {status.lastIngestion.embeddingAdapterError ? ` (${status.lastIngestion.embeddingAdapterError})` : ""}. Vectors were written with the company's Cloudflare embeddings instead — answers still work, but consider fixing or unbinding the model for a consistent vector space.
          </p>
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
            <dl className="space-y-3 text-sm">                <InfoRow
                  label="Embedding"
                  value={
                    <span className="inline-flex items-center gap-2">
                      {kb?.embedding_model_name || "Company default"}
                      {status?.lastIngestion?.embeddingFallbacks > 0 && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                          CF fallback in last run
                        </span>
                      )}
                    </span>
                  }
                  tip={getTermTooltip("embedding-model")}
                />
              <InfoRow label="Vector Store" value={kb?.vector_external_id || kb?.vector_resource_name || "Company default"} tip={getTermTooltip("vector-store")} />
              <InfoRow label="Object Storage" value={kb?.storage_external_id || kb?.storage_resource_name || "Company default"} tip={getTermTooltip("object-storage")} />
              <InfoRow label="Graph" value={kb?.enable_graph_rag ? "Enabled" : "Disabled"} tip={getTermTooltip("graph-rag")} />
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
                      <p className="mt-1 text-xs text-slate-500">.txt, .md, .html, .pdf, .docx — max 50 MB each</p>
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
                        <p className="mt-1 text-[11px] text-slate-500">{formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)}</p>
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
                            const isPreviewable = PREVIEWABLE.includes(ext);
                            const isActive = previewFile && previewFile.name === name;
                            return (
                              <div key={i} className="group rounded-md bg-slate-800/50 px-2.5 py-2">
                                <div className="flex items-center gap-2">
                                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded bg-slate-700/50 text-[10px] font-bold uppercase ${fileIcon(name)}`}>{TYPE_BADGE[ext] || ext.toUpperCase() || "?"}</span>
                                  <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{name}</span>
                                  {isPreviewable && (
                                    <button type="button" onClick={() => setPreviewFile(isActive ? null : { name, path: f })}
                                      className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
                                      title="Preview">
                                      <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                      </svg>
                                    </button>
                                  )}
                                  <a
                                    href={`/gateway/kbs/${encodeURIComponent(kbKey)}/documents/${encodeURIComponent(name)}`}
                                    target="_blank"
                                    rel="noopener"
                                    download={name}
                                    className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
                                    title="Open in new tab / download"
                                  >
                                    <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                                    </svg>
                                  </a>
                                  <button
                                    type="button"
                                    title="Remove file"
                                    onClick={async () => {
                                      if (!window.confirm(`Remove '${name}' from this KB?`)) return;
                                      try { await deleteKbDocument(kbKey, name, company); notify(`File '${name}' removed.`); await loadKb(); } catch (e) { setError(e.message); }
                                    }}
                                    className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                                  >
                                    <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
              {previewFile && (
                <FilePreviewModal
                  open={!!previewFile}
                  name={previewFile.name}
                  kbKey={kbKey}
                  company={company}
                  onClose={() => setPreviewFile(null)}
                />
              )}
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Source info card */}
              <Card title="Source">
                <dl className="space-y-2 text-sm">
                  <InfoRow label="Source type">
                    <Badge tone={kb?.source_type === "wordpress" ? "cyan" : kb?.source_type === "url" ? "amber" : "slate"}>
                      {kb?.source_type === "wordpress" && "\ud83c\udf10 WordPress"}
                      {kb?.source_type === "url" && "\ud83d\udd17 URL"}
                      {kb?.source_type === "custom" && "\u2699\ufe0f Custom"}
                      {!kb?.source_type && "Not configured"}
                    </Badge>
                  </InfoRow>
                  {kb?.source_type === "url" && (() => {
                    const cfg = typeof kb.source_config === "string" ? JSON.parse(kb.source_config) : kb.source_config;
                    const urls = cfg?.urls || [];
                    return urls.length > 0 ? (
                      <InfoRow label="URLs">
                        <div className="space-y-1">
                          {urls.map((u, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-600" />
                              <span className="truncate text-xs text-slate-400" title={u}>{u}</span>
                            </div>
                          ))}
                        </div>
                      </InfoRow>
                    ) : null;
                  })()}
                  {kb?.source_type === "wordpress" && (() => {
                    const cfg = typeof kb.source_config === "string" ? JSON.parse(kb.source_config) : kb.source_config;
                    const scope = cfg?.scope || "all";
                    return (
                      <InfoRow label="Scope">
                        <span className="text-xs text-slate-300">
                          {scope === "all" ? "Entire website" : scope === "limit" ? `Limit: ${cfg.docLimit || "?"} documents` : scope === "selected" ? "Selected pages" : scope}
                        </span>
                      </InfoRow>
                    );
                  })()}
                  <InfoRow label="Total documents" value={status?.documentCount?.toLocaleString() || "0"} />
                </dl>
              </Card>

              {/* Processed documents list */}
              <Card title="Processed Documents" subtitle="Documents ingested from the source">
                {docsLoading ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
                    <Spinner className="h-4 w-4" /> Loading documents…
                  </div>
                ) : processedDocs.length === 0 ? (
                  <Empty message="No documents ingested yet. Run ingestion to populate this list." />
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-400">
                        {processedDocs.length} document{processedDocs.length !== 1 ? "s" : ""} ingested
                      </span>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-500">
                            <th className="pb-2 pr-3 font-medium">Document</th>
                            <th className="pb-2 pr-3 font-medium">Type</th>
                            <th className="pb-2 pr-3 font-medium">Last Modified</th>
                            <th className="pb-2 font-medium" aria-label="Actions" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {processedDocs.map((doc) => (
                            <tr key={doc.key} className="group">
                              <td className="py-2 pr-3">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${doc.type === "post" ? "bg-indigo-400" : "bg-emerald-400"}`} />
                                  <span className="font-medium text-slate-300" title={doc.key}>{doc.slug}</span>
                                </div>
                              </td>
                              <td className="py-2 pr-3">
                                <Badge tone={doc.type === "post" ? "indigo" : "green"} className="text-[10px]">
                                  {doc.type === "post" ? "Post" : doc.type === "page" ? "Page" : doc.type}
                                </Badge>
                              </td>
                              <td className="py-2 pr-3 text-slate-500">
                                {doc.modifiedAt ? new Date(doc.modifiedAt).toLocaleDateString() : "—"}
                              </td>
                              <td className="py-2 text-right">
                                <button
                                  type="button"
                                  title={`Preview '${doc.slug}' as stored in the knowledge base`}
                                  onClick={() => openDocPreview(doc.key)}
                                  className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-indigo-300"
                                >
                                  <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ── Ingested-document preview modal (Processed Documents) ─────── */}
      <Modal
        open={!!docPreview}
        title={docPreview?.data ? `Preview — ${docPreview.data.title}` : "Preview"}
        onClose={() => setDocPreview(null)}
        maxScreen
        footer={
          <>
            {docPreview?.data?.url && safeLinkUrl(docPreview.data.url) && (
              <a
                href={safeLinkUrl(docPreview.data.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              >Open source page</a>
            )}
            <button
              type="button"
              onClick={() => setDocPreview(null)}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >Close</button>
          </>
        }
      >
        {docPreview?.loading && (
          <div className="flex h-full min-h-[40vh] items-center justify-center gap-2 text-sm text-slate-400">
            <Spinner className="h-4 w-4" /> Loading document from storage…
          </div>
        )}
        {docPreview?.error && (
          <div role="alert" className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
            {docPreview.error}
          </div>
        )}
        {docPreview?.data && (
          <div className="flex h-full min-h-[60vh] flex-col">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono">{docPreview.data.chunkCount} chunks</span>
              {docPreview.data.truncated && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">truncated preview (large document)</span>
              )}
              {docPreview.data.storagePrefix && (
                <span className="truncate font-mono" title={`storage: ${docPreview.data.storagePrefix}/chunk-N.json`}>
                  {docPreview.data.storagePrefix}/chunk-N.json
                </span>
              )}
            </div>
            <div
              className="prose prose-invert max-w-none flex-1 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/40 p-4 text-sm leading-relaxed text-slate-200"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(docPreview.data.content || "(empty document)") }}
            />
          </div>
        )}
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: Ingestion                                                   */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "ingestion" && (
        <div className="space-y-4">
          {/* ── Live run / paused snapshot (persisted progress) ─────────── */}
          {progress && (
            <Card title={progress.running ? "Ingestion Running" : "Ingestion Paused"} subtitle={progress.running ? "Live progress for the current run" : "Resumable — progress snapshot from the pause point"}>
              <IngestProgressBox
                prog={progress}
                pausedAt={progress.pausedAt || status?.pausedAt}
                busy={actionBusy}
                onPause={pauseIngest}
                onStop={stopIngest}
                onResume={resumeIngest}
              />
            </Card>
          )}

          {/* Ingest controls */}
          <Card title="Run Ingestion" subtitle="Fetch content from the source and index it">
            <div className="flex flex-wrap items-center gap-3">
              {/* Scope selector — uses Popover to escape Card overflow-hidden */}
              <div className="shrink-0">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      disabled={!kb || ingesting || inProgress}
                      className="gap-1.5 whitespace-nowrap"
                    >
                      <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                      </svg>
                      Scope: {scope === "all" ? "All" : `Limit ${docLimit}`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" side="bottom" sideOffset={8} className="w-56 p-1">
                    <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">Ingestion scope</p>
                    <PopoverItem
                      onClick={() => setScope("all")}
                      className={scope === "all" ? "bg-indigo-500/15 text-indigo-300" : ""}
                    >
                      <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${scope === "all" ? "bg-indigo-400" : "bg-slate-600"}`} />
                      All documents
                    </PopoverItem>
                    <PopoverSeparator />
                    <PopoverItem
                      onClick={() => setScope("limit")}
                      className={scope === "limit" ? "bg-indigo-500/15 text-indigo-300" : ""}
                    >
                      <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${scope === "limit" ? "bg-indigo-400" : "bg-slate-600"}`} />
                      Limit documents
                    </PopoverItem>
                    {scope === "limit" && (
                      <div className="mt-1 px-3 py-2">
                        <label className="mb-1 block text-[11px] text-slate-500">Max documents</label>
                        <input type="number" min={1} max={10000} value={docLimit}
                          onChange={(e) => setDocLimit(e.target.value)}
                          className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none" />
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
              <Button onClick={runIngest} disabled={!kb || ingesting || inProgress || paused} className="whitespace-nowrap">
                {ingesting ? <Spinner className="h-3.5 w-3.5" /> : paused ? "Paused — Resume to continue" : "Run Ingest"}
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
                  <InfoRow
                    label={status.lastIngestion.documentsSkipped > 0 ? "Chunks created (last run)" : "Chunks created"}
                    value={status.lastIngestion.chunksCreated.toLocaleString()}
                    tip={status.lastIngestion.documentsSkipped > 0 ? `${status.lastIngestion.documentsSkipped.toLocaleString()} doc(s) skipped — unchanged since the previous run, so no new chunks were needed` : undefined}
                  />
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
      {/* TAB: Custom Q&A                                                  */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "qa" && (
        <CustomQATab kbKey={kbKey} company={company} notify={notify} />
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* TAB: Knowledge Graph (Phase 6)                                   */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "knowledge" && (
        <KnowledgeGraphTab kbKey={kbKey} company={company} kb={kb} notify={notify} />
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

          {/* REST source config (custom KBs) — read-only view of the stored
              source_config.rest. Auth secrets are never rendered; presence
              only. Edit via the wizard. */}
          {kb?.source_type === "custom" && (() => {
            const cfg = typeof kb.source_config === "string"
              ? (() => { try { return JSON.parse(kb.source_config); } catch { return null; } })()
              : kb.source_config;
            const rest = cfg?.rest;
            if (!rest) {
              return (
                <Card title="REST Source" subtitle="Custom API data feed">
                  <Empty message={
                    'No "rest" block in source_config — ingestion will fail unless a server-side adapter is registered for this KB. Edit the KB in the wizard to configure the API.'
                  } />
                </Card>
              );
            }
            const PAGINATION_LABELS = { page: "Page number", totalPages: "Page + total pages", cursor: "Cursor", link: "Link header", none: "None (single request)" };
            const auth = rest.auth || null;
            const AUTH_LABELS = { bearer: "Bearer token", header: "Custom header", basic: "Basic", query: "Query param" };
            return (
              <Card title="REST Source" subtitle="Custom API data feed — configured in the KB wizard">
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-slate-500">Endpoint</dt>
                    <dd className="mt-1 break-all rounded-md border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 font-mono text-xs text-slate-300">
                      {rest.endpoint || "—"}
                    </dd>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <InfoRow label="Pagination" value={PAGINATION_LABELS[rest.pagination] || "Page number"} />
                    {rest.itemsPath ? <InfoRow label="Items path" value={<span className="font-mono text-xs">{rest.itemsPath}</span>} /> : null}
                    {rest.pagination === "totalPages" && rest.totalPagesPath ? <InfoRow label="Total pages path" value={<span className="font-mono text-xs">{rest.totalPagesPath}</span>} /> : null}
                    {rest.pagination === "cursor" && rest.cursorPath ? <InfoRow label="Cursor path" value={<span className="font-mono text-xs">{rest.cursorPath}</span>} /> : null}
                    {rest.perPage ? <InfoRow label="Per page" value={String(rest.perPage)} /> : null}
                    {rest.maxItems ? <InfoRow label="Max items" value={String(rest.maxItems)} /> : null}
                    <InfoRow label="Content format" value={rest.contentFormat === "text" ? "Plain text" : "HTML"} />
                    <InfoRow
                      label="Authentication"
                      value={auth ? `${AUTH_LABELS[auth.type] || auth.type} · configured` : "None (public API)"}
                    />
                  </div>
                </dl>
                {auth && (
                  <p className="mt-3 text-[11px] text-slate-500">
                    🔒 Credentials are stored in the KB config and never displayed. Rotate them via the Edit wizard.
                  </p>
                )}
              </Card>
            );
          })()}

          {kb?.webhook_url && (
            <Card title="Webhook" subtitle="Notification endpoint for ingestion events">
              <dl className="space-y-2 text-sm">
                <InfoRow label="URL" value={kb.webhook_url} />
                <InfoRow label="HMAC secret" value={kb.has_webhook_secret ? "Configured" : "Not set"} />
                <InfoRow label="Events" value={Array.isArray(kb.webhook_events) ? kb.webhook_events.join(", ") : (kb.webhook_events || "completed, failed")} />
              </dl>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await api(`/gateway/kbs/${kbKey}/webhook/test`, { method: "POST", company });
                      notify("Test webhook sent.");
                    } catch (e) { setError(e.message); }
                  }}
                  className="text-xs"
                >
                  🧪 Send test webhook
                </Button>
              </div>
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
        onSaved={async () => { setEditOpen(false); /* success toast via api() auto-toaster */ await loadKb(); }}
      />

      <ScrollToTop className="fixed bottom-20 right-6 z-50" size="md" threshold={300} />
      {/* toast rendering: global <ToastViewport /> in App.jsx */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Q&A Tab
// ---------------------------------------------------------------------------

function CustomQATab({ kbKey, company, notify }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [testQ, setTestQ] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listKbQa(kbKey, company);
      setEntries(data);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [kbKey, company]);

  const openAdd = () => {
    setQuestion(""); setAnswer(""); setTags(""); setEditEntry(null); setShowAdd(true);
  };

  const openEdit = (entry) => {
    setQuestion(entry.question); setAnswer(entry.answer);
    setTags((entry.tags || []).join(", ")); setEditEntry(entry); setShowAdd(true);
  };

  const handleSave = async () => {
    if (!question.trim() || !answer.trim()) {
      setError("Question and answer are required."); return;
    }
    setSaving(true); setError(null);
    try {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (editEntry) {
        await updateKbQa(kbKey, editEntry.id, { question: question.trim(), answer: answer.trim(), tags: tagList }, company);
        notify("Q&A updated.");
      } else {
        await addKbQa(kbKey, { question: question.trim(), answer: answer.trim(), tags: tagList }, company);
        notify("Q&A added.");
      }
      setShowAdd(false); await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (entry) => {
    if (!window.confirm(`Delete this Q&A pair?`)) return;
    try {
      await deleteKbQa(kbKey, entry.id, company);
      notify("Q&A deleted."); await load();
    } catch (e) { setError(e.message); }
  };

  const handleToggle = async (entry) => {
    try {
      await updateKbQa(kbKey, entry.id, { enabled: !entry.enabled }, company);
      await load();
    } catch (e) { setError(e.message); }
  };

  const handleTest = async () => {
    if (!testQ.trim()) return;
    try {
      const result = await matchKbQa(kbKey, testQ.trim(), company);
      setTestResult(result);
    } catch (e) { setError(e.message); }
  };

  const enabledCount = entries.filter((e) => e.enabled).length;

  return (
    <div className="space-y-4">
      <Card title="Custom Q&A" subtitle="Direct answers that override the RAG pipeline for matching questions">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-4 text-xs text-slate-400">
            <span>{entries.length} total</span>
            <span>{enabledCount} enabled</span>
          </div>
          <Button size="sm" onClick={openAdd}>+ Add Q&A</Button>
        </div>

        {/* Test matcher */}
        <div className="mb-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Test question matching</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={testQ}
              onChange={(e) => setTestQ(e.target.value)}
              placeholder="Type a question to test matching..."
              className="flex-1 text-sm bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onKeyDown={(e) => e.key === "Enter" && handleTest()}
            />
            <Button size="sm" variant="secondary" onClick={handleTest}>Test</Button>
          </div>
          {testResult && (
            <div className="mt-2 text-xs">
              {testResult.matched ? (
                <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded text-emerald-400">
                  <span className="font-medium">✅ Match found:</span> "{testResult.match.question}"
                  <div className="mt-1 text-slate-300">{testResult.match.answer}</div>
                </div>
              ) : (
                <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded text-amber-400">
                  No match — this question would go through the RAG pipeline.
                </div>
              )}
            </div>
          )}
        </div>

        {error && <div className="text-xs text-red-400 mb-3">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-8"><Spinner className="h-5 w-5" /></div>
        ) : entries.length === 0 ? (
          <Empty message="No custom Q&A pairs yet. Add one to provide direct answers for specific questions." />
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.id} className={`p-3 rounded-lg border ${entry.enabled ? "border-slate-700 bg-slate-800/30" : "border-slate-800 bg-slate-900/30 opacity-60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-indigo-400">Q:</span>
                      <span className="text-sm text-slate-200 truncate">{entry.question}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-sm font-medium text-emerald-400">A:</span>
                      <span className="text-sm text-slate-300 line-clamp-2">{entry.answer}</span>
                    </div>
                    {entry.tags?.length > 0 && (
                      <div className="flex gap-1 mt-1.5">
                        {entry.tags.map((tag) => (
                          <span key={tag} className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggle(entry)}
                      className={`px-2 py-0.5 text-[10px] rounded ${entry.enabled ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700 text-slate-500"}`}
                      title={entry.enabled ? "Disable" : "Enable"}
                    >
                      {entry.enabled ? "ON" : "OFF"}
                    </button>
                    <button onClick={() => openEdit(entry)} className="p-1 text-slate-500 hover:text-slate-300" title="Edit">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                    <button onClick={() => handleDelete(entry)} className="p-1 text-slate-500 hover:text-red-400" title="Delete">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add/Edit Modal — viewport-clamped with internal scroll like the shared Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg mx-4 p-5 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <h3 className="text-lg font-semibold text-white mb-4">
              {editEntry ? "Edit Q&A" : "Add Custom Q&A"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Question</label>
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. What is your refund policy?"
                  className="w-full text-sm bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Answer</label>
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="The exact answer the AI should give..."
                  rows={4}
                  className="w-full text-sm bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Tags (comma-separated, optional)</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. refund, policy, billing"
                  className="w-full text-sm bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
            <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-700">
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

/** Information row: label on left, value on right — used in Overview + Config tabs. */
function InfoRow({ label, value, children, tip }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-1.5 text-slate-400">
        {label}
        {tip && <InfoTip content={tip} />}
      </dt>
      <dd className="text-right font-medium text-slate-100">{children || value || "—"}</dd>
    </div>
  );
}
