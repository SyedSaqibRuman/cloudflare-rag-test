// --------------------------
// CATALOG — ModelsCard (9Router "Available Models" equivalent).
// Self-contained card for the provider detail page: the provider's catalog
// models rendered as a grid of model cards (key + copy button, display name,
// thinking-mode badge) with per-model Test / Edit / Delete. The card header
// carries the 9Router controls: a "Thinking" dropdown (auto/on/off — applied
// to every catalog model of the provider) and "Disable All" (bulk-flips the
// model-access grants of the selected company's credentials for this provider
// through /gateway/credentials/model-access/bulk).
// --------------------------
import { useCallback, useEffect, useState } from "react";
import {
  bulkSetModelAccess,
  deleteAllProviderModels,
  deleteProviderModel,
  executeChat,
  fetchProviderModels,
  listCredentialModels,
  listCredentials,
  listProviderModels,
  pruneDeadModels,
  testProviderModels,
  updateProviderModel,
} from "../../api";
import { Badge, Button, Card, Empty, IconButton, Spinner, SkeletonText } from "../../components/ui";
import { categoryTone } from "./constants";
import { ModelModal } from "./modals";

const THINKING_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

function thinkingBadge(mode) {
  if (!mode || mode === "auto") return null;
  return <Badge tone={mode === "on" ? "indigo" : "slate"}>{mode === "on" ? "thinking" : "no thinking"}</Badge>;
}

async function copyText(text, notify) {
  try {
    await navigator.clipboard.writeText(text);
    notify(`Copied '${text}' to clipboard.`);
  } catch {
    notify("Clipboard unavailable in this browser.", "red");
  }
}

