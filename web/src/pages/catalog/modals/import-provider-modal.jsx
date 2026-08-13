// --------------------------
// CATALOG — ImportProviderModal (platform-admin catalog operation).
// The JSON is the seed/import format; MySQL is the runtime source of truth
// (registry reloads after import). Re-importing an existing provider refreshes
// its metadata.
// --------------------------
import { useEffect, useState } from "react";
import { importProviderDefinition } from "../../../api";
import { Button, Modal, Spinner } from "../../../components/ui";

const SAMPLE_DEFINITION = JSON.stringify(
  {
    provider: {
      key: "openai",
      name: "OpenAI",
      category: "ai",
      website: "https://openai.com",
      documentation: "https://platform.openai.com/docs",
      defaultApiBaseUrl: "https://api.openai.com/v1",
      authType: "bearer_token",
      authHeaderName: "Authorization",
    },
    authentication: {
      fields: [
        {
          name: "api_key",
          label: "API Key",
          type: "password",
          required: true,
          encrypted: true,
          validationRegex: "^sk-[A-Za-z0-9]{20,}$",
        },
      ],
    },
    endpoints: [],
    capabilities: ["text_generation", "embeddings"],
    models: [
      {
        key: "gpt-4o",
        name: "GPT-4o",
        category: "chat",
        streaming: true,
        functionCalling: true,
        maxContextWindow: 128000,
        pricing: [{ inputPricePerMillion: 2.5, outputPricePerMillion: 10 }],
      },
    ],
    resources: [],
  },
  null,
  2
);

export function ImportProviderModal({ open, onClose, onSaved }) {
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      setJson("");
      setError(null);
      setResult(null);
    }
  }, [open]);

  const doImport = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let definition;
      try {
        definition = JSON.parse(json);
      } catch {
        throw new Error("Invalid JSON — check the editor for syntax errors.");
      }
      const data = await importProviderDefinition(definition);
      setResult(data);
      onSaved?.(definition.providerKey || definition.provider?.key || definition.key);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Import Provider JSON"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => setJson(SAMPLE_DEFINITION)} disabled={busy}>
            Load example
          </Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={doImport} disabled={busy || !json.trim()}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : "Import"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
        )}
        {result && (
          <div role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {result.created ? "Provider created" : "Provider refreshed"} — {result.counts.models} models,{" "}
            {result.counts.authFields} auth field(s), {result.counts.endpoints} endpoint(s),{" "}
            {result.counts.capabilities} capability(ies), {result.counts.pricing} price rows.
          </div>
        )}
        <p className="text-xs text-slate-500">
          Imports a provider definition into the catalog — base metadata, auth form, endpoints, capabilities,
          models (+ pricing), and resource templates — in one transaction. Existing rows are refreshed, tenant
          credentials are never touched. The auth form drives the credential screen, so no React form code is needed.
        </p>
        <textarea
          name="provider-definition-json"
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={14}
          spellCheck="false"
          placeholder='{ "provider": { "key": "openai", ... }, "authentication": { "fields": [...] }, ... }'
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 outline-none focus:border-indigo-500"
        />
      </div>
    </Modal>
  );
}
