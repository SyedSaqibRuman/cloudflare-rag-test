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
  deleteProviderModel,
  executeChat,
  fetchProviderModels,
  listCredentialModels,
  listCredentials,
  listProviderModels,
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
        notify(`Fetched ${r.fetched} model${r.fetched === 1 ? "" : "s"} from '${providerKey}'.`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setFetchBusy(false);
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
          <Button
            variant="secondary"
            onClick={fetchModels}
            disabled={fetchBusy || !companyKey}
            title={
              companyKey
                ? "Pull the provider's live model list through the company's credential"
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
        </div>
      }
    >
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
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

      <div className="mt-4">
        <Button variant="secondary" onClick={() => setModelModal({})}>+ Add Model</Button>
      </div>

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
