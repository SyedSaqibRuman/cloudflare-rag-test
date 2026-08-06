import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Button, Input, Select, Spinner, Badge, Toast } from "../components/ui";
import { useCompanies } from "../context";
import { useHeaderActions } from "../components/Layout";
import {
  EMBEDDING_MODELS,
  LLM_MODELS,
  SMALL_LLMS,
  RERANKING_MODELS,
  EMBEDDING_DIMENSIONS,
  GENERAL_KEYS,
  STORAGE_KEYS,
  CREDENTIAL_KEYS,
} from "../models";

const MODEL_LABELS = {
  EMBEDDING_MODEL: "Embedding Model",
  LLM_MODEL: "Primary LLM",
  SMALL_LLM: "Query Rewriter",
  RERANKING_MODEL: "Reranker",
};

const GENERAL_LABELS = {
  BASE_URL: "Base Website",
  CONTACT_US_URL: "Contact Us URL",
  LOCATIONS_URL: "Locations URL",
  SERVICES_URL: "Services URL",
  CONSULTANT_NAME: "Consultant Name",
  COMPANY_NAME: "Company Display Name",
};

const STORAGE_LABELS = {
  VECTOR_INDEX: "Vector Index",
  R2_BUCKET_NAME: "R2 Bucket",
};

const CREDENTIAL_LABELS = {
  CLOUDFLARE_ACCOUNT_ID: "Cloudflare Account ID",
  CLOUDFLARE_API_TOKEN: "Cloudflare API Token",
  R2_ACCESS_KEY_ID: "R2 Access Key ID",
  R2_SECRET_ACCESS_KEY: "R2 Secret Access Key",
  R2_TOKEN_VALUE: "R2 Token Value",
  R2_JURISDICTION_END_POINT: "R2 Jurisdiction Endpoint",
};

const SECRET_FIELDS = [
  "CLOUDFLARE_API_TOKEN",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_TOKEN_VALUE",
];

