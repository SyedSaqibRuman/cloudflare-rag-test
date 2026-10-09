import { useEffect, useState } from "react";
import { api, listProviders, getProvider, getKbOptions, listCredentials, listAssistants } from "../api";
import AskApiKeyCard from "./config/AskApiKeyCard.jsx";
import BlockedPatternsCard from "./config/BlockedPatternsCard.jsx";
import ChatPlaygroundCard from "./config/ChatPlaygroundCard.jsx";
import SystemPromptCard from "./config/SystemPromptCard.jsx";
import { Card, Button, Input, Select, Spinner, SkeletonCard, Tabs, TabPanel } from "../components/ui";
import { useCompanies } from "../context";
import { useHeaderActions } from "../components/Layout";
import { useToast } from "../hooks";
import { GENERAL_KEYS, EMBEDDING_DIMENSIONS } from "../models";

const GENERAL_LABELS = {
  BASE_URL: "Base Website",
  CONTACT_US_URL: "Contact Us URL",
  LOCATIONS_URL: "Locations URL",
  SERVICES_URL: "Services URL",
  COMPANY_NAME: "Company Display Name",
};

// CONSULTANT_NAME is removed from the UI — the assistant's name + system
// prompt now serve the same purpose. The key stays in the backend schema
// for backward compat (Dashboard, Companies tables still display it).

