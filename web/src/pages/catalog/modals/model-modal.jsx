// --------------------------
// CATALOG — ModelModal (add/edit a provider model).
// Add via POST /gateway/providers/:key/models, edit via PUT …/:id. `row`
// (snake_case model row) enables edit mode: fields prefill, the key is locked,
// pricing fields are hidden (pricing is managed through the “Add price” flow).
// --------------------------
import { useEffect, useRef, useState } from "react";
import { createProviderModel, updateProviderModel } from "../../../api";
import { Button, Input, Modal, Select, Spinner } from "../../../components/ui";
import { MODEL_CATEGORIES } from "../constants";
import { modelKeyFromName } from "../utils";

export function ModelModal({ open, row, providerKey, onClose, onSaved }) {
  const [form, setForm] = useState({
    key: "",
    name: "",
    family: "",
    category: "chat",
    streaming: true,
    functionCalling: false,
    vision: false,
    maxContextWindow: "",
    maxOutputTokens: "",
    inputPricePerMillion: "",
    outputPricePerMillion: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Once the user types in the key field, the auto-sync from the name stops
  // (same behavior as the provider wizard + credentials page). In edit mode
  // auto-sync is OFF from the start: the key is only changed when the user
  // edits the key field directly (a name rename must not silently rename it).
  const [keyTouched, setKeyTouched] = useState(false);
  const wasOpen = useRef(open);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (open && !wasOpen.current) {
      const r = row || {};
      setForm({
        key: r.model_key || "",
        name: r.model_name || "",
        family: r.model_family || "",
        category: r.category || "chat",
        streaming: !!r.supports_streaming,
        functionCalling: !!r.supports_function_calling,
        vision: !!r.supports_vision,
        maxContextWindow: r.max_context_window != null ? String(r.max_context_window) : "",
        maxOutputTokens: r.max_output_tokens != null ? String(r.max_output_tokens) : "",
        inputPricePerMillion: "",
        outputPricePerMillion: "",
      });
      setError(null);
      setKeyTouched(!!row); // edit mode: never auto-sync the key from the name
    }
    wasOpen.current = open;
  }, [open, row]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const isEdit = !!row;
      if (!isEdit) {
        if (!form.key.trim()) throw new Error("Model key is required.");
        if (!/^[a-zA-Z0-9@][a-zA-Z0-9._:@/-]*$/.test(form.key.trim())) {
          throw new Error("Model key: letters, numbers, dots, underscores, hyphens, and @ / : for vendor-prefixed IDs (e.g. gpt-4o, @cf/baai/bge-base-en-v1.5).");
        }
      }
      if (!form.name.trim()) throw new Error("Model name is required.");
      // Empty optional fields send null (not undefined): the backend treats
      // undefined as "keep the stored value", so null is what actually clears
      // family / context window / output tokens in edit mode.
      const body = {
        key: form.key.trim() || row?.model_key,
        name: form.name.trim(),
        family: form.family.trim() || null,
        category: form.category,
        streaming: form.streaming,
        functionCalling: form.functionCalling,
        vision: form.vision,
        maxContextWindow: form.maxContextWindow === "" ? null : Number(form.maxContextWindow),
        maxOutputTokens: form.maxOutputTokens === "" ? null : Number(form.maxOutputTokens),
      };
      if (isEdit) {
        await updateProviderModel(providerKey, row.id, body);
      } else {
        const pricing = [];
        if (form.inputPricePerMillion !== "" || form.outputPricePerMillion !== "") {
          pricing.push({
            inputPricePerMillion: form.inputPricePerMillion === "" ? null : Number(form.inputPricePerMillion),
            outputPricePerMillion: form.outputPricePerMillion === "" ? null : Number(form.outputPricePerMillion),
          });
        }
        body.pricing = pricing;
        await createProviderModel(providerKey, body);
      }
      onSaved(form.key.trim() || row?.model_key);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const isEdit = !!row;
  return (
    <Modal
      open={open}
      title={isEdit ? `Edit Model — ${row?.model_name || row?.model_key || ""}` : `Add Model — ${providerKey || ""}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : isEdit ? "Save Changes" : "Add Model"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Model name *"
            placeholder="GPT-4o"
            value={form.name}
            onChange={(e) => {
              set("name", e.target.value);
              if (!keyTouched) set("key", modelKeyFromName(e.target.value));
            }}
            autoFocus
          />
          <Input
            label="Model key *"
            placeholder="gpt-4o or @cf/baai/bge-base-en-v1.5"
            value={form.key}
            onChange={(e) => {
              set("key", e.target.value);
              setKeyTouched(true);
            }}
            error={form.key && !/^[a-zA-Z0-9@][a-zA-Z0-9._:@/-]*$/.test(form.key) ? "Letters, numbers, dots, _, -, @ and / only." : undefined}
          />
        </div>
        {!isEdit && (
          <p className="-mt-2 text-[11px] text-slate-500">Model key auto-generates from the name — typing in it manually stops the auto-sync.</p>
        )}
        {isEdit && (
          <p className="-mt-2 text-[11px] text-slate-500">Model key is editable — renaming it updates the key everywhere it's referenced (pricing and credential model-access grants follow the model row).</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Family (optional)" placeholder="gpt-4" value={form.family} onChange={(e) => set("family", e.target.value)} />
          <Select label="Category *" options={MODEL_CATEGORIES} value={form.category} onChange={(e) => set("category", e.target.value)} />
        </div>
        <label className="flex flex-wrap items-center gap-5 text-sm text-slate-300">
          <span className="flex items-center gap-2">
            <input type="checkbox" name="streaming" checked={form.streaming} onChange={(e) => set("streaming", e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500" />
            Streaming
          </span>
          <span className="flex items-center gap-2">
            <input type="checkbox" name="functionCalling" checked={form.functionCalling} onChange={(e) => set("functionCalling", e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500" />
            Function calling
          </span>
          <span className="flex items-center gap-2">
            <input type="checkbox" name="vision" checked={form.vision} onChange={(e) => set("vision", e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500" />
            Vision
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Max context window" type="number" min={1} placeholder="128000" value={form.maxContextWindow} onChange={(e) => set("maxContextWindow", e.target.value)} />
          <Input label="Max output tokens" type="number" min={1} placeholder="4096" value={form.maxOutputTokens} onChange={(e) => set("maxOutputTokens", e.target.value)} />
        </div>
        {!isEdit && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">Starting price (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Input $ / 1M" type="number" step="any" min={0} placeholder="e.g. 2.50" value={form.inputPricePerMillion} onChange={(e) => set("inputPricePerMillion", e.target.value)} />
              <Input label="Output $ / 1M" type="number" step="any" min={0} placeholder="e.g. 10.00" value={form.outputPricePerMillion} onChange={(e) => set("outputPricePerMillion", e.target.value)} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Leave both blank to create the model without pricing (add pricing later via “Add price”).</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
