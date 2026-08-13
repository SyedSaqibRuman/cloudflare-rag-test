import { useEffect, useState } from "react";
import {
  listGatewayCompanies,
  getGatewayCompany,
  listCredentials,
  listProviderModels,
  listKbs,
  listAssistants,
  createAssistant,
  updateAssistant,
  deleteAssistant,
} from "../api";
import { Card, Button, Input, Select, TextArea, Badge, Empty, Spinner, Modal, Toast, IconButton } from "../components/ui";
import { useCompanies } from "../context";
import { timeAgo } from "../util";
import { useHeaderActions } from "../components/Layout";

// -------- helpers -----------------------------------------------------------

const slugify = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function IconPlus() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5v14" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// -------- page --------------------------------------------------------------

export default function Assistants() {
  const { company } = useCompanies();
  const [companies, setCompanies] = useState([]);
  const [companyKey, setCompanyKey] = useState("");
  const [detail, setDetail] = useState(null);
  const [assistants, setAssistants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // Modal state
  const [modal, setModal] = useState(null); // null | { assistant }
  const [creds, setCreds] = useState([]);
  const [kbs, setKbs] = useState([]);
  const [models, setModels] = useState([]);
  const [form, setForm] = useState({
    assistantKey: "",
    assistantName: "",
    credentialId: "",
    modelId: "",
    primaryKbId: "",
    systemPrompt: "",
    temperature: "0.7",
    maxTokens: "4096",
    enableFunctionCalling: true,
    enableStreaming: true,
    isPublic: false,
  });
  const [keyTouched, setKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const notify = (msg, tone = "green") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3000);
  };

  const load = async (key) => {
    if (!key) {
      setAssistants([]);
      setDetail(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [d, list] = await Promise.all([getGatewayCompany(key), listAssistants(key)]);
      setDetail(d);
      setAssistants(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Bootstrap: gateway companies, then follow the sidebar company when present.
  useEffect(() => {
    (async () => {
      setError(null);
      try {
        const cs = await listGatewayCompanies();
        setCompanies(cs);
        const preferred = company && cs.some((c) => c.company_key === company) ? company : cs[0]?.company_key;
        setCompanyKey(preferred || "");
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!company || !companies.length) return;
    if (companies.some((c) => c.company_key === company)) setCompanyKey(company);
  }, [company, companies]);

  useEffect(() => {
    load(companyKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey]);

  const openModal = async (assistant) => {
    setFormError(null);
    setKeyTouched(false);
    setModels([]);
    setModal({ assistant: assistant || null });
    if (!companyKey) return;
    try {
      const [c, k] = await Promise.all([listCredentials(companyKey), listKbs(companyKey)]);
      setCreds(c);
      setKbs(k);
      if (assistant) {
        setForm({
          assistantKey: assistant.assistant_key,
          assistantName: assistant.assistant_name,
          credentialId: String(assistant.credential_id || ""),
          modelId: assistant.model_id ? String(assistant.model_id) : "",
          primaryKbId: assistant.primary_kb_id ? String(assistant.primary_kb_id) : "",
          systemPrompt: assistant.system_prompt || "",
          temperature: String(assistant.temperature ?? 0.7),
          maxTokens: String(assistant.max_tokens ?? 4096),
          enableFunctionCalling: !!assistant.enable_function_calling,
          enableStreaming: !!assistant.enable_streaming,
          isPublic: !!assistant.is_public,
        });
        // Load the credential's provider models for the model dropdown.
        const cred = c.find((x) => String(x.id) === String(assistant.credential_id));
        if (cred) setModels(await listProviderModels(cred.provider_key));
      } else {
        setForm({
          assistantKey: "",
          assistantName: "",
          credentialId: "",
          modelId: "",
          primaryKbId: "",
          systemPrompt: "",
          temperature: "0.7",
          maxTokens: "4096",
          enableFunctionCalling: true,
          enableStreaming: true,
          isPublic: false,
        });
      }
    } catch (e) {
      setFormError(e.message);
    }
  };

  const onCredential = async (credentialId) => {
    setForm((f) => ({ ...f, credentialId, modelId: "" }));
    const cred = creds.find((x) => String(x.id) === String(credentialId));
    setModels([]);
    if (cred) {
      try {
        setModels(await listProviderModels(cred.provider_key));
      } catch (e) {
        setFormError(e.message);
      }
    }
  };

  const onName = (v) => {
    setForm((f) => ({
      ...f,
      assistantName: v,
      assistantKey: keyTouched ? f.assistantKey : slugify(v),
    }));
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (!form.assistantName.trim()) throw new Error("Assistant name is required.");
      if (!form.assistantKey.trim()) throw new Error("Assistant key is required.");
      if (!form.credentialId) throw new Error("Choose a credential — it supplies the API key at runtime.");
      const body = {
        assistantKey: form.assistantKey.trim(),
        assistantName: form.assistantName.trim(),
        credentialId: Number(form.credentialId),
        modelId: form.modelId ? Number(form.modelId) : null,
        primaryKbId: form.primaryKbId ? Number(form.primaryKbId) : null,
        systemPrompt: form.systemPrompt.trim() || null,
        temperature: Number(form.temperature),
        maxTokens: Number(form.maxTokens),
        enableFunctionCalling: form.enableFunctionCalling,
        enableStreaming: form.enableStreaming,
        isPublic: form.isPublic,
      };
      if (modal?.assistant) {
        await updateAssistant(form.assistantKey.trim(), body, companyKey);
        notify(`Assistant '${form.assistantKey.trim()}' updated.`);
      } else {
        await createAssistant(body, companyKey);
        notify(`Assistant '${form.assistantKey.trim()}' created.`);
      }
      setModal(null);
      await load(companyKey);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAssistant(deleteTarget.assistant_key, companyKey);
      setDeleteTarget(null);
      notify(`Assistant '${deleteTarget.assistant_key}' deleted.`);
      await load(companyKey);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={() => load(companyKey)} disabled={loading || !companyKey}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
      <Button onClick={() => openModal(null)} disabled={!companyKey}>
        <IconPlus /> New Assistant
      </Button>
    </div>
  );

  if (!companyKey && !loading) {
    return (
      <div className="space-y-6">
        {error && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
        )}
        <Empty message="No gateway companies yet. Create one via POST /gateway/companies, then add its provider credentials here." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <Card
        title={`Assistants${companyKey ? ` — ${companyKey}` : ""}`}
        subtitle={`${assistants.length} assistant${assistants.length === 1 ? "" : "s"} — a persona bound to a credential, a model, and optional knowledge bases (Phase F)`}
      >
        {assistants.length === 0 ? (
          <Empty message="No assistants yet. Create one — pick a credential, a model from its provider, and optional knowledge bases." />
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-3 font-medium">Assistant</th>
                  <th className="pb-3 font-medium">Credential</th>
                  <th className="pb-3 font-medium">Model</th>
                  <th className="pb-3 font-medium">KB</th>
                  <th className="pb-3 font-medium">Streaming</th>
                  <th className="pb-3 font-medium">Updated</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {assistants.map((a) => (
                  <tr key={a.id} className="text-slate-300 hover:bg-slate-800/40">
                    <td className="py-3">
                      <span className="font-medium text-slate-100">{a.assistant_name}</span>
                      <div className="font-mono text-xs text-slate-500">{a.assistant_key}</div>
                    </td>
                    <td className="py-3">
                      <span className="text-slate-200">{a.credential_name || "—"}</span>
                      <div className="font-mono text-xs text-slate-500">{a.provider_name || ""}</div>
                    </td>
                    <td className="py-3">{a.model_name ? <Badge tone="indigo">{a.model_name}</Badge> : "—"}</td>
                    <td className="py-3">{a.primary_kb_name ? <Badge tone="cyan">{a.primary_kb_name}</Badge> : "—"}</td>
                    <td className="py-3">{a.enable_streaming ? <Badge tone="green">streaming</Badge> : "—"}</td>
                    <td className="py-3 text-xs text-slate-500">{timeAgo(a.updated_at)}</td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton title="Edit assistant" onClick={() => openModal(a)}><IconPencil /></IconButton>
                        <IconButton title="Delete assistant" className="hover:text-rose-300" onClick={() => setDeleteTarget(a)}><IconTrash /></IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create / edit assistant */}
      <Modal
        open={modal !== null}
        title={modal?.assistant ? `Edit assistant — ${modal.assistant.assistant_key}` : "New assistant"}
        onClose={() => setModal(null)}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Spinner className="h-3.5 w-3.5" /> : modal?.assistant ? "Save changes" : "Create assistant"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Assistant name *"
              value={form.assistantName}
              onChange={(e) => onName(e.target.value)}
              placeholder="e.g. Sarah the Certification Coach"
              autoFocus
            />
            <div>
              <Input
                label="Assistant key *"
                value={form.assistantKey}
                disabled={!!modal?.assistant}
                onChange={(e) => {
                  setKeyTouched(true);
                  setForm((f) => ({ ...f, assistantKey: e.target.value }));
                }}
                placeholder="auto-generated from the name"
              />
              {!modal?.assistant && (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {keyTouched
                    ? "Manual value — type in the name field to re-sync it."
                    : "Auto-generated from the name (lowercase, spaces → -)."}
                </p>
              )}
            </div>
          </div>
          <Select
            label="Credential * (supplies the API key at runtime)"
            options={[
              { value: "", label: "— select a credential —" },
              ...creds.map((c) => ({ value: String(c.id), label: `${c.credential_name} (${c.provider_name})` })),
            ]}
            value={form.credentialId}
            onChange={(e) => onCredential(e.target.value)}
          />
          <Select
            label="Model (from the credential's provider)"
            options={[
              { value: "", label: "— provider default —" },
              ...models.map((m) => ({ value: String(m.id), label: `${m.model_name} · ${m.category}` })),
            ]}
            value={form.modelId}
            onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}
          />
          <Select
            label="Primary knowledge base"
            options={[
              { value: "", label: "— none —" },
              ...kbs.map((k) => ({ value: String(k.id), label: k.kb_name })),
            ]}
            value={form.primaryKbId}
            onChange={(e) => setForm((f) => ({ ...f, primaryKbId: e.target.value }))}
          />
          <TextArea
            label="System prompt"
            rows={4}
            value={form.systemPrompt}
            onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
            placeholder="You are a helpful certification coach…"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Temperature"
              type="number"
              step="0.1"
              min={0}
              max={2}
              value={form.temperature}
              onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
            />
            <Input
              label="Max tokens"
              type="number"
              min={1}
              value={form.maxTokens}
              onChange={(e) => setForm((f) => ({ ...f, maxTokens: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-5 text-sm text-slate-300">
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enableStreaming}
                onChange={(e) => setForm((f) => ({ ...f, enableStreaming: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500"
              />
              Enable streaming
            </span>
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enableFunctionCalling}
                onChange={(e) => setForm((f) => ({ ...f, enableFunctionCalling: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500"
              />
              Function calling
            </span>
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isPublic}
                onChange={(e) => setForm((f) => ({ ...f, isPublic: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500"
              />
              Public
            </span>
          </label>
        </div>
      </Modal>

      {/* Delete assistant */}
      <Modal
        open={deleteTarget !== null}
        title="Delete assistant"
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={remove} disabled={busy}>
              {busy ? <Spinner className="h-3.5 w-3.5" /> : "Delete"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete assistant <span className="font-mono text-rose-300">{deleteTarget?.assistant_key}</span> (
          <span className="text-slate-100">{deleteTarget?.assistant_name}</span>)? This soft-deletes the row
          so it can no longer be resolved.
        </p>
      </Modal>

      <Toast message={toast?.msg} tone={toast?.tone} />
    </div>
  );
}