export default function Config() {
  const { company, refresh } = useCompanies();
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { notify } = useToast();
  // Initial enabled flag from the fetched AUTH section — the Ask API Key card
  // owns everything else about the key lifecycle.
  const [apiKeyInitial, setApiKeyInitial] = useState(false);
  // Gateway provider catalog — drives the Models & Provider card dropdowns.
  const [providers, setProviders] = useState([]);
  const [catalogModels, setCatalogModels] = useState([]);
  const [catalogNote, setCatalogNote] = useState(null);
  const [catalogReload, setCatalogReload] = useState(0);
  // Provider keys this company has an ACTIVE connection for — the provider
  // dropdown only lists AI providers the company actually configured.
  const [configuredProviders, setConfiguredProviders] = useState(new Set());
  // Company resource catalog (provider_resources rows) — vector index + R2
  // bucket + graph DB selectors.
  const [vectorResources, setVectorResources] = useState([]);
  const [storageResources, setStorageResources] = useState([]);
  const [graphResources, setGraphResources] = useState([]);
  const [resourcesNote, setResourcesNote] = useState(null);
  // Company's gateway assistants — the selected one drives the ask API.
  const [assistants, setAssistants] = useState([]);
  const [assistantsNote, setAssistantsNote] = useState(null);
  const [activeTab, setActiveTab] = useState("general");

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
      const cfg = data.config || {};
      // API returns sectioned config (GENERAL/MODELS/STORAGE/CREDENTIALS/AUTH);
      // flatten the value groups so fields can read draft[key] directly.
      const flat = {
        ...(cfg.GENERAL || {}),
        ...(cfg.MODELS || {}),
        ...(cfg.STORAGE || {}),
        ...(cfg.ASSISTANT || {}),
        ...(cfg.CREDENTIALS || {}),
      };
      setConfig(flat);
      setDraft(flat);
      setApiKeyInitial(!!cfg.AUTH?.API_KEY_ENABLED);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
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
        const result = await listProviders({ perPage: 500 });
        if (live) {
          setProviders(result.items ?? result);
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

  // Which providers does this company actually use? The dropdown only shows AI
  // providers with at least one active connection (listCredentials defaults to
  // active-only), so "configured" = saved + enabled.
  useEffect(() => {
    if (!company) {
      setConfiguredProviders(new Set());
      return;
    }
    let live = true;
    (async () => {
      try {
        const creds = await listCredentials(company);
        if (live) setConfiguredProviders(new Set(creds.map((c) => c.provider_key)));
      } catch {
        if (live) setConfiguredProviders(new Set());
      }
    })();
    return () => {
      live = false;
    };
  }, [company]);

  // Load the company's resources for the STORAGE key selectors: the live
  // Cloudflare account resources first (real Vectorize indexes / R2 buckets,
  // from the same source as the provider page cards), then registry-provisioned
  // rows as a fallback for anything not on the account.
  useEffect(() => {
    if (!company) {
      setVectorResources([]);
      setStorageResources([]);
      setGraphResources([]);
      return;
    }
    let live = true;
    (async () => {
      try {
        const opts = await getKbOptions(company);
        if (live) {
          setVectorResources(mergeResources(opts?.liveVectorResources || [], opts?.vectorResources || []));
          setStorageResources(mergeResources(opts?.liveStorageResources || [], opts?.storageResources || []));
          setGraphResources(opts?.graphResources || []);
          setResourcesNote(null);
        }
      } catch {
        if (live) {
          setVectorResources([]);
          setStorageResources([]);
          setGraphResources([]);
          setResourcesNote("Resource catalog unavailable — vector/storage lists may be empty.");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [company]);

  // Company's gateway assistants — the Config selection is saved as
  // ASSISTANT_KEY and the ask pipeline uses that assistant's persona.
  useEffect(() => {
    if (!company) {
      setAssistants([]);
      return;
    }
    let live = true;
    (async () => {
      try {
        const result = await listAssistants(company);
        if (live) {
          setAssistants(result.items ?? result ?? []);
          setAssistantsNote(null);
        }
      } catch {
        if (live) {
          setAssistants([]);
          setAssistantsNote("Could not load assistants — the ask API will use the company defaults.");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [company]);

  // Live Cloudflare rows ({ id, name, … }) → the { resource_key, resource_name }
  // shape the selectors expect, deduped against the registry rows by name.
  const mergeResources = (live, registry) => {
    const seen = new Set(registry.map((r) => r.resource_key));
    const liveRows = live
      .filter((r) => r.name && !seen.has(r.name))
      .map((r) => ({ resource_key: r.name, resource_name: r.name, live: true }));
    return [...liveRows, ...registry];
  };

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
        toast: false, // page notify()s its own phrasing
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
      await api(`/cloudflare/companies/${encodeURIComponent(company)}/reset`, { method: "POST", toast: false });
      await load(company);
      await refresh();
      notify("Company reset to defaults.");
    } catch (e) {
      setError(e.message);
    }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  // Provider select options: ONLY AI-category providers this company has an
  // active connection for (configured). The saved value always stays in the
  // list even if it's missing/filtered out, so nothing is silently dropped.
  const providerOptions = () => {
    const opts = [{ value: "", label: "— Select provider —" }];
    const current = draft?.AI_PROVIDER;
    const list = providers.filter((p) => p.category === "ai" && configuredProviders.has(p.providerKey));
    const known = new Set(list.map((p) => p.providerKey));
    if (current && !known.has(current)) opts.push({ value: current, label: current });
    for (const p of list) opts.push({ value: p.providerKey, label: p.providerName });
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

  // Select options for a company resource list (vector index / R2 bucket / any
  // provider): the catalog rows plus the current stored value when it isn't in
  // the catalog. Labels carry the owning provider so resources from different
  // providers are distinguishable (e.g. Pinecone vs Cloudflare Vectorize).
  const resourceOptions = (resources, current) => {
    const seen = new Set(resources.map((r) => r.resource_key));
    const opts = [{ value: "", label: "— Use company default —" }];
    for (const r of resources) {
      const provider = r.provider_name ? ` · ${r.provider_name}` : r.live ? " · Cloudflare (live)" : "";
      const label = r.resource_name ? `${r.resource_name} (${r.resource_key})${provider}` : `${r.resource_key}${provider}`;
      opts.push({ value: r.resource_key, label });
    }
    if (current && !seen.has(current)) {
      opts.unshift({ value: current, label: `${current} (not in catalog)` });
    }
    return opts;
  };

  // Graph DB (Neo4j) options — the pipeline reads NEO4J_DATABASE, so the select
  // value is the resource's config.database_name (falls back to resource_key).
  const graphResourceOptions = (resources, current) => {
    const seen = new Set();
    const opts = [{ value: "", label: "— No graph database —" }];
    for (const r of resources) {
      const db = r.config?.database_name || r.resource_key;
      seen.add(db);
      const provider = r.provider_name ? ` · ${r.provider_name}` : "";
      const label = r.resource_name ? `${r.resource_name} (${db})${provider}` : `${db}${provider}`;
      opts.push({ value: db, label });
    }
    if (current && !seen.has(current)) {
      opts.unshift({ value: current, label: `${current} (not in catalog)` });
    }
    return opts;
  };

  // Assistant select options — the selected assistant drives the ask API's
  // persona (system prompt / model / KB / graph).
  const assistantOptions = () => {
    const opts = [{ value: "", label: "— No assistant (company defaults) —" }];
    for (const a of assistants) {
      opts.push({
        value: a.assistant_key,
        label: a.assistant_name ? `${a.assistant_name} (${a.assistant_key})` : a.assistant_key,
      });
    }
    return opts;
  };

  // Only @cf/ models are runtime-callable today (Workers AI adapter).
  const hasNonCfModel = [draft?.LLM_MODEL, draft?.SMALL_LLM, draft?.EMBEDDING_MODEL, draft?.RERANKING_MODEL].some(
    (m) => m && !m.startsWith("@cf/")
  );
  // The saved provider may not exist in the catalog (e.g. default 'cloudflare'),
  // or may exist but have no active connection — the dropdown note below
  // distinguishes the two so the admin knows how to fix it.
  const providerRow = providers.find((p) => p.providerKey === draft?.AI_PROVIDER);
  const providerInCatalog = !!providerRow;
  const providerIsAi = providerRow?.category === "ai";
  const providerConfigured = providerIsAi && configuredProviders.has(draft.AI_PROVIDER);
  // EMBEDDING_DIMENSIONS only auto-follows models in the built-in map.
  const embeddingUnknownDims = draft?.EMBEDDING_MODEL && !EMBEDDING_DIMENSIONS[draft.EMBEDDING_MODEL];

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      {company && (
        <>
          <Button variant="secondary" onClick={reset}>
            Reset
          </Button>
          <Button onClick={save} disabled={!dirty || saving} className="whitespace-nowrap">
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
          <SkeletonCard rows={4} />
        </Card>
      ) : (
        <div className="space-y-6">
          <Tabs
            tabs={[
              { id: "general", label: "General" },
              { id: "models", label: "Models" },
              { id: "prompt", label: "Prompt" },
              { id: "playground", label: "Playground" },
              { id: "security", label: "Security" },
            ]}
            active={activeTab}
            onChange={setActiveTab}
          >
          <TabPanel id="general" active={activeTab}>
          <Card title="General" subtitle="Branding and company links used in the system prompt">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {GENERAL_KEYS.filter((k) => k !== "CONSULTANT_NAME").map((key) => (
                <Input
                  key={key}
                  label={GENERAL_LABELS[key]}
                  value={draft[key] ?? ""}
                  onChange={(e) => setKey(key, e.target.value)}
                />
              ))}
            </div>
          </Card>
          </TabPanel>

          <TabPanel id="models" active={activeTab}>
          <Card
            title="Models & Provider"
            subtitle="AI provider and its models, selected from the gateway catalog"
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Select
                    label="Provider"
                    options={providerOptions()}
                    value={draft.AI_PROVIDER ?? ""}
                    onChange={(e) => setKey("AI_PROVIDER", e.target.value)}
                  />
                  {draft?.AI_PROVIDER && !providerConfigured && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      {!providerInCatalog
                        ? `Provider '${draft.AI_PROVIDER}' isn't in the catalog — its models aren't available here. Add it via the Catalog page.`
                        : !providerIsAi
                          ? `Provider '${draft.AI_PROVIDER}' isn't an AI provider — only AI providers are listed here. Pick one from the dropdown.`
                          : `Provider '${draft.AI_PROVIDER}' has no active connection for this company — add one on the Providers page to use its models here.`}
                    </p>
                  )}
                </div>
                <div>
                  <Select
                    label="Assistant"
                    options={assistantOptions()}
                    value={draft.ASSISTANT_KEY ?? ""}
                    onChange={(e) => setKey("ASSISTANT_KEY", e.target.value)}
                  />
                  {assistantsNote && <p className="mt-1.5 text-xs text-amber-300">{assistantsNote}</p>}
                  {draft?.ASSISTANT_KEY && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      The ask API will use this assistant's system prompt, model, knowledge bases and graph settings
                      instead of the company defaults below.
                    </p>
                  )}
                </div>
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
                  label="Graph Database (Neo4j)"
                  options={graphResourceOptions(graphResources, draft.NEO4J_DATABASE ?? "")}
                  value={draft.NEO4J_DATABASE ?? ""}
                  onChange={(e) => setKey("NEO4J_DATABASE", e.target.value)}
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
                Vector Index, Storage (R2) Bucket and Graph Database (Neo4j) come from the company's provisioned gateway
                resources across every provider (Pinecone, Weaviate, S3, …) plus the live Cloudflare account — "Use company
                default"/"No graph database" keeps the stored value. "AI Model (large)" and "AI Model (small)" both list the
                provider's chat models — pick the lighter/faster one for query rewriting. When an Assistant is selected it
                overrides the system prompt, model, KBs and graph database; GraphRAG runs only when the assistant has graph
                context enabled and a Neo4j connection is configured.
              </p>
            </div>
          </Card>
          </TabPanel>

          <TabPanel id="playground" active={activeTab}>
          <div className="space-y-6">
          <ChatPlaygroundCard
            company={company}
            aiProvider={draft?.AI_PROVIDER || ""}
            llmModel={draft?.LLM_MODEL}
            options={modelOptions("chat", draft?.LLM_MODEL ?? "")}
          />
          </div>
          </TabPanel>

          <TabPanel id="prompt" active={activeTab}>
          <div className="space-y-6">
          <SystemPromptCard company={company} onError={setError} notify={notify} />
          </div>
          </TabPanel>

          <TabPanel id="security" active={activeTab}>
          <div className="space-y-6">
          <AskApiKeyCard
            company={company}
            initialEnabled={apiKeyInitial}
            onError={setError}
            notify={notify}
          />
          <BlockedPatternsCard company={company} onError={setError} notify={notify} />
          </div>
          </TabPanel>

          </Tabs>

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

      {/* toast rendering: global <ToastViewport /> in App.jsx */}
    </div>
  );
}
