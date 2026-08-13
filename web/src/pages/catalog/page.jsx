// --------------------------
// CATALOG — Service Catalog page (default export).
// --------------------------
import { Fragment, useEffect, useRef, useState } from "react";
import {
  deleteEndpoint,
  deletePricing,
  deleteProvider,
  deleteProviderModel,
  getProvider,
  listPricing,
  listProviders,
} from "../../api";
import { Badge, Button, Card, Empty, IconButton, Spinner, Toast } from "../../components/ui";
import { usePoll } from "../../hooks";
import { useHeaderActions } from "../../components/Layout";
import { cx } from "../../util";
import {
  AI_CAPABILITY_KEYS,
  INFRASTRUCTURE_GROUPS,
  capabilityLabel,
  categoryTone,
  groupFor,
  isInfrastructure,
} from "./constants";
import { price, ymd } from "./utils";
import { PriceHistory, StatTile, OverviewItem } from "./components";
import { ProviderSwitcher } from "./switcher";
import { DeleteProviderModal, EndpointModal, ImportProviderModal, ModelModal, PricingModal } from "./modals";
import { ProviderWizardModal } from "./wizard";

export default function Catalog({ navigate, path }) {
  const key = (path || "").split("/")[1];
  const [providers, setProviders] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState("models");
  const [endpointModal, setEndpointModal] = useState(null); // null | {row?}
  const [pricingModal, setPricingModal] = useState(null); // null | {model, row?}
  const [modelModal, setModelModal] = useState(null); // null | {row?}
  const [providerOpen, setProviderOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // provider row awaiting edit
  const [importOpen, setImportOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [deleteTarget, setDeleteTarget] = useState(null); // provider row awaiting delete confirmation
  const [deleting, setDeleting] = useState(false);
  const [forceDelete, setForceDelete] = useState(false); // delete was refused → offer force pass
  const [history, setHistory] = useState({}); // modelId -> rows (undefined = loading)

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadProviders = async () => {
    setError(null);
    try {
      setProviders(await listProviders());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async () => {
    if (!key) {
      setDetail(null);
      return;
    }
    setError(null);
    try {
      setDetail(await getProvider(key));
    } catch (e) {
      setError(e.message);
      setDetail(null);
    }
  };

  usePoll(loadProviders, 30000, []);
  usePoll(loadDetail, 30000, [key]);

  const selected = providers.find((p) => p.providerKey === key);

  // Same soft style as the sidebar's "New Company" action, per the user's spec.
  const NewProviderButton = ({ className }) => (
    <button
      type="button"
      onClick={() => setProviderOpen(true)}
      className={cx(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-indigo-500/15 hover:text-indigo-200",
        className
      )}
    >
      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M12 5v14" />
      </svg>
      New Provider
    </button>
  );

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={loadProviders} disabled={loading}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
      <Button variant="secondary" onClick={() => setImportOpen(true)}>Import Provider</Button>
      <NewProviderButton />
    </div>
  );

  const saveEndpointDone = async () => {
    setEndpointModal(null);
    await loadDetail();
    notify(endpointModal?.row ? "Endpoint updated." : "Endpoint created.");
  };

  const removeEndpoint = async (row) => {
    if (!window.confirm(`Delete endpoint '${row.endpoint_key}'?`)) return;
    setError(null);
    try {
      await deleteEndpoint(row.id);
      await loadDetail();
      notify(`Endpoint '${row.endpoint_key}' deleted.`);
    } catch (e) {
      setError(e.message);
    }
  };

  // Fetch-sequence guard: every pricing fetch for a model bumps its sequence;
  // when a response lands it only writes if no newer fetch started in between.
  // This keeps the bulk load below from clobbering a just-saved edit's fresh
  // rows with pre-edit data (stale-response race).
  const pricingSeq = useRef({}); // modelId -> last fetch seq (global counter)
  const pricingSeqGlobal = useRef(0);
  const fetchPricing = async (modelId) => {
    const seq = ++pricingSeqGlobal.current;
    pricingSeq.current[modelId] = seq;
    const rows = await listPricing(modelId).catch(() => []);
    if (pricingSeq.current[modelId] !== seq) return null; // superseded
    return rows;
  };

  const reloadPricing = async (modelId) => {
    setHistory((h) => ({ ...h, [modelId]: undefined }));
    const rows = await fetchPricing(modelId);
    if (rows !== null) setHistory((h) => ({ ...h, [modelId]: rows }));
  };

  const savePricingDone = async () => {
    const modelId = pricingModal?.model?.id;
    setPricingModal(null);
    if (modelId) await reloadPricing(modelId);
    notify(pricingModal?.row ? "Price updated." : "Price created.");
  };

  // Inline pricing: when the Models tab is shown, load every model's price
  // rows up front so each model row can render them without a manual expand.
  // Keyed on the model-id set so 30s detail polls don't refetch the same set.
  // (detail?.models is used instead of the later-declared `models` alias.)
  const detailModelIds = (detail?.models || []).map((m) => m.id);
  const modelIdsKey = detailModelIds.join(",");
  useEffect(() => {
    if (tab !== "models" || !modelIdsKey) return;
    let cancelled = false;
    Promise.all(detailModelIds.map((id) => fetchPricing(id))).then((rows) => {
      if (cancelled) return;
      setHistory((h) => {
        const next = { ...h };
        detailModelIds.forEach((id, i) => {
          if (rows[i] !== null) next[id] = rows[i];
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [tab, modelIdsKey]);

  const saveModelDone = async (modelKey) => {
    const wasEdit = !!modelModal?.row;
    setModelModal(null);
    await loadDetail();
    notify(`Model '${modelKey}' ${wasEdit ? "updated" : "added"}.`);
  };

  const removeModel = async (m) => {
    if (!window.confirm(`Delete model '${m.model_key}'? Its pricing rows and any credential model-access grants are removed with it.`)) return;
    setError(null);
    try {
      await deleteProviderModel(key, m.id);
      await loadDetail();
      notify(`Model '${m.model_key}' deleted.`);
    } catch (e) {
      setError(e.message);
    }
  };

  const removePricing = async (row) => {
    if (!window.confirm(`Delete price for ${row.model_name} from ${ymd(row.effective_from)}?`)) return;
    setError(null);
    try {
      await deletePricing(row.id);
      const modelId = row.provider_model_id;
      setHistory((h) => ({ ...h, [modelId]: (h[modelId] || []).filter((r) => r.id !== row.id) }));
      await loadDetail();
      notify("Price deleted.");
    } catch (e) {
      setError(e.message);
    }
  };

  const createProviderDone = async (providerKey) => {
    setProviderOpen(false);
    await loadProviders();
    navigate(`catalog/${providerKey}`);
    notify(`Provider '${providerKey}' created.`);
  };

  // Open the edit modal with the FULL provider row. The list/card rows only
  // carry the lightweight shape (no URL fields) — sending those to the modal
  // would prefill the URL inputs empty and wipe them on save. The fetch result
  // is only applied if it still matches the requested key (a newer edit click
  // may have landed while this one was in flight).
  const openEdit = async (row) => {
    const key = row.providerKey || row.provider_key;
    const full = await getProvider(key).catch(() => null);
    setEditTarget((current) => {
      // First open (nothing set yet) or still editing the same provider → apply
      // the fetched row. A newer click on a different provider wins (stale
      // fetches are dropped by the key mismatch).
      const currentKey = current?.providerKey || current?.provider_key || null;
      if (currentKey === null || currentKey === key) return full || current || { ...row, providerKey: key };
      return current;
    });
  };

  const saveProviderEdit = async (providerKey) => {
    setEditTarget(null);
    await loadProviders();
    if (key === providerKey) await loadDetail(); // refresh the open detail view
    notify(`Provider '${providerKey}' updated.`);
  };

  const removeProvider = async (force = false) => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProvider(deleteTarget.providerKey, force);
      setForceDelete(false);
      await loadProviders();
      if (key === deleteTarget.providerKey) navigate("catalog");
      notify(`Provider '${deleteTarget.providerKey}' deleted.`);
      setDeleteTarget(null);
    } catch (e) {
      setError(e.message);
      if (/referenced|cannot be deleted/i.test(e.message)) setForceDelete(true);
    } finally {
      setDeleting(false);
    }
  };

  // ----- list view ---------------------------------------------------------
  if (!key) {
    const filtered = filter === "all" ? providers : providers.filter((p) => groupFor(p.category).id === filter);
    const activeGroup =
      filter === "all" ? null : filter === "infrastructure" ? { emoji: "🛠", label: "Infrastructure Providers" } : groupFor(filter);
    const otherCount = providers.filter((p) => groupFor(p.category).id === "other").length;
    const infraCount = providers.filter((p) => isInfrastructure(p.category)).length;

    // Type-aware card: AI providers show models/capabilities/pricing stats;
    // infrastructure providers show capability chips instead (no models to list).
    const providerCard = (p) => {
      const infra = isInfrastructure(p.category);
      const chips = (p.capabilityKeys || []).filter((k) => !AI_CAPABILITY_KEYS.has(k)).slice(0, 3);
      return (
        // A real <button> cannot contain the Edit/Delete buttons below (invalid
        // HTML — React warns about nested buttons), so this card is a
        // keyboard-accessible role="button" div instead.
        <div
          key={p.providerKey}
          role="button"
          tabIndex={0}
          aria-label={`Open ${p.providerName} details`}
          onClick={() => navigate(`catalog/${p.providerKey}`)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              navigate(`catalog/${p.providerKey}`);
            }
          }}
          className="group cursor-pointer text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-xl"
        >
          <Card className="hover:border-indigo-500/50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-100">{p.providerName}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{p.providerKey}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge tone={categoryTone(p.category)}>{groupFor(p.category).label}</Badge>
                <Badge>{p.authType}</Badge>
                <button
                  type="button"
                  title={`Edit ${p.providerKey}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(p);
                  }}
                  className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-indigo-500/15 hover:text-indigo-300"
                >
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  title={`Delete ${p.providerKey}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setForceDelete(false);
                    setDeleteTarget(p);
                  }}
                  className="ml-1 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                >
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>
            </div>
            {infra ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {chips.map((k) => (
                  <Badge key={k} tone="cyan">{capabilityLabel(k)}</Badge>
                ))}
                {chips.length === 0 && <span className="text-xs text-slate-500">Infrastructure provider</span>}
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                <Badge tone="slate">Models {p.models ?? 0}</Badge>
                <Badge tone="slate">Capabilities {p.capabilities ?? 0}</Badge>
                <Badge tone={p.hasPricing ? "green" : "slate"}>{p.hasPricing ? "Pricing" : "No pricing"}</Badge>
                <Badge tone="slate">Endpoints {p.endpoints ?? 0}</Badge>
              </div>
            )}
            <div className="mt-3 flex items-center border-t border-slate-800/70 pt-2.5">
              <span className="ml-auto text-xs font-medium text-slate-500 transition-colors group-hover:text-indigo-300">
                {infra ? "Configure →" : "View →"}
              </span>
            </div>
          </Card>
        </div>
      );
    };

    const sectionHeader = (g, count) => (
      <div className="flex items-center gap-2">
        <span className="text-sm leading-none">{g.emoji}</span>
        <h2 className="text-sm font-semibold text-slate-200">{g.label}</h2>
        {count !== undefined && <span className="text-xs text-slate-500">({count})</span>}
        <div className="h-px flex-1 bg-slate-800" />
      </div>
    );

    const groupGrid = (items) => (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{items.map(providerCard)}</div>
    );

    const tabBtn = (id, label) => (
      <button
        key={id}
        type="button"
        onClick={() => setFilter(id)}
        className={cx(
          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          filter === id
            ? "border-indigo-500 bg-indigo-500/15 text-indigo-200"
            : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
        )}
      >
        {label}
      </button>
    );

    const aiItems = providers.filter((p) => groupFor(p.category).id === "ai");

    return (
      <div className="space-y-6">
        {error && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
        )}
        {providers.length === 0 && !loading ? (
          <Card>
            <Empty message="No providers in the catalog. Create your first provider to get started." />
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {tabBtn("all", `All (${providers.length})`)}
              {tabBtn("ai", "AI")}
              {tabBtn("infrastructure", "Infrastructure")}
              {INFRASTRUCTURE_GROUPS.map((g) => tabBtn(g.id, g.short))}
              {otherCount > 0 && tabBtn("other", "Other")}
            </div>
            {filter === "all" ? (
              <div className="space-y-8">
                {aiItems.length > 0 && (
                  <section className="space-y-3">
                    {sectionHeader(groupFor("ai"), aiItems.length)}
                    {groupGrid(aiItems)}
                  </section>
                )}
                {infraCount > 0 && (
                  <section className="space-y-5">
                    <div className="flex items-center gap-2 pt-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Infrastructure Providers</span>
                      <span className="text-xs text-slate-500">({infraCount})</span>
                      <div className="h-px flex-1 bg-slate-800" />
                    </div>
                    {INFRASTRUCTURE_GROUPS.map((g) => {
                      const items = providers.filter((p) => groupFor(p.category).id === g.id);
                      if (items.length === 0) return null;
                      return (
                        <div key={g.id} className="space-y-3">
                          {sectionHeader(g, items.length)}
                          {groupGrid(items)}
                        </div>
                      );
                    })}
                    {otherCount > 0 && (
                      <div className="space-y-3">
                        {sectionHeader({ emoji: "📎", label: "Other" }, otherCount)}
                        {groupGrid(providers.filter((p) => groupFor(p.category).id === "other"))}
                      </div>
                    )}
                  </section>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {sectionHeader(activeGroup)}
                {filtered.length === 0 ? (
                  <Card>
                    <Empty message="No providers in this category yet." />
                  </Card>
                ) : (
                  groupGrid(filtered)
                )}
              </div>
            )}
          </>
        )}
        <ProviderWizardModal
          open={providerOpen}
          onClose={() => setProviderOpen(false)}
          onSaved={(providerKey, data) => createProviderDone(providerKey, data)}
        />
        <ProviderWizardModal
          open={editTarget !== null}
          provider={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={saveProviderEdit}
        />
        <DeleteProviderModal
          provider={deleteTarget}
          busy={deleting}
          force={forceDelete}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => removeProvider(forceDelete)}
        />
        <ImportProviderModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onSaved={(providerKey) => {
            setImportOpen(false);
            loadProviders();
            if (providerKey) navigate(`catalog/${providerKey}`);
          }}
        />
        <Toast message={toast} />
      </div>
    );
  }

  // ----- detail view -------------------------------------------------------
  const models = detail?.models || [];
  const endpoints = detail?.endpoints || [];
  const capabilities = detail?.capabilities || [];
  const resources = detail?.resourceTemplates || [];
  const authSchema = detail?.authForm || [];

  // Data-driven navigation — a tab only exists when its data exists. The UI
  // never assumes a provider has models, endpoints, capabilities, or resources;
  // every section is rendered from the catalog tables (provider_models,
  // provider_capabilities, provider_endpoints, provider_resource_types,
  // provider_auth_schemas).
  const tabs = [{ id: "overview", label: "Overview" }];
  // The Models tab is ALWAYS shown — its "Add Model" button is the only way to
  // add the FIRST model to a provider with zero models (the JSON importer is
  // bulk-only).
  tabs.push({ id: "models", label: `Models (${models.length})` });
  if (endpoints.length) tabs.push({ id: "endpoints", label: `Endpoints (${endpoints.length})` });
  if (capabilities.length) tabs.push({ id: "capabilities", label: `Capabilities (${capabilities.length})` });
  if (resources.length) tabs.push({ id: "resources", label: `Resources (${resources.length})` });
  if (authSchema.length) tabs.push({ id: "authentication", label: "Authentication" });
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "overview";

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" onClick={() => navigate("catalog")}>
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </Button>
        <div className="w-64">
          <ProviderSwitcher
            providers={providers}
            selected={key}
            onSelect={(k) => navigate(`catalog/${k}`)}
            onCreate={() => setProviderOpen(true)}
          />
        </div>
        <div className="flex items-center gap-2">
          {detail?.website_url && (
            <a href={detail.website_url} target="_blank" rel="noreferrer" className="text-xs text-slate-400 underline-offset-2 hover:text-indigo-300 hover:underline">
              Website
            </a>
          )}
          {detail?.documentation_url && (
            <a href={detail.documentation_url} target="_blank" rel="noreferrer" className="text-xs text-slate-400 underline-offset-2 hover:text-indigo-300 hover:underline">
              Docs
            </a>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-slate-50">{selected?.providerName || key}</h2>
        <Badge tone={categoryTone(selected?.category)}>{selected ? groupFor(selected.category).label : ""}</Badge>
        <Badge>{selected?.authType}</Badge>
        {detail?.is_active === false && <Badge tone="red">inactive</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => openEdit(detail || selected || { providerKey: key, providerName: key, category: "ai", authType: "bearer_token" })}>
            Edit Provider
          </Button>
          <Button variant="danger" onClick={() => { setForceDelete(false); setDeleteTarget(selected || { providerKey: key, providerName: key }); }}>Delete Provider</Button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx(
              "whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-medium transition-colors",
              activeTab === t.id ? "border-b-2 border-indigo-400 text-indigo-200" : "text-slate-400 hover:text-slate-100"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <Card title="Overview" subtitle={`${groupFor(selected?.category).label} provider · ${selected?.authType || ""} auth`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Models" value={models.length} />
            <StatTile label="Capabilities" value={capabilities.length} />
            <StatTile label="Endpoints" value={endpoints.length} />
            <StatTile label="Resources" value={resources.length} />
            <StatTile label="Auth fields" value={authSchema.length} />
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 border-t border-slate-800 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <OverviewItem term="Provider key" desc={key} mono />
            <OverviewItem term="Category" desc={groupFor(selected?.category).label} />
            <OverviewItem term="Auth type" desc={selected?.authType || "—"} />
            {detail?.default_api_base_url && <OverviewItem term="API base URL" desc={detail.default_api_base_url} mono />}
            {detail?.website_url && <OverviewItem term="Website" desc={detail.website_url} link={detail.website_url} />}
            {detail?.documentation_url && <OverviewItem term="Documentation" desc={detail.documentation_url} link={detail.documentation_url} />}
            <OverviewItem term="Status" desc={detail?.is_active === false ? "inactive" : "active"} />
          </dl>
          {endpoints.length === 0 && (
            <div className="mt-4 border-t border-slate-800 pt-4">
              <Button onClick={() => setEndpointModal({})}>Add Endpoint</Button>
              <p className="mt-2 text-xs text-slate-500">No endpoints yet — add one to expose this provider's API surface.</p>
            </div>
          )}
        </Card>
      )}

      {activeTab === "endpoints" && (
        <Card
          title="Endpoints"
          subtitle={`${endpoints.length} endpoints`}
          actions={<Button onClick={() => setEndpointModal({})}>Add Endpoint</Button>}
        >
          {endpoints.length === 0 ? (
            <Empty message="No endpoints yet. Add one to expose this provider's API surface." />
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-2 font-medium">Key</th>
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Method</th>
                    <th className="pb-2 font-medium">URL</th>
                    <th className="pb-2 font-medium">Timeout</th>
                    <th className="pb-2 font-medium">Flags</th>
                    <th className="pb-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {endpoints.map((e) => (
                    <tr key={e.id} className="text-slate-300 hover:bg-slate-800/40">
                      <td className="py-2.5 font-mono text-xs text-slate-200">{e.endpoint_key}</td>
                      <td className="py-2.5">{e.endpoint_name}</td>
                      <td className="py-2.5">
                        <Badge tone={e.http_method === "GET" ? "green" : "indigo"}>{e.http_method}</Badge>
                      </td>
                      <td className="max-w-[260px] py-2.5">
                        <span className="block truncate font-mono text-xs text-slate-400" title={e.endpoint_url}>
                          {e.endpoint_url}
                        </span>
                      </td>
                      <td className="py-2.5">{e.default_timeout_seconds}s</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          {e.is_default && <Badge tone="amber">default</Badge>}
                          <Badge tone={e.is_active ? "green" : "red"}>{e.is_active ? "active" : "off"}</Badge>
                        </div>
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton title={`Edit ${e.endpoint_key}`} onClick={() => setEndpointModal({ row: e })}>
                            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                            </svg>
                          </IconButton>
                          <IconButton title={`Delete ${e.endpoint_key}`} className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => removeEndpoint(e)}>
                            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            </svg>
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {activeTab === "models" && (
        <Card
          title="Models"
          subtitle={`${models.length} models`}
          actions={<Button onClick={() => setModelModal({})}>Add Model</Button>}
        >
          {models.length === 0 ? (
            <Empty message="No models registered for this provider yet." />
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-2 font-medium">Model</th>
                    <th className="pb-2 font-medium">Family</th>
                    <th className="pb-2 font-medium">Category</th>
                    <th className="pb-2 font-medium">Context / Output</th>
                    <th className="pb-2 font-medium">Features</th>
                    <th className="pb-2 font-medium">Current price</th>
                    <th className="pb-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {models.map((m) => (
                    <Fragment key={m.id}>
                      <tr className="text-slate-300 hover:bg-slate-800/40">
                        <td className="py-2.5 font-mono text-xs text-slate-200">{m.model_key}</td>
                        <td className="py-2.5 text-slate-400">{m.model_family || "—"}</td>
                        <td className="py-2.5">
                          <Badge tone={categoryTone(m.category)}>{m.category}</Badge>
                        </td>
                        <td className="py-2.5">
                          {m.max_context_window != null ? `${Number(m.max_context_window).toLocaleString()}` : "—"}
                          {m.max_output_tokens != null ? ` / ${Number(m.max_output_tokens).toLocaleString()}` : ""}
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-1">
                            {m.supports_streaming && <Badge tone="cyan">stream</Badge>}
                            {m.supports_function_calling && <Badge tone="indigo">tools</Badge>}
                            {m.supports_vision && <Badge tone="green">vision</Badge>}
                            {!m.supports_streaming && !m.supports_function_calling && !m.supports_vision && <span className="text-xs text-slate-600">—</span>}
                          </div>
                        </td>
                        <td className="py-2.5">
                          <span className="font-mono text-xs">
                            {price(m.input_price_per_million)} / {price(m.output_price_per_million)}
                          </span>
                          <span className="text-[10px] text-slate-500"> /M</span>
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <IconButton title={`Edit ${m.model_key}`} onClick={() => setModelModal({ row: m })}>
                              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              </svg>
                            </IconButton>
                            <IconButton title={`Delete ${m.model_key}`} className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => removeModel(m)}>
                              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              </svg>
                            </IconButton>
                          </div>
                        </td>
                      </tr>
                      <tr key={`${m.id}-prices`}>
                        <td colSpan={7} className="bg-slate-950/60 px-5 py-3">
                          <PriceHistory
                            model={m}
                            rows={history[m.id]}
                            loading={history[m.id] === undefined}
                            onAdd={() => setPricingModal({ model: m })}
                            onEdit={(row) => setPricingModal({ model: m, row })}
                            onDelete={removePricing}
                          />
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {activeTab === "capabilities" && (
        <Card title="Capabilities" subtitle={`${capabilities.length} capabilities`}>
          {capabilities.length === 0 ? (
            <Empty message="No capabilities registered." />
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-2 font-medium">Capability</th>
                    <th className="pb-2 font-medium">Supported</th>
                    <th className="pb-2 font-medium">Config</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {capabilities.map((c) => (
                    <tr key={c.capability_key} className="text-slate-300">
                      <td className="py-2.5 font-mono text-xs text-slate-200">{c.capability_key}</td>
                      <td className="py-2.5">
                        <Badge tone={c.is_supported ? "green" : "red"}>{c.is_supported ? "yes" : "no"}</Badge>
                      </td>
                      <td className="py-2.5">
                        {c.config ? (
                          <pre className="max-h-40 overflow-auto rounded-lg bg-slate-950 p-2 font-mono text-[11px] text-slate-400">
                            {JSON.stringify(c.config, null, 2)}
                          </pre>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {activeTab === "resources" && (
        <Card title="Resource Types" subtitle={`${resources.length} resource templates`}>
          {resources.length === 0 ? (
            <Empty message="No resource templates registered." />
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Provision endpoint</th>
                    <th className="pb-2 font-medium">Required</th>
                    <th className="pb-2 font-medium">Schema</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {resources.map((r) => (
                    <tr key={r.resource_type} className="text-slate-300">
                      <td className="py-2.5 font-mono text-xs text-slate-200">{r.resource_type}</td>
                      <td className="py-2.5">
                        <span className="font-medium text-slate-100">{r.display_name}</span>
                        {r.description && <p className="mt-0.5 max-w-xs text-xs text-slate-500">{r.description}</p>}
                      </td>
                      <td className="py-2.5">
                        {r.provision_endpoint_key ? <Badge tone="indigo">{r.provision_endpoint_key}</Badge> : "—"}
                      </td>
                      <td className="py-2.5">
                        <Badge tone={r.is_required ? "amber" : "slate"}>{r.is_required ? "required" : "optional"}</Badge>
                      </td>
                      <td className="py-2.5">
                        {r.config_schema ? (
                          <pre className="max-h-40 overflow-auto rounded-lg bg-slate-950 p-2 font-mono text-[11px] text-slate-400">
                            {JSON.stringify(r.config_schema, null, 2)}
                          </pre>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {activeTab === "authentication" && (
        <Card title="Authentication" subtitle={`${authSchema.length} credential fields, from the auth schema`}>
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2 font-medium">Field</th>
                  <th className="pb-2 font-medium">Label</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Group</th>
                  <th className="pb-2 font-medium">Required</th>
                  <th className="pb-2 font-medium">Encrypted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {authSchema.map((f) => (
                  <tr key={f.field_name} className="text-slate-300">
                    <td className="py-2.5 font-mono text-xs text-slate-200">{f.field_name}</td>
                    <td className="py-2.5">
                      <span className="font-medium text-slate-100">{f.field_label}</span>
                      {f.field_help_text && <p className="mt-0.5 max-w-xs text-xs text-slate-500">{f.field_help_text}</p>}
                    </td>
                    <td className="py-2.5"><Badge tone="slate">{f.field_type}</Badge></td>
                    <td className="py-2.5">{f.field_group || "—"}</td>
                    <td className="py-2.5"><Badge tone={f.is_required ? "amber" : "slate"}>{f.is_required ? "required" : "optional"}</Badge></td>
                    <td className="py-2.5"><Badge tone={f.is_encrypted ? "green" : "slate"}>{f.is_encrypted ? "encrypted" : "plain"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <EndpointModal
        open={endpointModal !== null}
        row={endpointModal?.row}
        providerKey={key}
        onClose={() => setEndpointModal(null)}
        onSaved={saveEndpointDone}
      />
      <ModelModal
        open={modelModal !== null}
        row={modelModal?.row}
        providerKey={key}
        onClose={() => setModelModal(null)}
        onSaved={saveModelDone}
      />
      <PricingModal
        open={pricingModal !== null}
        row={pricingModal?.row}
        model={pricingModal?.model}
        onClose={() => setPricingModal(null)}
        onSaved={savePricingDone}
      />
      <ProviderWizardModal
        open={providerOpen}
        onClose={() => setProviderOpen(false)}
        onSaved={(providerKey, data) => createProviderDone(providerKey, data)}
      />
      <ProviderWizardModal
        open={editTarget !== null}
        provider={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={saveProviderEdit}
      />
      <ImportProviderModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSaved={(providerKey) => {
          setImportOpen(false);
          loadProviders();
          if (providerKey) navigate(`catalog/${providerKey}`);
        }}
      />
      <DeleteProviderModal
        provider={deleteTarget}
        busy={deleting}
        force={forceDelete}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => removeProvider(forceDelete)}
      />
      <Toast message={toast} />
    </div>
  );
}
