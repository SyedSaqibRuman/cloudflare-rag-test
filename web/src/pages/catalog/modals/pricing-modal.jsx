// --------------------------
// CATALOG — PricingModal (add/edit a price row for a model).
// --------------------------
import { useEffect, useRef, useState } from "react";
import { createPricing, updatePricing } from "../../../api";
import { Button, Input, Modal, Select, Spinner } from "../../../components/ui";
import { ymd } from "../utils";

export function PricingModal({ open, row, model, onClose, onSaved }) {
  const [form, setForm] = useState({
    effectiveFrom: "",
    effectiveTo: "",
    inputPricePerMillion: "",
    outputPricePerMillion: "",
    priceCurrency: "USD",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const wasOpen = useRef(open);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (open && !wasOpen.current) {
      setForm(
        row
          ? {
              effectiveFrom: ymd(row.effective_from),
              effectiveTo: row.effective_to ? ymd(row.effective_to) : "",
              inputPricePerMillion: row.input_price_per_million ?? "",
              outputPricePerMillion: row.output_price_per_million ?? "",
              priceCurrency: row.price_currency || "USD",
            }
          : { effectiveFrom: "", effectiveTo: "", inputPricePerMillion: "", outputPricePerMillion: "", priceCurrency: "USD" }
      );
      setError(null);
    }
    wasOpen.current = open;
  }, [open, row]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        providerModelId: model.id,
        effectiveFrom: form.effectiveFrom,
        effectiveTo: form.effectiveTo || null,
        inputPricePerMillion: form.inputPricePerMillion === "" ? null : Number(form.inputPricePerMillion),
        outputPricePerMillion: form.outputPricePerMillion === "" ? null : Number(form.outputPricePerMillion),
        priceCurrency: form.priceCurrency,
      };
      if (row) await updatePricing(row.id, body);
      else await createPricing(body);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <Modal
      open={open}
      title={row ? "Edit Price" : "Add Price"}
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
        <p className="text-xs text-slate-400">
          Model: <span className="font-medium text-slate-200">{model?.model_name}</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Effective from" type="date" value={form.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} />
          <Input label="Effective to (optional)" type="date" value={form.effectiveTo} onChange={(e) => set("effectiveTo", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Input $ / 1M" type="number" step="any" min={0} placeholder="e.g. 1.50" value={form.inputPricePerMillion} onChange={(e) => set("inputPricePerMillion", e.target.value)} />
          <Input label="Output $ / 1M" type="number" step="any" min={0} placeholder="e.g. 3.00" value={form.outputPricePerMillion} onChange={(e) => set("outputPricePerMillion", e.target.value)} />
        </div>
        <Select label="Currency" options={["USD"]} value={form.priceCurrency} onChange={(e) => set("priceCurrency", e.target.value)} />
        <p className="text-xs text-slate-500">
          Saving with no effective-to closes the current open price row on the overlap date (one current price per model).
        </p>
        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}
