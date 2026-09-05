import { useEffect, useState } from "react";
import {
  listGatewayCompanies,
  listCredentials,
  listProviderModels,
  listKbs,
  listAssistants,
  createAssistant,
  updateAssistant,
  deleteAssistant,
  testAssistant,
  duplicateAssistant,
  api,
} from "../api";
import { Card, Button, Input, Select, TextArea, Badge, Empty, Spinner, Modal, Toast, IconButton, Toggle, ArrowRightIcon, InfoTip } from "../components/ui";
import { triggerNextStep } from "../components/NextStepPrompt";
import { getTermTooltip } from "../components/glossary";
import { useCompanies } from "../context";
import { timeAgo } from "../util";
import { useHeaderActions } from "../components/Layout";
import { useToast, usePagination } from "../hooks";

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

/** Simple client-side prompt preview: resolves {{KEY}} → value from variables + company config. */
function renderPromptPreview(template, variables, companyConfig = {}, assistantName = "") {
  if (!template) return "(no system prompt)";
  let out = template;
  const defaults = {
    COMPANY_NAME: companyConfig.COMPANY_NAME || "",
    CONSULTANT_NAME: assistantName || companyConfig.CONSULTANT_NAME || companyConfig.COMPANY_NAME || "",
    CONTACT_US_URL: companyConfig.CONTACT_US_URL || "",
    LOCATIONS_URL: companyConfig.LOCATIONS_URL || "",
    SERVICES_URL: companyConfig.SERVICES_URL || "",
    BASE_URL: companyConfig.BASE_URL || "",
  };
  for (const [key, value] of Object.entries(defaults)) {
    out = out.replaceAll(`{{${key}}}`, value || "");
  }
  for (const { key, value } of variables || []) {
    if (key.trim()) out = out.replaceAll(`{{${key.trim()}}}`, value || "(empty)");
  }
  return out;
}

// -------- page --------------------------------------------------------------

