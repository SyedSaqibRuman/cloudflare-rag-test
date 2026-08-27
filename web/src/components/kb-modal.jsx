// --------------------------
// KB WIZARD — 5-step create/edit knowledge base modal.
// Steps: Basic Info → Data Source → Storage & Search → Processing → Review.
// Replaced the former 3-tab modal with a linear wizard to match the design doc.
// --------------------------

import { useEffect, useRef, useState } from "react";
import { createKb, updateKb, getKbOptions } from "../api";
import { Modal, Button, Input, Select, TextArea, Spinner, Toggle } from "./ui";

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------
const STEPS = [
  { id: "basic", label: "Basic Info", icon: "📝" },
  { id: "source", label: "Data Source", icon: "📥" },
  { id: "storage", label: "Storage & Search", icon: "📦" },
  { id: "processing", label: "Processing", icon: "⚙️" },
  { id: "review", label: "Review", icon: "✅" },
];

const SOURCE_TYPES = [
  { value: "wordpress", label: "WordPress", note: "REST API", icon: "🔧" },
  { value: "file", label: "File Upload", note: "Documents", icon: "📄" },
  { value: "url", label: "URL / Sitemap", note: "Web pages", icon: "🌐" },
  { value: "custom", label: "Custom", note: "API-driven", icon: "⚙️" },
];

const OPTION_DEFAULT = { value: "", label: "Company default (config)" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseUrls(config) {
  if (!config) return [];
  const raw = typeof config === "string" ? JSON.parse(config) : config;
  return Array.isArray(raw.urls) ? raw.urls : [];
}

function parseSitemapUrl(config) {
  if (!config) return "";
  const raw = typeof config === "string" ? JSON.parse(config) : config;
  return raw.sitemapUrl || "";
}

function parseScope(config) {
  if (!config) return { scope: "all", docLimit: "100" };
  const raw = typeof config === "string" ? JSON.parse(config) : config;
  return { scope: raw.scope || "all", docLimit: String(raw.docLimit || 100) };
}

/** Step indicator — numbered pill bar at the top of the modal. */
function StepBar({ steps, current }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={step.id} className="flex items-center">
            <span
              className={`flex h-7 min-w-[2rem] items-center justify-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-all ${
                active
                  ? "border-indigo-500 bg-indigo-500/15 text-indigo-300"
                  : done
                    ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-400"
                    : "border-slate-700 bg-slate-800/50 text-slate-500"
              }`}
            >
              {done ? (
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <span>{i + 1}</span>
              )}
              <span className="hidden sm:inline">{step.label}</span>
            </span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-2 bg-slate-700" />}
          </div>
        );
      })}
    </div>
  );
}