export default function Config() {
  const { company, companies, select, refresh } = useCompanies();
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [apiKeyEnabled, setApiKeyEnabled] = useState(false);
  const [generatedKey, setGeneratedKey] = useState(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = async (name) => {
    if (!name) {
      setConfig(null);
      setDraft(null);
      return;
    }
    setLoading(true);
    setError(null);
    setGeneratedKey(null);
    try {
      const data = await api(`/cloudflare/config?company=${encodeURIComponent(name)}`);
      const cfg = data.config || {};
      // API returns sectioned config (GENERAL/MODELS/STORAGE/CREDENTIALS/AUTH);
      // flatten the value groups so fields can read draft[key] directly.
      const flat = {
        ...(cfg.GENERAL || {}),
        ...(cfg.MODELS || {}),
        ...(cfg.STORAGE || {}),
        ...(cfg.CREDENTIALS || {}),
      };
      setConfig(flat);
      setDraft(flat);
      setApiKeyEnabled(!!cfg.AUTH?.API_KEY_ENABLED);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const generateApiKey = async () => {
    if (!company) return;
    setApiKeyBusy(true);
    setError(null);
    try {
      const data = await api(`/cloudflare/companies/${encodeURIComponent(company)}/apikey`, { method: "POST" });
      setGeneratedKey(data.apiKey);
      setApiKeyEnabled(true);
      notify("API key generated — copy it now.");
    } catch (e) {
      setError(e.message);
    } finally {
      setApiKeyBusy(false);
    }
  };

  const revokeApiKey = async () => {
    if (!window.confirm(`Revoke '${company}'s API key? /ask and /ask-stream will become open for this company again.`)) return;
    setApiKeyBusy(true);
    setError(null);
    try {
      await api(`/cloudflare/companies/${encodeURIComponent(company)}/apikey`, { method: "DELETE" });
      setGeneratedKey(null);
      setApiKeyEnabled(false);
      notify("API key revoked.");
    } catch (e) {
      setError(e.message);
    } finally {
      setApiKeyBusy(false);
    }
  };

  const copyApiKey = async () => {
    try {
      await navigator.clipboard.writeText(generatedKey);
      notify("API key copied to clipboard.");
    } catch {
      notify("Could not copy — select the key manually.");
    }
  };

  useEffect(() => {
    load(company);
  }, [company]);

  const setKey = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key === "EMBEDDING_MODEL" && EMBEDDING_DIMENSIONS[value]) {
      setDraft((d) => ({ ...d, EMBEDDING_DIMENSIONS: EMBEDDING_DIMENSIONS[value] }));
    }
  };

  const save = async () => {
    if (!company) return;
    setSaving(true);
    setError(null);
    try {
      const changed = {};
      for (const key of Object.keys(draft)) {
        if (draft[key] !== config[key]) changed[key] = draft[key];
      }
      await api(`/cloudflare/companies/${encodeURIComponent(company)}`, {
        method: "PUT",
        body: changed,
      });
      await load(company);
      await refresh();
      notify("Configuration saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm(`Reset '${company}' to defaults?`)) return;
    setError(null);
    try {
      await api(`/cloudflare/companies/${encodeURIComponent(company)}/reset`, { method: "POST" });
      await load(company);
      await refresh();
      notify("Company reset to defaults.");
    } catch (e) {
      setError(e.message);
    }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  useHeaderActions(
    <div className="flex items-center justify-end gap-3">
      <Select
        value={company}
        onChange={(e) => select(e.target.value)}
        options={[
          { value: "", label: "Select a company…" },
          ...companies.map((c) => ({ value: c.name, label: c.COMPANY_NAME || c.name })),
        ]}
        className="w-64"
      />
      {company && (
        <>
          <Button variant="secondary" onClick={reset}>
            Reset
          </Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? <Spinner className="h-3.5 w-3.5" /> : "Save Changes"}
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

      {!company ? (
        <Card>
          <div className="py-10 text-center text-sm text-slate-500">
            Select a company to view and edit its configuration.
          </div>
        </Card>
      ) : loading || !draft ? (
        <Card>
          <div className="flex items-center justify-center py-10">
            <Spinner className="h-6 w-6" />
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card title="General" subtitle="Branding and company links used in the system prompt">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {GENERAL_KEYS.map((key) => (
                <Input
                  key={key}
                  label={GENERAL_LABELS[key]}
                  value={draft[key] ?? ""}
                  onChange={(e) => setKey(key, e.target.value)}
                />
              ))}
            </div>
          </Card>

          <Card title="AI Models" subtitle="Models used for retrieval, rewriting, generation, and reranking">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Select
                label={MODEL_LABELS.EMBEDDING_MODEL}
                value={draft.EMBEDDING_MODEL || ""}
                onChange={(e) => setKey("EMBEDDING_MODEL", e.target.value)}
                options={EMBEDDING_MODELS}
              />
              <Input
                label="Embedding Dimensions"
                type="number"
                value={draft.EMBEDDING_DIMENSIONS ?? ""}
                onChange={(e) => setKey("EMBEDDING_DIMENSIONS", Number(e.target.value))}
              />
              <Select
                label={MODEL_LABELS.LLM_MODEL}
                value={draft.LLM_MODEL || ""}
                onChange={(e) => setKey("LLM_MODEL", e.target.value)}
                options={LLM_MODELS}
              />
              <Select
                label={MODEL_LABELS.SMALL_LLM}
                value={draft.SMALL_LLM || ""}
                onChange={(e) => setKey("SMALL_LLM", e.target.value)}
                options={SMALL_LLMS}
              />
              <Select
                label={MODEL_LABELS.RERANKING_MODEL}
                value={draft.RERANKING_MODEL || ""}
                onChange={(e) => setKey("RERANKING_MODEL", e.target.value)}
                options={RERANKING_MODELS}
              />
            </div>
          </Card>

          <Card title="Storage" subtitle="Cloudflare resources backing this company">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {STORAGE_KEYS.map((key) => (
                <Input
                  key={key}
                  label={STORAGE_LABELS[key]}
                  value={draft[key] ?? ""}
                  onChange={(e) => setKey(key, e.target.value)}
                  placeholder="auto-created on first ingest"
                />
              ))}
            </div>
          </Card>

          <Card title="Cloudflare Credentials" subtitle="Stored in this company's SQLite database; no environment fallback">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {CREDENTIAL_KEYS.map((key) => (
                <Input
                  key={key}
                  type={SECRET_FIELDS.includes(key) ? "password" : "text"}
                  label={CREDENTIAL_LABELS[key]}
                  value={draft[key] ?? ""}
                  onChange={(e) => setKey(key, e.target.value)}
                  autoComplete="off"
                />
              ))}
            </div>
          </Card>

          <Card
            title="Ask API Key"
            subtitle="When enabled, POST /ask and /ask-stream require x-api-key and must originate from <company>.com or a subdomain"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={apiKeyEnabled ? "green" : "amber"}>{apiKeyEnabled ? "Enabled" : "Disabled"}</Badge>
              {generatedKey ? (
                <Input
                  readOnly
                  label="Generated API key"
                  value={generatedKey}
                  onFocus={(e) => e.target.select()}
                  className="w-96 font-mono text-xs"
                />
              ) : null}
              {apiKeyEnabled ? (
                <Button variant="danger" onClick={revokeApiKey} disabled={apiKeyBusy}>
                  {apiKeyBusy ? <Spinner className="h-3.5 w-3.5" /> : "Revoke"}
                </Button>
              ) : (
                <Button onClick={generateApiKey} disabled={apiKeyBusy}>
                  {apiKeyBusy ? <Spinner className="h-3.5 w-3.5" /> : "Generate API Key"}
                </Button>
              )}
              {generatedKey && (
                <Button variant="secondary" onClick={copyApiKey}>
                  Copy
                </Button>
              )}
            </div>
            {generatedKey && (
              <p className="mt-2 text-xs text-amber-300">Shown once — copy it now. Regenerating invalidates the previous key.</p>
            )}
          </Card>

          {dirty && (
            <div className="flex items-center justify-between rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
              <span>You have unsaved changes.</span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setDraft(config)}>
                  Discard
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving ? <Spinner className="h-3.5 w-3.5" /> : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Toast message={toast} />
    </div>
  );
}