export function ModelsCard({ providerKey, companyKey, notify }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modelModal, setModelModal] = useState(null); // null | { row? }
  const [testState, setTestState] = useState({}); // modelId -> { ok, latencyMs?, error? } | "busy"
  // Batch "Test All" sweep — per-model results keyed by model id, a running
  // progress counter, and the last run's summary/free-model list.
  const [batchState, setBatchState] = useState({ busy: false, done: 0, total: 0, results: null, summary: null });
  // "Prune dead models" — dry-run preview data + confirm flow.
  const [prunePreview, setPrunePreview] = useState(null); // null | { prune, keep, okCount, summary }
  const [pruneBusy, setPruneBusy] = useState(false);
  const [thinkingBusy, setThinkingBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Enabled model-access grants across the company's credentials for this
  // provider — powers Disable All (off → on when nothing is enabled).
  const [enabledGrants, setEnabledGrants] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setModels(await listProviderModels(providerKey));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [providerKey]);

  // Grant census: for every credential of the company on this provider, sum
  // the enabled model-access rows (9Router's "N models enabled" state).
  const loadGrants = useCallback(async () => {
    if (!companyKey) {
      setEnabledGrants(0);
      return;
    }
    try {
      const creds = (await listCredentials(companyKey, true)).filter(
        (c) => c.provider_key === providerKey
      );
      const grants = await Promise.all(creds.map((c) => listCredentialModels(c.id).catch(() => [])));
      setEnabledGrants(grants.flat().filter((g) => g.is_enabled).length);
    } catch {
      setEnabledGrants(0);
    }
  }, [companyKey, providerKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadGrants();
  }, [loadGrants]);

  const saveModelDone = async (modelKey) => {
    const wasEdit = !!modelModal?.row;
    setModelModal(null);
    await load();
    notify(`Model '${modelKey}' ${wasEdit ? "updated" : "added"}.`);
  };

  const removeModel = async (m) => {
    if (!window.confirm(`Delete model '${m.model_key}'? Its pricing rows and any credential model-access grants are removed with it.`)) return;
    setError(null);
    try {
      await deleteProviderModel(providerKey, m.id);
      await load();
      notify(`Model '${m.model_key}' deleted.`);
    } catch (e) {
      setError(e.message);
    }
  };

  // Live model test — 9Router's per-model "Test" runs one chat completion
  // through the provider. Requires the selected company to have a credential
  // for this provider; executor failures surface the upstream message.
  const testModel = async (m) => {
    if (!companyKey) {
      notify("Select a company first — the model test runs through its credential.", "red");
      return;
    }
    if (testState[m.id] === "busy") return;
    setTestState((s) => ({ ...s, [m.id]: "busy" }));
    try {
      const r = await executeChat(companyKey, {
        providerKey,
        model: m.model_key,
        messages: [{ role: "user", content: "ping" }],
      });
      setTestState((s) => ({ ...s, [m.id]: { ok: true, latencyMs: r.latencyMs ?? null } }));
      notify(`Model '${m.model_key}' responded${r.latencyMs != null ? ` in ${r.latencyMs}ms` : ""}.`);
    } catch (e) {
      setTestState((s) => ({ ...s, [m.id]: { ok: false, error: e.message } }));
      notify(`Model test failed: ${e.message}`, "red");
    }
  };

  // Batch "Test All": one chat ping against every catalog chat model through
  // the company's credential (server runs a bounded worker pool with a
  // per-model timeout). Surfaces dead models (404 "Function not found"-style),
  // capacity-blocked ones, and tags free-tier models that actually respond.
  const testAllModels = async () => {
    if (!companyKey) {
      notify("Select a company first — the model sweep runs through its credential.", "red");
      return;
    }
    const chatModels = models.filter((m) => m.category === "chat");
    if (!chatModels.length || batchState.busy) return;
    setBatchState({ busy: true, done: 0, total: chatModels.length, results: null, summary: null });
    setError(null);
    try {
      const r = await testProviderModels(companyKey, {
        providerKey,
        category: "chat",
        modelIds: chatModels.map((m) => m.id),
      });
      // Paint per-model verdicts onto the cards (same shape single Test uses).
      const perModel = {};
      for (const res of r.results) {
        if (res.modelId != null) {
          perModel[res.modelId] = res.ok
            ? { ok: true, latencyMs: res.latencyMs }
            : { ok: false, error: res.error };
        }
      }
      setTestState((s) => ({ ...s, ...perModel }));
      setBatchState({ busy: false, done: r.summary.total, total: r.summary.total, results: perModel, summary: r.summary, free: r.freeWorkingModels });
      notify(`Test All done: ${r.summary.ok}/${r.summary.total} working${r.summary.freeWorking ? ` · ${r.summary.freeWorking} free` : ""}.`, r.summary.ok ? undefined : "red");
    } catch (e) {
      setBatchState((s) => ({ ...s, busy: false }));
      setError(`Test All failed: ${e.message}`);
    }
  };

  // Prune dead models: dry-run sweep first (preview what would be deleted),
  // then a guarded delete on confirm. Only hard-404 "function not found"
  // models are pruned; timeouts/soft failures are always kept server-side.
  const openPrunePreview = async () => {
    if (!companyKey) {
      notify("Select a company first — the sweep runs through its credential.", "red");
      return;
    }
    if (pruneBusy || batchState.busy) return;
    setPruneBusy(true);
    setError(null);
    try {
      const r = await pruneDeadModels(companyKey, { providerKey, dryRun: true });
      if (!r.prune.length) {
        notify(`No dead models to prune — ${r.okCount} working, ${r.keep.length} timeout/soft-failure kept.`, "slate");
        return;
      }
      setPrunePreview(r);
    } catch (e) {
      setError(`Prune preview failed: ${e.message}`);
    } finally {
      setPruneBusy(false);
    }
  };

  const confirmPrune = async () => {
    if (pruneBusy) return;
    setPruneBusy(true);
    setError(null);
    try {
      const r = await pruneDeadModels(companyKey, { providerKey, dryRun: false });
      setPrunePreview(null);
      await load();
      notify(r.message || `Pruned ${r.deleted.length} dead model(s).`);
    } catch (e) {
      setError(`Prune failed: ${e.message}`);
    } finally {
      setPruneBusy(false);
    }
  };

  // Thinking dropdown — applies the chosen mode to EVERY catalog model of the
  // provider (per-model PUT), so the header control matches 9Router's
  // "Thinking: Auto" semantics. Models the executor treats as auto keep it.
  const setThinking = async (mode) => {
    if (thinkingBusy || !models.length) return;
    setThinkingBusy(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        models.map((m) => updateProviderModel(providerKey, m.id, { thinkingMode: mode }))
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) {
        throw new Error(`${failed.length} model update(s) failed — ${failed[0].reason?.message || "see console"}`);
      }
      await load();
      notify(`Thinking set to '${mode}' for all ${models.length} models.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setThinkingBusy(false);
    }
  };

  // 9Router Disable All: bulk-flip every model-access grant of the company's
  // credentials for this provider. Off → on when nothing is currently enabled.
  const toggleDisableAll = async () => {
    if (!companyKey || bulkBusy) return;
    setBulkBusy(true);
    setError(null);
    try {
      const enable = enabledGrants === 0;
      const r = await bulkSetModelAccess({ companyKey, providerKey, enabled: enable });
      await loadGrants();
      notify(r.message || `${enable ? "Enabled" : "Disabled"} all model access.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkBusy(false);
    }
  };

  // Pull the provider's live model list through the company's credential and
  // upsert into the catalog ("Fetch Models").
  const [fetchBusy, setFetchBusy] = useState(false);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const fetchModels = async () => {
    if (!companyKey) {
      notify("Select a company first — models are fetched through its credential.", "red");
      return;
    }
    if (fetchBusy) return;
    setFetchBusy(true);
    setError(null);
    try {
      const r = await fetchProviderModels(providerKey, companyKey);
      if (r.skipped) {
        notify("No /models endpoint for this provider — nothing to fetch.", "slate");
      } else {
        await load();
        // Verified sync: the server probes every advertised chat model and only
        // upserts responders — prefer its richer message (includes drop counts).
        notify(r.message || `Fetched ${r.fetched} model${r.fetched === 1 ? "" : "s"} from '${providerKey}'.`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setFetchBusy(false);
    }
  };

  // Bulk "Delete All Models" — removes every catalog model of the provider
  // (pricing + credential model-access grants CASCADE with them). Guarded by
  // a confirm dialog that names the provider and the exact count.
  const removeAllModels = async () => {
    if (!models.length || bulkDeleteBusy) return;
    const label = models.length === 1 ? `the 1 model of '${providerKey}'` : `all ${models.length} models of '${providerKey}'`;
    if (!window.confirm(`Delete ${label}? Their pricing rows and any credential model-access grants are removed with them. This cannot be undone.`)) return;
    setBulkDeleteBusy(true);
    setError(null);
    try {
      const r = await deleteAllProviderModels(providerKey);
      await load();
      await loadGrants();
      notify(r.message || `Deleted ${r.removed} model(s) from '${providerKey}'.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBulkDeleteBusy(false);
    }
  };

  const currentThinking = (() => {
    const modes = [...new Set(models.map((m) => m.thinking_mode || "auto"))];
    return modes.length === 1 ? modes[0] : "auto";
  })();

  return (
    <Card
      title="Available Models"
      subtitle={`${models.length} model${models.length === 1 ? "" : "s"} in the catalog`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setModelModal({})}>
            + Add Model
          </Button>
          <Button
            variant="secondary"
            onClick={testAllModels}
            disabled={batchState.busy || !companyKey || !models.some((m) => m.category === "chat")}
            title={
              companyKey
                ? "Ping every chat model through the company's credential — dead and capacity-blocked models get flagged"
                : "Select a company first"
            }
          >
            {batchState.busy ? (
              <>
                <Spinner className="h-3.5 w-3.5" /> Testing {batchState.done}/{batchState.total}
              </>
            ) : (
              "Test All"
            )}
          </Button>
          <Button
            variant="secondary"
            onClick={openPrunePreview}
            disabled={pruneBusy || batchState.busy || !companyKey || !models.length}
            title={
              companyKey
                ? "Run a sweep and remove models the provider no longer serves (function-not-found 404s only)"
                : "Select a company first"
            }
          >
            {pruneBusy ? <Spinner className="h-3.5 w-3.5" /> : "Prune Dead"}
          </Button>
          <Button
            variant="secondary"
            onClick={fetchModels}
            disabled={fetchBusy || !companyKey}
            title={
              companyKey
                ? "Fetch the provider's live model list and keep only models that actually respond (dead ones are dropped)"
                : "Select a company first"
            }
          >
            {fetchBusy ? <Spinner className="h-3.5 w-3.5" /> : "Fetch Models"}
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            Thinking:
            <select
              value={currentThinking}
              disabled={thinkingBusy || !models.length}
              onChange={(e) => setThinking(e.target.value)}
              aria-label="Thinking mode for all models"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {THINKING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            onClick={toggleDisableAll}
            disabled={bulkBusy || !companyKey}
            title={
              companyKey
                ? enabledGrants === 0
                  ? "Enable every model-access grant for this provider"
                  : `Disable all ${enabledGrants} model-access grant(s) for this provider`
                : "Select a company first"
            }
          >
            {bulkBusy ? <Spinner className="h-3.5 w-3.5" /> : enabledGrants === 0 ? "Enable All" : "Disable All"}
          </Button>
          <Button
            variant="secondary"
            onClick={removeAllModels}
            disabled={bulkDeleteBusy || models.length === 0}
            title={
              models.length
                ? `Delete all ${models.length} catalog model(s) of this provider (pricing + grants removed with them)`
                : "No models to delete"
            }
            className="border-rose-500/30 text-rose-300 hover:border-rose-500/60 hover:bg-rose-500/10"
          >
            {bulkDeleteBusy ? <Spinner className="h-3.5 w-3.5" /> : "Delete All"}
          </Button>
        </div>
      }
    >
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
      )}
      {batchState.summary && (
        <div className="mb-3 rounded-lg border border-slate-700/60 bg-slate-900/60 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={batchState.summary.failed === 0 ? "green" : "amber"}>
              {batchState.summary.ok}/{batchState.summary.total} working
            </Badge>
            {batchState.summary.timeouts > 0 && <Badge tone="slate">{batchState.summary.timeouts} timed out</Badge>}
            <Badge tone="cyan">avg {batchState.summary.avgLatencyMs ?? "—"}ms</Badge>
          </div>
          {batchState.free?.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Free models working right now</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {batchState.free.map((f) => (
                  <Badge key={f.modelKey} tone="green">
                    {f.modelKey} · {f.latencyMs}ms
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {batchState.results &&
            Object.entries(batchState.results).some(([, v]) => !v.ok) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">
                  Show {Object.values(batchState.results).filter((v) => !v.ok).length} failing model(s)
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(batchState.results)
                    .filter(([, v]) => !v.ok)
                    .map(([id, v]) => {
                      const m = models.find((x) => String(x.id) === String(id));
                      return (
                        <li key={id} className="text-[11px] text-rose-300">
                          ✕ <code className="font-mono">{m?.model_key || id}</code> — {v.error}
                        </li>
                      );
                    })}
                </ul>
              </details>
            )}
        </div>
      )}
      {loading ? (
        <SkeletonText lines={3} className="py-4" />
      ) : models.length === 0 ? (
        <Empty message="No models registered for this provider yet — add the first one to make it selectable." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {models.map((m) => {
            const t = testState[m.id];
            return (
              <div key={m.id} className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="mt-0.5 text-slate-500">🧠</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <code className="truncate font-mono text-xs text-slate-200" title={m.model_key}>{m.model_key}</code>
                      <IconButton
                        title={`Copy ${m.model_key}`}
                        onClick={() => copyText(m.model_key, notify)}
                        className="p-1 text-slate-500 hover:text-slate-200"
                      >
                        <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </svg>
                      </IconButton>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-400" title={m.model_name || m.model_key}>
                      {m.model_name || m.model_key}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={categoryTone(m.category)}>{m.category}</Badge>
                      {batchState.results?.[m.id]?.ok && (m.input_price_per_million === 0 || /(^|[-._:/])free([-.:/_].*)?$/i.test(m.model_key)) && (
                        <Badge tone="green">free</Badge>
                      )}
                      {thinkingBadge(m.thinking_mode)}
                      {m.supports_streaming && <Badge tone="cyan">stream</Badge>}
                      {m.supports_function_calling && <Badge tone="indigo">tools</Badge>}
                      {m.supports_vision && <Badge tone="green">vision</Badge>}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1 border-t border-slate-800/70 pt-2">
                  <IconButton title={`Test model ${m.model_key}`} onClick={() => testModel(m)} disabled={!companyKey}>
                    {t === "busy" ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : (
                      <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 3h6M10 3v3.5a2 2 0 0 1-.6 1.4L4.6 12.7A2 2 0 0 0 4 14.1V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.9a2 2 0 0 0-.6-1.4l-4.4-4.8A2 2 0 0 1 14 6.5V3" />
                        <path d="M8.5 14.5 11 17l4.5-5" />
                      </svg>
                    )}
                  </IconButton>
                  <IconButton title={`Edit model ${m.model_key}`} onClick={() => setModelModal({ row: m })}>
                    <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </IconButton>
                  <IconButton title={`Delete model ${m.model_key}`} className="ml-auto text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => removeModel(m)}>
                    <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </IconButton>
                </div>
                {t && t !== "busy" && (
                  <div className={`mt-1 text-[11px] ${t.ok ? "text-emerald-400" : "text-rose-400"}`}>
                    {t.ok ? `✓ responded${t.latencyMs != null ? ` in ${t.latencyMs}ms` : ""}` : `✕ ${t.error}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {prunePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-label="Prune dead models preview">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-slate-100">Prune dead models — preview</h3>
            <p className="mt-1 text-xs text-slate-400">
              Fresh sweep: {prunePreview.summary?.ok ?? prunePreview.okCount} working · {prunePreview.prune.length} dead · {prunePreview.keep.length} timeout/soft-failure.
              Only definitively dead models (function-not-found 404s) are removed — timeouts and soft failures are always kept.
            </p>
            <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-2">
              {prunePreview.prune.map((p) => (
                <li key={p.modelId ?? p.modelKey} className="text-[11px] text-rose-300">
                  ✕ <code className="font-mono">{p.modelKey}</code>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPrunePreview(null)} disabled={pruneBusy}>
                Cancel
              </Button>
              <Button
                onClick={confirmPrune}
                disabled={pruneBusy}
                className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:border-rose-500/70"
              >
                {pruneBusy ? <Spinner className="h-3.5 w-3.5" /> : `Delete ${prunePreview.prune.length} dead model(s)`}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ModelModal
        open={modelModal !== null}
        row={modelModal?.row}
        providerKey={providerKey}
        onClose={() => setModelModal(null)}
        onSaved={saveModelDone}
      />
    </Card>
  );
}