/** Section card wrapper for visual grouping. */
function Section({ title, icon, children, className = "" }) {
  return (
    <div className={`rounded-xl border border-slate-800/80 bg-gradient-to-br from-slate-900/80 to-slate-950/60 p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-800 text-sm">{icon}</span>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h4>
      </div>
      {children}
    </div>
  );
}

/** Source type card selector. */
function SourceTypeSelector({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {SOURCE_TYPES.map((st) => (
        <button
          key={st.value}
          type="button"
          onClick={() => onChange(st.value)}
          className={`group flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-all ${
            value === st.value
              ? "border-indigo-500 bg-indigo-500/10 shadow-lg shadow-indigo-500/5"
              : "border-slate-800 bg-slate-900/50 hover:border-slate-600 hover:bg-slate-800/50"
          }`}
        >
          <span className="text-xl">{st.icon}</span>
          <div className="min-w-0">
            <p className={`text-sm font-medium ${value === st.value ? "text-indigo-300" : "text-slate-200"}`}>{st.label}</p>
            <p className="text-[11px] text-slate-500">{st.note}</p>
          </div>
          {value === st.value && (
            <svg className="ml-auto h-4 w-4 shrink-0 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function KbModal({ open, row, company, onClose, onSaved }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    kbKey: "",
    kbName: "",
    description: "",
    vectorResourceId: "",
    storageResourceId: "",
    embeddingModelId: "",
    sourceType: "wordpress",
    urls: "",
    sitemapUrl: "",
    ingestScope: "all",
    docLimit: "100",
    chunkSize: "512",
    chunkOverlap: "50",
    retrievalTopK: "10",
    retrievalScoreThreshold: "0.7",
    enableHybridSearch: true,
    enableGraphRag: false,
    webhookUrl: "",
    webhookSecret: "",
  });
  const [options, setOptions] = useState({ vectorResources: [], storageResources: [], embeddingModels: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const wasOpen = useRef(open);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Reset on open
  useEffect(() => {
    if (open && !wasOpen.current) {
      setStep(0);
      setForm({
        kbKey: row ? row.kb_key : `${company || ""}-kb`,
        kbName: row?.kb_name ?? "",
        description: row?.description ?? "",
        vectorResourceId: row?.vector_resource_id ? String(row.vector_resource_id) : "",
        storageResourceId: row?.storage_resource_id ? String(row.storage_resource_id) : "",
        embeddingModelId: row?.embedding_model_id ? String(row.embedding_model_id) : "",
        sourceType: row?.source_type ?? "wordpress",
        urls: parseUrls(row?.source_config).join("\n"),
        sitemapUrl: parseSitemapUrl(row?.source_config),
        ingestScope: parseScope(row?.source_config).scope,
        docLimit: parseScope(row?.source_config).docLimit,
        chunkSize: String(row?.chunk_size ?? 512),
        chunkOverlap: String(row?.chunk_overlap ?? 50),
        retrievalTopK: String(row?.retrieval_top_k ?? 10),
        retrievalScoreThreshold: String(row?.retrieval_score_threshold ?? 0.7),
        enableHybridSearch: row ? !!row.enable_hybrid_search : true,
        enableGraphRag: row ? !!row.enable_graph_rag : false,
        webhookUrl: row?.webhook_url ?? "",
        webhookSecret: "",
      });
      setError(null);
      if (company) {
        getKbOptions(company)
          .then(setOptions)
          .catch((e) => console.error("Failed to load KB options:", e));
      }
    }
    wasOpen.current = open;
  }, [open, row, company]);

  // Validation per step
  const canContinue = () => {
    if (step === 0) {
      return form.kbName.trim() && /^[a-z0-9-]+$/.test(form.kbKey) && form.kbKey.length >= 3;
    }
    // Steps 1-4 always valid (optional fields)
    return true;
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const numOrUndef = (v) => (v === "" || v === null ? undefined : Number(v));
      const body = {
        kbKey: form.kbKey.trim(),
        kbName: form.kbName.trim(),
        description: form.description.trim() || null,
        vectorResourceId: numOrUndef(form.vectorResourceId),
        storageResourceId: numOrUndef(form.storageResourceId),
        embeddingModelId: numOrUndef(form.embeddingModelId),
        sourceType: form.sourceType || "wordpress",
        sourceConfig: ["wordpress", "url"].includes(form.sourceType)
          ? {
              ...(form.sourceType === "url" ? {
                urls: form.urls.split("\n").map((u) => u.trim()).filter(Boolean),
                sitemapUrl: form.sitemapUrl.trim() || undefined,
              } : {}),
              scope: form.ingestScope || "all",
              docLimit: form.ingestScope === "limit" ? Number(form.docLimit) : undefined,
            }
          : undefined,
        chunkSize: Number(form.chunkSize),
        chunkOverlap: Number(form.chunkOverlap),
        retrievalTopK: Number(form.retrievalTopK),
        retrievalScoreThreshold: Number(form.retrievalScoreThreshold),
        enableHybridSearch: form.enableHybridSearch,
        enableGraphRag: form.enableGraphRag,
        webhookUrl: form.webhookUrl.trim() || null,
        ...(row
          ? form.webhookSecret.trim() && { webhookSecret: form.webhookSecret.trim() }
          : { webhookSecret: form.webhookSecret.trim() || null }),
      };
      if (row) await updateKb(row.kb_key, body, company);
      else await createKb(body, company);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  // Build option lists
  const seenVector = new Set();
  const vectorResourceOpts = [];
  for (const r of options.vectorResources || []) {
    const key = r.external_resource_id || r.resource_key;
    if (seenVector.has(key)) continue;
    seenVector.add(key);
    vectorResourceOpts.push({ value: String(r.id), label: `${r.resource_name || r.resource_key}${r.provider_name ? ` · ${r.provider_name}` : ""}` });
  }
  for (const r of options.liveVectorResources || []) {
    const key = r.name || r.id;
    if (seenVector.has(key)) continue;
    seenVector.add(key);
    vectorResourceOpts.push({ value: key, label: `${r.name || r.id} (live)` });
  }

  const seenStorage = new Set();
  const storageResourceOpts = [];
  for (const r of options.storageResources || []) {
    const key = r.external_resource_id || r.resource_key;
    if (seenStorage.has(key)) continue;
    seenStorage.add(key);
    storageResourceOpts.push({ value: String(r.id), label: `${r.resource_name || r.resource_key}${r.provider_name ? ` · ${r.provider_name}` : ""}` });
  }
  for (const r of options.liveStorageResources || []) {
    const key = r.name || r.id;
    if (seenStorage.has(key)) continue;
    seenStorage.add(key);
    storageResourceOpts.push({ value: key, label: `${r.name || r.id} (live)` });
  }

  const vectorOptions = [OPTION_DEFAULT, ...vectorResourceOpts];
  const storageOptions = [OPTION_DEFAULT, ...storageResourceOpts];
  const modelOptions = [OPTION_DEFAULT, ...(options.embeddingModels || []).map((m) => ({ value: String(m.id), label: `${m.provider_name} · ${m.model_name}` }))];

  const selectedModel = (options.embeddingModels || []).find((m) => String(m.id) === form.embeddingModelId);

  return (
    <Modal
      open={open}
      title={row ? "Edit Knowledge Base" : "Create Knowledge Base"}
      onClose={onClose}
      maxScreen
      footer={
        <div className="flex w-full items-center justify-between">
          <div>
            {step > 0 && (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                ← Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canContinue()}>
                Continue →
              </Button>
            ) : (
              <Button onClick={submit} disabled={busy}>
                {busy ? <Spinner className="h-3.5 w-3.5" /> : row ? "Save Changes" : "Create Knowledge Base"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {/* Step indicator */}
      <div className="mb-5 -mx-1">
        <StepBar steps={STEPS} current={step} />
      </div>

      {/* ── Step 1: Basic Info ──────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-4">
          <Section title="Basic Information" icon="📝">
            <div className="space-y-3">
              <Input
                label="Name"
                placeholder="e.g. PopularCert Knowledge Base"
                value={form.kbName}
                onChange={(e) => {
                  set("kbName", e.target.value);
                  if (!row) {
                    const key = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 63);
                    set("kbKey", key);
                  }
                }}
              />
              <div>
                <Input
                  label="Key"
                  placeholder="e.g. popularcert-kb"
                  value={form.kbKey}
                  onChange={(e) => set("kbKey", e.target.value)}
                  disabled={!!row}
                  error={
                    form.kbKey && !/^[a-z0-9-]+$/.test(form.kbKey)
                      ? "Lowercase, numbers, hyphens only"
                      : form.kbKey && (form.kbKey.length < 3 || form.kbKey.length > 63)
                        ? "3–63 characters required"
                        : undefined
                  }
                />
                <p className="mt-1 text-[11px] text-slate-600">Auto-generated from name · Editable in create mode</p>
              </div>
              <TextArea
                label="Description"
                rows={2}
                placeholder="What content does this knowledge base contain?"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>
          </Section>
        </div>
      )}

      {/* ── Step 2: Data Source ─────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <Section title="Data Source" icon="📥">
            <p className="mb-3 text-sm text-slate-400">Where should this knowledge base get its content?</p>
            <SourceTypeSelector value={form.sourceType} onChange={(v) => set("sourceType", v)} />

            {/* Scope selector for WordPress/URL */}
            {["wordpress", "url"].includes(form.sourceType) && (
              <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
                <p className="mb-2 text-xs font-medium text-slate-400">Ingestion scope</p>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                    <input
                      type="radio"
                      name="ingestScope"
                      value="all"
                      checked={form.ingestScope === "all"}
                      onChange={() => set("ingestScope", "all")}
                      className="h-4 w-4 border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                    />
                    <span>Entire website</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                    <input
                      type="radio"
                      name="ingestScope"
                      value="limit"
                      checked={form.ingestScope === "limit"}
                      onChange={() => set("ingestScope", "limit")}
                      className="h-4 w-4 border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                    />
                    <span>Limit documents</span>
                  </label>
                </div>
                {form.ingestScope === "limit" && (
                  <div className="mt-2">
                    <Input
                      label="Maximum documents"
                      type="number"
                      min={1}
                      max={100000}
                      value={form.docLimit}
                      onChange={(e) => set("docLimit", e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-slate-600">Stop after processing this many documents</p>
                  </div>
                )}
              </div>
            )}

            {/* URL-specific fields */}
            {form.sourceType === "url" && (
              <div className="mt-3 space-y-3">
                <Input
                  label="Sitemap URL (optional)"
                  placeholder="https://example.com/sitemap.xml"
                  value={form.sitemapUrl}
                  onChange={(e) => set("sitemapUrl", e.target.value)}
                />
                <p className="-mt-2 text-[11px] text-slate-600">Auto-discover pages from sitemap.xml — max 1000 URLs</p>
                {!form.sitemapUrl && (
                  <TextArea
                    label="Or enter URLs manually"
                    rows={4}
                    placeholder={"https://example.com/page-1\nhttps://example.com/page-2"}
                    value={form.urls}
                    onChange={(e) => set("urls", e.target.value)}
                  />
                )}
              </div>
            )}

            {form.sourceType === "file" && (
              <p className="mt-3 text-sm text-slate-500">
                Files can be uploaded after creation from the Knowledge Base detail page.
              </p>
            )}
          </Section>
        </div>
      )}

      {/* ── Step 3: Storage & Search ────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <Section title="Vector Database" icon="🔮">
            <Select
              label="Vector Store"
              options={vectorOptions}
              value={form.vectorResourceId}
              onChange={(e) => set("vectorResourceId", e.target.value)}
            />
            <p className="mt-1 text-[11px] text-slate-600">
              Provider-agnostic — Cloudflare Vectorize, Pinecone, or any compatible store
            </p>
          </Section>

          <Section title="Object Storage" icon="☁️">
            <Select
              label="Document Storage"
              options={storageOptions}
              value={form.storageResourceId}
              onChange={(e) => set("storageResourceId", e.target.value)}
            />
            <p className="mt-1 text-[11px] text-slate-600">
              Chunked documents are stored here for retrieval
            </p>
          </Section>

          <Section title="Embedding" icon="🧠">
            <Select
              label="Embedding Model"
              options={modelOptions}
              value={form.embeddingModelId}
              onChange={(e) => set("embeddingModelId", e.target.value)}
            />
            {selectedModel && (
              <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
                <span>Provider: <span className="text-slate-300">{selectedModel.provider_name}</span></span>
                {selectedModel.dimensions && <span>Dimensions: <span className="text-slate-300">{selectedModel.dimensions}</span></span>}
              </div>
            )}
          </Section>

          <Section title="Knowledge Graph" icon="🕸️" className="opacity-60">
            <div className="flex items-center justify-between rounded-lg bg-slate-800/30 p-3">
              <div>
                <p className="text-sm font-medium text-slate-200">GraphRAG</p>
                <p className="text-[11px] text-slate-500">Knowledge graph context (Neo4j — coming soon)</p>
              </div>
              <Toggle
                checked={form.enableGraphRag}
                onChange={(v) => set("enableGraphRag", v)}
                disabled
              />
            </div>
          </Section>
        </div>
      )}

      {/* ── Step 4: Processing ──────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <Section title="Chunking" icon="🧩">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Chunk size (chars)"
                type="number"
                min={1}
                max={10000}
                value={form.chunkSize}
                onChange={(e) => set("chunkSize", e.target.value)}
              />
              <Input
                label="Overlap (chars)"
                type="number"
                min={0}
                value={form.chunkOverlap}
                onChange={(e) => set("chunkOverlap", e.target.value)}
              />
            </div>
          </Section>

          <Section title="Retrieval" icon="🔍">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Top-K results"
                type="number"
                min={1}
                max={100}
                value={form.retrievalTopK}
                onChange={(e) => set("retrievalTopK", e.target.value)}
              />
              <Input
                label="Similarity threshold"
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={form.retrievalScoreThreshold}
                onChange={(e) => set("retrievalScoreThreshold", e.target.value)}
              />
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-800/30 p-3">
              <div>
                <p className="text-sm font-medium text-slate-200">Hybrid search</p>
                <p className="text-[11px] text-slate-500">Combine vector similarity with keyword matching</p>
              </div>
              <Toggle
                checked={form.enableHybridSearch}
                onChange={(v) => set("enableHybridSearch", v)}
              />
            </div>
          </Section>
        </div>
      )}

      {/* ── Step 5: Review ──────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">
          <Section title="Review Knowledge Base" icon="✅">
            <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
              <h3 className="text-base font-semibold text-slate-100">{form.kbName || "Untitled"}</h3>
              <p className="mt-0.5 font-mono text-[11px] text-slate-500">{form.kbKey}</p>
              {form.description && <p className="mt-2 text-sm text-slate-400">{form.description}</p>}

              <dl className="mt-4 space-y-3 text-sm">
                <ReviewRow label="Source" value={
                  form.sourceType === "wordpress" ? "WordPress" :
                  form.sourceType === "url" ? "URL / Sitemap" :
                  form.sourceType === "file" ? "File Upload" : "Custom"
                } />
                {form.sourceType === "url" && form.urls && (
                  <ReviewRow label="URLs" value={`${form.urls.split("\n").filter(Boolean).length} configured`} />
                )}
                <ReviewRow label="Scope" value={
                  form.ingestScope === "limit" ? `Limit ${form.docLimit} documents` : "Entire website"
                } />
                <div className="border-t border-slate-700/50" />
                <ReviewRow label="Embedding" value={
                  selectedModel ? `${selectedModel.provider_name} · ${selectedModel.model_name}` : "Company default"
                } />
                <ReviewRow label="Vector Store" value={
                  vectorOptions.find((o) => o.value === form.vectorResourceId)?.label || "Company default"
                } />
                <ReviewRow label="Object Storage" value={
                  storageOptions.find((o) => o.value === form.storageResourceId)?.label || "Company default"
                } />
                <div className="border-t border-slate-700/50" />
                <ReviewRow label="Chunking" value={`${form.chunkSize} chars · ${form.chunkOverlap} overlap`} />
                <ReviewRow label="Retrieval" value={`Top-${form.retrievalTopK} · ≥ ${Number(form.retrievalScoreThreshold).toFixed(2)}`} />
                <ReviewRow label="Hybrid search" value={form.enableHybridSearch ? "✓ Enabled" : "— Disabled"} />
                <ReviewRow label="GraphRAG" value={form.enableGraphRag ? "✓ Enabled" : "— Disabled"} />
              </dl>
            </div>
          </Section>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error}
        </div>
      )}
    </Modal>
  );
}

/** Review summary row: label on left, value on right. */
function ReviewRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-500 uppercase text-[10px] tracking-wider">{label}</dt>
      <dd className="text-right font-medium text-slate-200">{value}</dd>
    </div>
  );
}
