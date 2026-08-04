import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, Button, Input, Select, Badge, Spinner } from "../components/ui";
import { useCompanies } from "../context";
import {
  EMBEDDING_MODELS,
  LLM_MODELS,
  SMALL_LLMS,
  RERANKING_MODELS,
  EMBEDDING_DIMENSIONS,
  GENERAL_KEYS,
  STORAGE_KEYS,
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

export default function Config() {
  const { company, companies, select, refresh } = useCompanies();
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

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
    try {
      const data = await api(`/cloudflare/config?company=${encodeURIComponent(name)}`);
      setConfig(data.config);
      setDraft(data.config);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
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
    if (!window.confirm(`Reset '${company}' to environment defaults?`)) return;
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

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">Company Config</h1>
          <p className="text-sm text-slate-400 mt-1">Hot-reloadable runtime configuration per tenant</p>
        </div>
        <div className="flex items-center gap-3">
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
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
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

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-200 shadow-xl">
          {toast}
        </div>
      )}

      {company && config && (
        <div className="fixed bottom-4 left-64">
          <Badge tone="slate">
            {config.COMPANY_NAME} · {config.LLM_MODEL}
          </Badge>
        </div>
      )}
    </div>
  );
}