export default function Assistants() {
  const { company } = useCompanies();
  const [companies, setCompanies] = useState([]);
  const [companyKey, setCompanyKey] = useState("");
  const [assistants, setAssistants] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { toast, notify } = useToast();
  const { page, perPage, setPage, setPerPage, paginationParams } = usePagination();

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
    kbIds: [],
    systemPrompt: "",
    guardrailPrompt: "",
    blockedTopics: "",
    variables: [],
    temperature: "0.7",
    maxTokens: "4096",
    enableFunctionCalling: true,
    enableStreaming: true,
    isPublic: false,
  });
  // Test in Console state
  const [testOpen, setTestOpen] = useState(false);
  const [testAssistantKey, setTestAssistantKey] = useState(null);
  const [testQuestion, setTestQuestion] = useState("");
  const [testAnswer, setTestAnswer] = useState(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState(null);
  // Duplicate state
  const [duplicateTarget, setDuplicateTarget] = useState(null);
  const [dupKey, setDupKey] = useState("");
  const [dupBusy, setDupBusy] = useState(false);
  const [editingVarIndex, setEditingVarIndex] = useState(null);
  const [keyTouched, setKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modalTab, setModalTab] = useState("general"); // "general" | "prompt"
  const [companyConfig, setCompanyConfig] = useState({});

  const load = async (key) => {
    if (!key) {
      setAssistants([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await listAssistants(key, paginationParams);
      setAssistants(result.items);
      setPagination(result.pagination);
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
        const csResult = await listGatewayCompanies();
        const cs = csResult.items ?? csResult;
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
    // Intentionally keyed on companyKey only — switching assistant reloads;
    // a changed `load` identity should not retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey]);

  const closeModal = () => {
    setModal(null);
    setEditingVarIndex(null);
  };

  const openModal = async (assistant) => {
    setFormError(null);
    setKeyTouched(false);
    setModels([]);
    setModalTab("general");
    setModal({ assistant: assistant || null });
    if (!companyKey) return;
    try {
      const [c, k, configData] = await Promise.all([
        listCredentials(companyKey),
        listKbs(companyKey),
        api(`/cloudflare/config?company=${encodeURIComponent(companyKey)}`),
      ]);
      setCreds(c);
      // listKbs resolves to { items, pagination } — unwrap the array.
      setKbs(Array.isArray(k) ? k : (k?.items ?? []));
      setCompanyConfig(configData?.config?.GENERAL || {});
      const companySystemPrompt = configData?.config?.GENERAL?.SYSTEM_PROMPT || "";
      if (assistant) {
        setForm({
          assistantKey: assistant.assistant_key,
          assistantName: assistant.assistant_name,
          credentialId: String(assistant.credential_id || ""),
          modelId: assistant.model_id ? String(assistant.model_id) : "",
          primaryKbId: assistant.primary_kb_id ? String(assistant.primary_kb_id) : "",
          kbIds: assistant.kb_ids || [],
          systemPrompt: assistant.system_prompt || "",
          guardrailPrompt: assistant.guardrail_prompt || "",
          blockedTopics: assistant.blocked_topics || "",
          variables: assistant.assistant_variables?.length ? assistant.assistant_variables : [],
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
          systemPrompt: companySystemPrompt,
          guardrailPrompt: "",
          blockedTopics: "",
          variables: [],
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
      // Don't touch the key in edit mode — it's the immutable route identity.
      assistantKey: modal?.assistant ? f.assistantKey : (keyTouched ? f.assistantKey : slugify(v)),
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
        kbIds: form.kbIds.length ? form.kbIds : null,
        systemPrompt: form.systemPrompt.trim() || null,
        guardrailPrompt: form.guardrailPrompt.trim() || null,
        blockedTopics: form.blockedTopics.trim() || null,
        variables: form.variables.filter((v) => v.key.trim()),
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
        triggerNextStep("assistant-created");
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

  const openTest = (assistant) => {
    setTestAssistantKey(assistant.assistant_key);
    setTestQuestion("");
    setTestAnswer(null);
    setTestError(null);
    setTestOpen(true);
  };

  const runTest = async () => {
    if (!testQuestion.trim()) return;
    setTestBusy(true);
    setTestAnswer(null);
    setTestError(null);
    try {
      const result = await testAssistant(testAssistantKey, testQuestion.trim(), companyKey);
      setTestAnswer(result);
    } catch (e) {
      setTestError(e.message);
    } finally {
      setTestBusy(false);
    }
  };

  const runDuplicate = async () => {
    if (!dupKey.trim()) return;
    setDupBusy(true);
    try {
      await duplicateAssistant(duplicateTarget.assistant_key, dupKey.trim(), companyKey);
      notify(`Duplicated as '${dupKey.trim()}'.`);
      setDuplicateTarget(null);
      setDupKey("");
      await load(companyKey);
    } catch (e) {
      setError(e.message);
    } finally {
      setDupBusy(false);
    }
  };

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={() => load(companyKey)} disabled={loading || !companyKey}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
      <Button onClick={() => openModal(null)} disabled={!companyKey || !companies.length} className="whitespace-nowrap">
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
        subtitle={`${pagination?.total ?? assistants.length} assistant${(pagination?.total ?? assistants.length) === 1 ? "" : "s"} — a persona bound to a credential, a model, and optional knowledge bases`}
        footer={pagination && pagination.total > perPage && (
          <Pagination
            page={page}
            perPage={perPage}
            total={pagination.total}
            onPageChange={setPage}
            onPerPageChange={setPerPage}
            loading={loading}
          />
        )}
      >
        {assistants.length === 0 ? (
          <Empty message="No assistants yet. Create one — pick a credential, a model from its provider, and optional knowledge bases." />
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-3 font-medium">Assistant</th>
                  <th className="pb-3 font-medium">Credential <InfoTip content={getTermTooltip("api-key")} /></th>
                  <th className="pb-3 font-medium">Model <InfoTip content={getTermTooltip("model")} /></th>
                  <th className="pb-3 font-medium">KB <InfoTip content={getTermTooltip("knowledge-base")} /></th>
                  <th className="pb-3 font-medium">Streaming <InfoTip content={getTermTooltip("streaming")} /></th>
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
                        <IconButton title="Test in console" className="hover:text-emerald-300" onClick={() => openTest(a)}>
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                        </IconButton>
                        <IconButton title="Duplicate assistant" className="hover:text-amber-300" onClick={() => { setDuplicateTarget(a); setDupKey(`${a.assistant_key}-copy`); }}>
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                        </IconButton>
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
        onClose={closeModal}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
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

          {/* ---- Tabs ---- */}
          <div className="flex border-b border-slate-800">
            {["general", "prompt"].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setModalTab(tab)}
                className={`-mb-px px-4 py-2 text-sm font-medium transition-colors ${
                  modalTab === tab
                    ? "border-b-2 border-indigo-500 text-indigo-300"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {tab === "general" ? "General" : "Prompt"}
              </button>
            ))}
          </div>

          {/* ---- General tab ---- */}
          {modalTab === "general" && (
            <div className="space-y-4">
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
                        : <>Auto-generated from the name (lowercase, spaces <ArrowRightIcon className="inline h-3 w-3" /> -).</>}
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
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-300">Additional knowledge bases</p>
                <div className="flex flex-wrap gap-2">
                  {kbs.map((k) => {
                    const selected = form.kbIds.includes(k.id);
                    return (
                      <button
                        key={k.id}
                        type="button"
                        onClick={() => {
                          setForm((f) => ({
                            ...f,
                            kbIds: selected ? f.kbIds.filter((id) => id !== k.id) : [...f.kbIds, k.id],
                          }));
                        }}
                        className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                          selected
                            ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                            : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500"
                        }`}
                      >
                        {k.kb_name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Toggle KBs this assistant can search beyond the primary.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Input
                    label="Temperature"
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    value={form.temperature}
                    onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
                  />
                  <p className="mt-1.5 text-[11px] text-slate-500">Lower = focused and deterministic. Higher = more creative and varied.</p>
                </div>
                <div>
                  <Input
                    label="Max tokens"
                    type="number"
                    min={1}
                    value={form.maxTokens}
                    onChange={(e) => setForm((f) => ({ ...f, maxTokens: e.target.value }))}
                  />
                  <p className="mt-1.5 text-[11px] text-slate-500">Hard cap on the response length. One token ≈ 0.75 words.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-slate-300">
                <span className="flex items-center gap-2">
                  Enable streaming
                  <Toggle
                    checked={form.enableStreaming}
                    onChange={(v) => setForm((f) => ({ ...f, enableStreaming: v }))}
                    title="Toggle streaming"
                  />
                </span>
                <span className="flex items-center gap-2">
                  Function calling
                  <Toggle
                    checked={form.enableFunctionCalling}
                    onChange={(v) => setForm((f) => ({ ...f, enableFunctionCalling: v }))}
                    title="Toggle function calling"
                  />
                </span>
                <span className="flex items-center gap-2">
                  Public
                  <Toggle
                    checked={form.isPublic}
                    onChange={(v) => setForm((f) => ({ ...f, isPublic: v }))}
                    title="Toggle public access"
                  />
                </span>
              </div>
            </div>
          )}

          {/* ---- Prompt tab ---- */}
          {modalTab === "prompt" && (
            <div className="space-y-4">
              <TextArea
                label="System prompt"
                rows={6}
                value={form.systemPrompt}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                placeholder="You are a helpful certification coach…"
              />
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                <p className="mb-3 text-xs font-medium text-slate-300">Guardrails <span className="font-normal text-slate-500">— topic restrictions applied to every answer, on top of the company defaults</span></p>
                <div className="space-y-4">
                  <TextArea
                    label="Custom guardrail instructions"
                    rows={4}
                    value={form.guardrailPrompt}
                    onChange={(e) => setForm((f) => ({ ...f, guardrailPrompt: e.target.value }))}
                    placeholder={'Optional instructions appended to the system prompt — e.g. "Never discuss pricing specifics; always direct users to the contact form." Leave empty to use the company/built-in guardrail.'}
                  />
                  <TextArea
                    label="Blocked topics (one per line)"
                    rows={3}
                    value={form.blockedTopics}
                    onChange={(e) => setForm((f) => ({ ...f, blockedTopics: e.target.value }))}
                    placeholder={"crypto\ninvestments\ngambling"}
                  />
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Questions containing any blocked topic are refused before retrieval or an AI call, and blocked topics stay
                    out of the suggested follow-up questions. Matching is case-insensitive ("crypto" also blocks "cryptocurrency").
                    Leave both empty to fall back to the company-level guardrails and the built-in off-topic patterns.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-300">Built-in variables</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: "COMPANY_NAME", value: companyConfig.COMPANY_NAME || "", label: "Company Display Name" },
                    { key: "CONSULTANT_NAME", value: companyConfig.CONSULTANT_NAME || "", label: "Assistant Name" },
                    { key: "CONTACT_US_URL", value: companyConfig.CONTACT_US_URL || "", label: "Contact Us URL" },
                    { key: "LOCATIONS_URL", value: companyConfig.LOCATIONS_URL || "", label: "Locations URL" },
                    { key: "SERVICES_URL", value: companyConfig.SERVICES_URL || "", label: "Services URL" },
                    { key: "BASE_URL", value: companyConfig.BASE_URL || "", label: "Base URL" },
                  ].map((v) => (
                    <span
                      key={v.key}
                      title={`${v.label}: ${v.value || "not set"}`}
                      onClick={() => { navigator.clipboard?.writeText(`{{${v.key}}}`); notify(`Copied {{${v.key}}}`, "green"); }}
                      className="cursor-pointer rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-300 transition-colors hover:border-indigo-500 hover:text-indigo-200"
                    >
                      {`{{${v.key}}}`}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">Click a variable to copy it, then paste it into the system prompt above.</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-300">Custom Variables</p>
                  <button
                    type="button"
                    onClick={() => { setEditingVarIndex(null); setForm((f) => ({ ...f, variables: [...f.variables, { key: "", value: "" }] })); }}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-indigo-500 hover:text-indigo-200"
                  >
                    + Add variable
                  </button>
                </div>
                {form.variables.length === 0 && (
                  <p className="text-[11px] text-slate-500">No variables. Use {'{{KEY}}'} in the system prompt and add key-value pairs here to inject values at runtime.</p>
                )}
                <div className="space-y-1.5">
                  {form.variables.map((v, i) => (
                    <div key={i} className="flex items-center gap-2">
                      {editingVarIndex === i ? (
                        <>
                          <Input
                            value={v.key}
                            onChange={(e) => setForm((f) => ({ ...f, variables: f.variables.map((x, j) => j === i ? { ...x, key: e.target.value } : x) }))}
                            placeholder="KEY"
                            className="flex-1 py-1.5 text-xs"
                          />
                          <span className="text-slate-500">=</span>
                          <Input
                            value={v.value}
                            onChange={(e) => setForm((f) => ({ ...f, variables: f.variables.map((x, j) => j === i ? { ...x, value: e.target.value } : x) }))}
                            placeholder="value"
                            className="flex-1 py-1.5 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setEditingVarIndex(null)}
                            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-emerald-300 transition-colors hover:border-emerald-500 hover:text-emerald-200"
                            title="Save"
                          >
                            ✓
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard?.writeText(`{{${v.key}}}`); notify(`Copied {{${v.key}}}`, "green"); }}
                            className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-slate-300 transition-colors hover:border-indigo-500 hover:text-indigo-200"
                            title={`Copy {{${v.key}}}`}
                          >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>
                          <div className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-left text-xs text-slate-300">
                            <span className="font-medium text-slate-200">{v.key || "KEY"}</span>
                            <span className="text-slate-500"> = </span>
                            <span className="text-slate-400">{v.value || "(empty)"}</span>
                            <span className="ml-2 font-mono text-indigo-400">{`{{${v.key}}}`}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditingVarIndex(i)}
                            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-indigo-500 hover:text-indigo-200"
                            title="Edit variable"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, variables: f.variables.filter((_, j) => j !== i) }))}
                            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-rose-300 transition-colors hover:border-rose-500 hover:text-rose-200"
                            title="Remove variable"
                          >
                            ×
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Prompt preview */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-300">Prompt preview</p>
                <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
                  {renderPromptPreview(form.systemPrompt, form.variables, companyConfig, form.assistantName)}
                </div>
              </div>
            </div>
          )}
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

      {/* Test in Console */}
      <Modal
        open={testOpen}
        title={`Test assistant — ${testAssistantKey || ""}`}
        onClose={() => setTestOpen(false)}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setTestOpen(false)}>Close</Button>
            <Button onClick={runTest} disabled={testBusy || !testQuestion.trim()}>
              {testBusy ? <Spinner className="h-3.5 w-3.5" /> : "Run test"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {testError && (
            <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{testError}</div>
          )}
          <Input
            label="Ask a question"
            value={testQuestion}
            onChange={(e) => setTestQuestion(e.target.value)}
            placeholder="e.g. What is ISO 9001?"
            onKeyDown={(e) => { if (e.key === "Enter" && !testBusy) runTest(); }}
            autoFocus
          />
          {testAnswer && (
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <p className="mb-2 text-xs font-medium text-slate-400">Answer</p>
              <div className="whitespace-pre-wrap text-sm text-slate-200">{testAnswer.answer}</div>
              {testAnswer.sources?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {testAnswer.sources.map((s, i) => (
                    <Badge key={i} tone="cyan">{s.title || `Source ${i + 1}`}</Badge>
                  ))}
                </div>
              )}
              {testAnswer.cached && <p className="mt-2 text-[11px] text-slate-500">(cached response)</p>}
            </div>
          )}
        </div>
      </Modal>

      {/* Duplicate assistant */}
      <Modal
        open={duplicateTarget !== null}
        title="Duplicate assistant"
        onClose={() => setDuplicateTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDuplicateTarget(null)}>Cancel</Button>
            <Button onClick={runDuplicate} disabled={dupBusy || !dupKey.trim()}>
              {dupBusy ? <Spinner className="h-3.5 w-3.5" /> : "Duplicate"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            Clone <span className="font-mono text-indigo-300">{duplicateTarget?.assistant_key}</span> with a new key:
          </p>
          <Input
            label="New key *"
            value={dupKey}
            onChange={(e) => setDupKey(e.target.value)}
            placeholder="e.g. sales-bot-v2"
            autoFocus
          />
        </div>
      </Modal>

      <Toast message={toast?.msg} tone={toast?.tone} />
    </div>
  );
}
