import { useEffect, useState } from "react";
import { api, listProviders, getProvider, getKbOptions } from "../api";
import { Card, Button, Input, Select, Spinner, Badge, Toast } from "../components/ui";
import { useCompanies } from "../context";
import { useHeaderActions } from "../components/Layout";
import { GENERAL_KEYS, EMBEDDING_DIMENSIONS } from "../models";

const GENERAL_LABELS = {
  BASE_URL: "Base Website",
  CONTACT_US_URL: "Contact Us URL",
  LOCATIONS_URL: "Locations URL",
  SERVICES_URL: "Services URL",
  CONSULTANT_NAME: "Consultant Name",
  COMPANY_NAME: "Company Display Name",
};

export default function Config() {
  const { company, refresh } = useCompanies();
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [apiKeyEnabled, setApiKeyEnabled] = useState(false);
  const [generatedKey, setGeneratedKey] = useState(null);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  // Gateway provider catalog — drives the Models & Provider card dropdowns.
  const [providers, setProviders] = useState([]);
  const [catalogModels, setCatalogModels] = useState([]);
  const [catalogNote, setCatalogNote] = useState(null);
  const [catalogReload, setCatalogReload] = useState(0);
  // Company resource catalog (provider_resources rows) — vector index + R2 bucket selectors.
  const [vectorResources, setVectorResources] = useState([]);
  const [storageResources, setStorageResources] = useState([]);
  const [resourcesNote, setResourcesNote] = useState(null);

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

  // Provider catalog is global — load on mount, retry via the note's button.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const rows = await listProviders();
        if (live) {
          setProviders(rows);
          setCatalogNote(null);
        }
      } catch {
        if (live) setCatalogNote("Provider catalog unavailable — model dropdowns may be empty.");
      }
    })();
    return () => {
      live = false;
    };
  }, [catalogReload]);

  // Load the company's gateway resources (vector_index + object_bucket) so the
  // STORAGE keys can be picked from the catalog instead of typed by hand.
  useEffect(() => {
    if (!company) {
      setVectorResources([]);
      setStorageResources([]);
      return;
    }
    let live = true;
    (async () => {
      try {
        const opts = await getKbOptions(company);
        if (live) {
          setVectorResources(opts?.vectorResources || []);
          setStorageResources(opts?.storageResources || []);
          setResourcesNote(null);
        }
      } catch {
        if (live) {
          setVectorResources([]);
          setStorageResources([]);
          setResourcesNote("Resource catalog unavailable — vector/storage lists may be empty.");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [company]);

  // When the selected provider changes, load its catalog models.
  useEffect(() => {
    const providerKey = draft?.AI_PROVIDER;
    if (!providerKey) {
      setCatalogModels([]);
      return;
    }
    let live = true;
    (async () => {
      setCatalogNote(null);
      try {
        const provider = await getProvider(providerKey);
        if (live) setCatalogModels(provider?.models || []);
      } catch {
        if (live) {
          setCatalogModels([]);
          setCatalogNote(`Could not load models for provider '${providerKey}'.`);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [draft?.AI_PROVIDER]);

  const setKey = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
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

  // Provider select options: catalog providers + the current value if unknown.
  const providerOptions = () => {
    const opts = [{ value: "", label: "— Select provider —" }];
    const current = draft?.AI_PROVIDER;
    const known = new Set(providers.map((p) => p.providerKey));
    if (current && !known.has(current)) opts.push({ value: current, label: current });
    for (const p of providers) opts.push({ value: p.providerKey, label: p.providerName });
    return opts;
  };

  // Model select options for a catalog category, always including the current
  // stored value (a company may hold a model the catalog doesn't list).
  const modelOptions = (category, current) => {
    const list = catalogModels.filter((m) => m.category === category);
    const seen = new Set(list.map((m) => m.model_key));
    if (current && !seen.has(current)) list.unshift({ model_key: current, model_name: current });
    const opts = [{ value: "", label: "— Select model —" }];
    for (const m of list) {
      opts.push({ value: m.model_key, label: m.model_name ? `${m.model_name} (${m.model_key})` : m.model_key });
    }
    return opts;
  };

  // Select options for a company resource list (vector index / R2 bucket): the
  // catalog rows plus the current stored value when it isn't in the catalog.
  const resourceOptions = (resources, current) => {
    const seen = new Set(resources.map((r) => r.resource_key));
    const opts = [{ value: "", label: "— Use company default —" }];
    for (const r of resources) {
      const label = r.resource_name ? `${r.resource_name} (${r.resource_key})` : r.resource_key;
      opts.push({ value: r.resource_key, label });
    }
    if (current && !seen.has(current)) {
      opts.unshift({ value: current, label: `${current} (not in catalog)` });
    }
    return opts;
  };

  // Only @cf/ models are runtime-callable today (Workers AI adapter).
  const hasNonCfModel = [draft?.LLM_MODEL, draft?.SMALL_LLM, draft?.EMBEDDING_MODEL, draft?.RERANKING_MODEL].some(
    (m) => m && !m.startsWith("@cf/")
  );
  // The saved provider may not exist in the catalog (e.g. default 'cloudflare').
  const providerKnown = draft?.AI_PROVIDER && providers.some((p) => p.providerKey === draft.AI_PROVIDER);
  // EMBEDDING_DIMENSIONS only auto-follows models in the built-in map.
  const embeddingUnknownDims = draft?.EMBEDDING_MODEL && !EMBEDDING_DIMENSIONS[draft.EMBEDDING_MODEL];

  useHeaderActions(
    <div className="flex items-center justify-end gap-3">
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

          <Card
            title="Models & Provider"
            subtitle="AI provider and its models, selected from the gateway catalog"
          >
            <div className="space-y-4">
              <div className="max-w-sm">
                <Select
                  label="Provider"
                  options={providerOptions()}
                  value={draft.AI_PROVIDER ?? ""}
                  onChange={(e) => setKey("AI_PROVIDER", e.target.value)}
                />
                {draft?.AI_PROVIDER && !providerKnown && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Provider '{draft.AI_PROVIDER}' isn't in the catalog — its models aren't available here. Add it via the
                    Catalog page.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Select
                  label="Vector Index"
                  options={resourceOptions(vectorResources, draft.VECTOR_INDEX ?? "")}
                  value={draft.VECTOR_INDEX ?? ""}
                  onChange={(e) => setKey("VECTOR_INDEX", e.target.value)}
                />
                <Select
                  label="Storage (R2) Bucket"
                  options={resourceOptions(storageResources, draft.R2_BUCKET_NAME ?? "")}
                  value={draft.R2_BUCKET_NAME ?? ""}
                  onChange={(e) => setKey("R2_BUCKET_NAME", e.target.value)}
                />
                <Select
                  label="AI Model (large)"
                  options={modelOptions("chat", draft.LLM_MODEL ?? "")}
                  value={draft.LLM_MODEL ?? ""}
                  onChange={(e) => setKey("LLM_MODEL", e.target.value)}
                />
                <Select
                  label="AI Model (small — query rewriting)"
                  options={modelOptions("chat", draft.SMALL_LLM ?? "")}
                  value={draft.SMALL_LLM ?? ""}
                  onChange={(e) => setKey("SMALL_LLM", e.target.value)}
                />
                <Select
                  label="Embedding Model"
                  options={modelOptions("embedding", draft.EMBEDDING_MODEL ?? "")}
                  value={draft.EMBEDDING_MODEL ?? ""}
                  onChange={(e) => setKey("EMBEDDING_MODEL", e.target.value)}
                />
                <Select
                  label="Reranking Model"
                  options={modelOptions("reranker", draft.RERANKING_MODEL ?? "")}
                  value={draft.RERANKING_MODEL ?? ""}
                  onChange={(e) => setKey("RERANKING_MODEL", e.target.value)}
                />
              </div>
              {resourcesNote && <p className="text-xs text-amber-300">{resourcesNote}</p>}
              {catalogNote && (
                <p className="flex items-center gap-2 text-xs text-amber-300">
                  <span>{catalogNote}</span>
                  <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => setCatalogReload((n) => n + 1)}>
                    Retry
                  </Button>
                </p>
              )}
              {hasNonCfModel && (
                <p className="text-xs text-amber-300">
                  Note: non-Cloudflare models are stored and validated, but the runtime can only execute @cf/ models
                  today — asks/ingest will fail until a provider adapter ships.
                </p>
              )}
              {embeddingUnknownDims && (
                <p className="text-xs text-slate-500">
                  EMBEDDING_DIMENSIONS isn't auto-set for this embedding model (only known @cf/ embeddings are mapped) —
                  it keeps its current value.
                </p>
              )}
              <p className="text-xs text-slate-500">
                Vector Index and Storage (R2) Bucket come from the company's provisioned gateway resources — "Use company
                default" keeps the value from the company config. "AI Model (large)" and "AI Model (small)" both list the
                provider's chat models — pick the lighter/faster one for query rewriting.
              </p>
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
