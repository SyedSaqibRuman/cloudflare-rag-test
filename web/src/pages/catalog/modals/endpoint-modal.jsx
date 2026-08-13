// --------------------------
// CATALOG — EndpointModal (add/edit an endpoint for a provider).
// --------------------------
import { useEffect, useRef, useState } from "react";
import { createEndpoint, updateEndpoint } from "../../../api";
import { Button, Input, Modal, Select, Spinner } from "../../../components/ui";
import { HTTP_METHODS } from "../constants";

export function EndpointModal({ open, row, providerKey, onClose, onSaved }) {
  const [form, setForm] = useState({
    endpointKey: "",
    endpointName: "",
    endpointUrl: "",
    httpMethod: "POST",
    defaultTimeoutSeconds: "30",
    isDefault: false,
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
              endpointKey: row.endpoint_key,
              endpointName: row.endpoint_name,
              endpointUrl: row.endpoint_url,
              httpMethod: row.http_method,
              defaultTimeoutSeconds: String(row.default_timeout_seconds ?? 30),
              isDefault: !!row.is_default,
            }
          : {
              endpointKey: "",
              endpointName: "",
              endpointUrl: "",
              httpMethod: "POST",
              defaultTimeoutSeconds: "30",
              isDefault: false,
            }
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
        endpointKey: form.endpointKey.trim(),
        endpointName: form.endpointName.trim(),
        endpointUrl: form.endpointUrl.trim(),
        httpMethod: form.httpMethod,
        defaultTimeoutSeconds: Number(form.defaultTimeoutSeconds),
        isDefault: form.isDefault,
      };
      if (row) await updateEndpoint(row.id, body);
      else await createEndpoint({ providerKey, ...body });
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
      title={row ? "Edit Endpoint" : "Add Endpoint"}
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
          label="Endpoint key"
          placeholder="e.g. chat-completions"
          value={form.endpointKey}
          onChange={(e) => set("endpointKey", e.target.value)}
          disabled={!!row}
          error={
            form.endpointKey && !/^[a-z0-9-]+$/.test(form.endpointKey)
              ? "Lowercase letters, numbers, and hyphens only (3–50 chars)."
              : form.endpointKey.length === 1 || form.endpointKey.length === 2
                ? "Must be 3–50 characters."
                : undefined
          }
        />
        <Input
          label="Name"
          placeholder="e.g. Chat Completions"
          value={form.endpointName}
          onChange={(e) => set("endpointName", e.target.value)}
        />
        <Input
          label="URL"
          placeholder="https://api.example.com/v1/chat/completions"
          value={form.endpointUrl}
          onChange={(e) => set("endpointUrl", e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="HTTP method"
            options={HTTP_METHODS}
            value={form.httpMethod}
            onChange={(e) => set("httpMethod", e.target.value)}
          />
          <Input
            label="Timeout (seconds)"
            type="number"
            min={1}
            max={3600}
            value={form.defaultTimeoutSeconds}
            onChange={(e) => set("defaultTimeoutSeconds", e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            name="endpointIsDefault"
            checked={form.isDefault}
            onChange={(e) => set("isDefault", e.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-950 accent-indigo-500"
          />
          Default endpoint for this provider
        </label>
        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}
