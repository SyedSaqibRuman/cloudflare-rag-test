import { useEffect, useRef, useState } from "react";
import { createKb, updateKb, getKbOptions } from "../api";
import { Modal, Button, Input, Select, TextArea, Spinner } from "./ui";

// Empty value = "Company default (config)" — no provider_resources rows exist
// for live companies yet (F8), so this is the leading, working option.
const OPTION_DEFAULT = { value: "", label: "Company default (config)" };

/**
 * Shared create/edit KB modal. `row` null → create (kb_key editable, prefilled
 * `${company}-kb`); otherwise edit (kb_key is the route identity — not editable).
 */
export default function KbModal({ open, row, company, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [options, setOptions] = useState({ vectorResources: [], storageResources: [], embeddingModels: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const wasOpen = useRef(open);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (open && !wasOpen.current) {
      setForm({
        kbKey: row ? row.kb_key : `${company || ""}-kb`,
        kbName: row?.kb_name ?? "",
        description: row?.description ?? "",
        vectorResourceId: row?.vector_resource_id ? String(row.vector_resource_id) : "",
        storageResourceId: row?.storage_resource_id ? String(row.storage_resource_id) : "",
        embeddingModelId: row?.embedding_model_id ? String(row.embedding_model_id) : "",
        chunkSize: String(row?.chunk_size ?? 512),
        chunkOverlap: String(row?.chunk_overlap ?? 50),
        retrievalTopK: String(row?.retrieval_top_k ?? 10),
        retrievalScoreThreshold: String(row?.retrieval_score_threshold ?? 0.7),
        enableHybridSearch: row ? !!row.enable_hybrid_search : true,
        enableGraphRag: row ? !!row.enable_graph_rag : false,
      });
      setError(null);
      if (company) {
        getKbOptions(company)
          .then(setOptions)
          .catch(() => {});
      }
    }
    wasOpen.current = open;
  }, [open, row, company]);

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
        chunkSize: Number(form.chunkSize),
        chunkOverlap: Number(form.chunkOverlap),
        retrievalTopK: Number(form.retrievalTopK),
        retrievalScoreThreshold: Number(form.retrievalScoreThreshold),
        enableHybridSearch: form.enableHybridSearch,
        enableGraphRag: form.enableGraphRag,
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

  const vectorOptions = [OPTION_DEFAULT, ...options.vectorResources.map((r) => ({ value: String(r.id), label: r.resource_name || r.resource_key }))];
  const storageOptions = [OPTION_DEFAULT, ...options.storageResources.map((r) => ({ value: String(r.id), label: r.resource_name || r.resource_key }))];
  const modelOptions = [OPTION_DEFAULT, ...options.embeddingModels.map((m) => ({ value: String(m.id), label: `${m.provider_name} · ${m.model_name}` }))];

  return (
    <Modal
      open={open}
      title={row ? "Edit Knowledge Base" : "Create Knowledge Base"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : row ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="KB key"
          placeholder="e.g. popularcert-kb"
          value={form.kbKey}
          onChange={(e) => set("kbKey", e.target.value)}
          disabled={!!row}
          error={
            form.kbKey && !/^[a-z0-9-]+$/.test(form.kbKey)
              ? "Lowercase letters, numbers, and hyphens only."
              : form.kbKey && (form.kbKey.length < 3 || form.kbKey.length > 63)
                ? "Must be 3–63 characters."
                : undefined
          }
        />
        <p className="-mt-1.5 text-[11px] text-slate-500">regex /^[a-z0-9-]+$/ · 3–63 chars</p>
        <Input
          label="Name"
          placeholder="e.g. PopularCert Knowledge Base"
          value={form.kbName}
          onChange={(e) => set("kbName", e.target.value)}
        />
        <TextArea
          label="Description (optional)"
          rows={2}
          placeholder="What this corpus covers"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Vector index"
            options={vectorOptions}
            value={form.vectorResourceId}
            onChange={(e) => set("vectorResourceId", e.target.value)}
          />
          <Select
            label="Storage (R2) bucket"
            options={storageOptions}
            value={form.storageResourceId}
            onChange={(e) => set("storageResourceId", e.target.value)}
          />
        </div>
        <Select
          label="Embedding model"
          options={modelOptions}
          value={form.embeddingModelId}
          onChange={(e) => set("embeddingModelId", e.target.value)}
        />
        <details className="group rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
          <summary className="cursor-pointer list-none text-xs font-medium text-slate-400 transition-colors hover:text-slate-200">
            <span className="inline-flex items-center gap-1.5">
              Advanced ingestion settings
              <svg aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Chunk size"
                type="number"
                min={1}
                max={10000}
                value={form.chunkSize}
                onChange={(e) => set("chunkSize", e.target.value)}
              />
              <Input
                label="Chunk overlap"
                type="number"
                min={0}
                value={form.chunkOverlap}
                onChange={(e) => set("chunkOverlap", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Retrieval top-K"
                type="number"
                min={1}
                max={100}
                value={form.retrievalTopK}
                onChange={(e) => set("retrievalTopK", e.target.value)}
              />
              <Input
                label="Score threshold"
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={form.retrievalScoreThreshold}
                onChange={(e) => set("retrievalScoreThreshold", e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.enableHybridSearch}
                onChange={(e) => set("enableHybridSearch", e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-indigo-500"
              />
              Hybrid search (vector + keyword)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.enableGraphRag}
                onChange={(e) => set("enableGraphRag", e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-indigo-500"
              />
              Graph RAG <span className="text-xs text-slate-500">(deferred — stored, not yet applied)</span>
            </label>
          </div>
        </details>
        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}
