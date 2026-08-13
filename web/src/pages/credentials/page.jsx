// --------------------------
// CREDENTIALS — provider credentials page (default export).
// --------------------------
import { useEffect, useState } from "react";
import {
  createCredential,
  createEnvironment,
  createResource,
  deleteCredential,
  deleteEnvironment,
  deleteResource,
  getAuthForm,
  getGatewayCompany,
  getResourceTemplates,
  grantModelAccess,
  listCompanyResources,
  listCredentialModels,
  listCredentials,
  listGatewayCompanies,
  listProviderModels,
  listProviders,
  rotateCredential,
  updateCredential,
  updateResource,
  verifyCredential,
} from "../../api";
import { Button, Empty, Spinner, Toast } from "../../components/ui";
import { useCompanies } from "../../context";
import { useHeaderActions } from "../../components/Layout";
import { resourceSlug, slugify } from "./helpers";
import {
  CredentialModal,
  DeleteCredentialModal,
  DeleteResourceModal,
  ModelsModal,
  ResourceModal,
  RotateModal,
} from "./modals";
import { CredentialsCard, EnvironmentsCard, ResourcesCard } from "./cards";

export default function Credentials() {
  const { company } = useCompanies();
  const [companies, setCompanies] = useState([]);
  const [companyKey, setCompanyKey] = useState("");
  const [detail, setDetail] = useState(null);
  const [providers, setProviders] = useState([]);
  const [creds, setCreds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // credential row being edited (null = create mode)
  const [rotateTarget, setRotateTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [modelsTarget, setModelsTarget] = useState(null);
  const [providerModels, setProviderModels] = useState([]);
  const [grants, setGrants] = useState({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Add-credential modal state
  const [form, setForm] = useState({ providerKey: "", credentialName: "", credentialKey: "", environmentKey: "", isDefault: false });
  const [authForm, setAuthForm] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [keyTouched, setKeyTouched] = useState(false);

  // Rotate modal state
  const [rotateSchema, setRotateSchema] = useState([]);
  const [rotateValues, setRotateValues] = useState({});

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  // Post-save verification probe result (shown inline on the Credentials card).
  const [verifyResult, setVerifyResult] = useState(null); // { credentialId, credentialKey, status, latencyMs, error }
  const [verifyBusy, setVerifyBusy] = useState(false);

  // Environments card state
  const [envForm, setEnvForm] = useState({ envKey: "", envName: "" });
  const [envBusy, setEnvBusy] = useState(false);
  const [envError, setEnvError] = useState(null);

  // Resources card state
  const [resources, setResources] = useState([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourceModal, setResourceModal] = useState(null); // null | { resource, templates } (resource null = create)
  const [resForm, setResForm] = useState({
    providerKey: "",
    credentialId: "",
    resourceType: "",
    resourceName: "",
    resourceKey: "",
    externalResourceId: "",
  });
  const [resConfig, setResConfig] = useState({});
  const [resKeyTouched, setResKeyTouched] = useState(false);
  const [resTemplates, setResTemplates] = useState([]);
  const [resSaving, setResSaving] = useState(false);
  const [resError, setResError] = useState(null);
  const [resDeleteTarget, setResDeleteTarget] = useState(null);
  const [resBusy, setResBusy] = useState(false);

  const notify = (msg, tone = "green") => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 3000);
  };

  const loadCreds = async (key) => {
    if (!key) {
      setCreds([]);
      setDetail(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setVerifyResult(null);
    setVerifyBusy(false);
    try {
      const [d, list] = await Promise.all([getGatewayCompany(key), listCredentials(key)]);
      setDetail(d);
      setCreds(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadResources = async (key) => {
    if (!key) {
      setResources([]);
      return;
    }
    setResourcesLoading(true);
    try {
      setResources(await listCompanyResources(key));
    } catch (e) {
      // The resources list is auxiliary to the page — surface, don't block.
      setError(e.message);
    } finally {
      setResourcesLoading(false);
    }
  };

  // Bootstrap once: gateway companies + provider catalog, then pick the company
  // currently selected in the sidebar when it exists in the gateway.
  useEffect(() => {
    (async () => {
      setError(null);
      try {
        const [cs, ps] = await Promise.all([listGatewayCompanies(), listProviders()]);
        setCompanies(cs);
        setProviders(ps);
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

  // The sidebar dropdown is the single company picker for the portal — keep
  // this page's gateway tenant in sync with it when the selected company
  // exists in the gateway. Otherwise fall back to the first gateway company.
  useEffect(() => {
    if (!company || !companies.length) return;
    if (companies.some((c) => c.company_key === company)) setCompanyKey(company);
  }, [company, companies]);

  useEffect(() => {
    loadCreds(companyKey);
    loadResources(companyKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey]);

  // Open the modal with the first provider pre-selected (a controlled <select>
  // whose value matches no option displays the first option WITHOUT firing a
  // change event — leaving providerKey empty).
  const openAdd = async (providerKey) => {
    setFormError(null);
    setFieldValues({});
    setKeyTouched(false);
    setVerifyResult(null);
    setEditTarget(null);
    const initial = providerKey || providers[0]?.providerKey || "";
    setForm({ providerKey: initial, credentialName: "", credentialKey: "", environmentKey: "", isDefault: false });
    if (initial) await loadAuthForm(initial);
    setAddOpen(true);
  };

  // Open the same modal prefilled with a credential's values. Provider and
  // credential key are immutable; secret fields are left blank so the stored
  // encrypted values are kept (the backend merges only non-empty fields).
  const openEdit = async (c) => {
    setFormError(null);
    setFieldValues({});
    setVerifyResult(null);
    setEditTarget(c);
    setKeyTouched(true); // never let the auto-slug overwrite the immutable key
    setForm({
      providerKey: c.provider_key,
      credentialName: c.credential_name,
      credentialKey: c.credential_key,
      environmentKey: c.env_key || "",
      isDefault: !!c.is_default,
    });
    try {
      setAuthForm(await getAuthForm(c.provider_key));
    } catch (e) {
      setFormError(e.message);
    }
    setAddOpen(true);
  };

  const closeAdd = () => {
    setAddOpen(false);
    setEditTarget(null);
  };

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={() => loadCreds(companyKey)} disabled={loading || !companyKey}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
      <Button onClick={openAdd} disabled={!companyKey}>New Credential</Button>
    </div>
  );

  const loadAuthForm = async (pk) => {
    setAuthForm([]);
    setFieldValues({});
    if (!pk) return;
    try {
      setAuthForm(await getAuthForm(pk));
      setFormError(null);
    } catch (e) {
      setFormError(e.message);
    }
  };

  // -------- environments -----------------------------------------------------

  const saveEnvironment = async () => {
    if (!companyKey) return;
    const envKey = envForm.envKey.trim();
    const envName = envForm.envName.trim();
    if (!envKey || !envName) return;
    setEnvBusy(true);
    setEnvError(null);
    try {
      await createEnvironment(companyKey, { envKey, envName });
      setEnvForm({ envKey: "", envName: "" });
      notify(`Environment '${envKey}' created.`);
      await loadCreds(companyKey);
    } catch (e) {
      setEnvError(e.message);
    } finally {
      setEnvBusy(false);
    }
  };

  const removeEnvironment = async (envKey) => {
    if (!companyKey) return;
    if (!window.confirm(`Delete environment '${envKey}'? Credentials assigned to it will become unassigned.`)) return;
    setEnvBusy(true);
    setEnvError(null);
    try {
      await deleteEnvironment(companyKey, envKey);
      notify(`Environment '${envKey}' deleted.`);
      await loadCreds(companyKey);
    } catch (e) {
      setEnvError(e.message);
    } finally {
      setEnvBusy(false);
    }
  };

  const onProvider = async (pk) => {
    setForm((f) => ({ ...f, providerKey: pk, credentialKey: keyTouched ? f.credentialKey : "" }));
    setKeyTouched(false);
    await loadAuthForm(pk);
  };

  const onName = (v) => {
    setForm((f) => ({
      ...f,
      credentialName: v,
      credentialKey: keyTouched ? f.credentialKey : slugify(v),
    }));
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const isEdit = !!editTarget;
      if (!form.providerKey) throw new Error("Choose a provider.");
      if (!form.credentialName.trim()) throw new Error("Credential name is required.");
      if (!isEdit && !form.credentialKey.trim()) throw new Error("Credential key is required.");
      // In edit mode required-field checks are relaxed — blank fields keep the
      // stored (encrypted) value, so they only apply to fresh credentials.
      if (!isEdit && !authForm.length && !String(fieldValues.api_key || "").trim()) {
        throw new Error("API Key is required.");
      }
      const missing = !isEdit
        ? authForm
            .filter((f) => f.is_required && !String(fieldValues[f.field_name] || "").trim())
            .map((f) => f.field_label)
        : [];
      if (missing.length) throw new Error(`Missing required fields: ${missing.join(", ")}`);
      const fields = Object.fromEntries(
        Object.entries(fieldValues).filter(([, v]) => String(v).trim() !== "")
      );
      // Send environmentKey as-is (not `|| undefined`): the modal's "— none —"
      // option maps to "" and must be able to CLEAR a stored environment in
      // edit mode. Empty string is harmless for create (POST skips it).
      const meta = {
        credentialName: form.credentialName.trim(),
        environmentKey: form.environmentKey,
        isDefault: form.isDefault,
        fields,
      };
      let credentialId;
      if (isEdit) {
        await updateCredential(editTarget.id, meta);
        credentialId = editTarget.id;
        closeAdd();
        notify(`Credential '${form.credentialKey.trim()}' updated.`);
      } else {
        ({ credentialId } = await createCredential(companyKey, {
          ...meta,
          providerKey: form.providerKey,
          credentialKey: form.credentialKey.trim(),
        }));
        closeAdd();
        notify(`Credential '${form.credentialKey.trim()}' created — encrypted at rest.`);
      }
      await loadCreds(companyKey);
      // Auto-verify the saved credential and show the probe result inline.
      if (credentialId) {
        setVerifyBusy(true);
        try {
          const r = await verifyCredential(credentialId);
          setVerifyResult({
            credentialId,
            credentialKey: form.credentialKey.trim(),
            status: r.status,
            latencyMs: r.latencyMs,
            error: r.error,
            warning: r.warning,
          });
        } catch (e) {
          setVerifyResult({
            credentialId,
            credentialKey: form.credentialKey.trim(),
            status: "failed",
            error: e.message,
          });
        } finally {
          setVerifyBusy(false);
        }
      }
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const openRotate = async (c) => {
    setRotateTarget(c);
    setRotateValues({});
    setFormError(null);
    try {
      setRotateSchema(await getAuthForm(c.provider_key));
    } catch (e) {
      setFormError(e.message);
    }
  };

  const doRotate = async () => {
    if (!rotateTarget) return;
    setSaving(true);
    setFormError(null);
    try {
      const fields = Object.fromEntries(
        Object.entries(rotateValues).filter(([, v]) => String(v).trim() !== "")
      );
      if (!Object.keys(fields).length)
        throw new Error("Enter at least one new value — empty fields keep the current secret.");
      await rotateCredential(rotateTarget.id, { fields, reason: "manual rotation (portal)" });
      setRotateTarget(null);
      notify(`Credential '${rotateTarget.credential_key}' rotated and re-encrypted.`);
      await loadCreds(companyKey);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const verify = async (c) => {
    setError(null);
    try {
      const r = await verifyCredential(c.id);
      notify(
        r.status === "success"
          ? `${c.credential_name}: verified${r.latencyMs != null ? ` in ${r.latencyMs}ms` : ""}`
          : `${c.credential_name}: ${r.error || "verification failed"}`,
        r.status === "success" ? "green" : "red"
      );
      await loadCreds(companyKey);
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCredential(deleteTarget.id);
      setDeleteTarget(null);
      notify(`Credential '${deleteTarget.credential_key}' deleted.`);
      await loadCreds(companyKey);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setField = (name, value) => setFieldValues((v) => ({ ...v, [name]: value }));
  const setRotateField = (name, value) => setRotateValues((v) => ({ ...v, [name]: value }));

  const openModels = async (c) => {
    setModelsTarget(c);
    setProviderModels([]);
    setGrants({});
    setFormError(null);
    try {
      const [models, granted] = await Promise.all([
        listProviderModels(c.provider_key),
        listCredentialModels(c.id),
      ]);
      setProviderModels(models);
      const map = {};
      for (const g of granted) map[g.provider_model_id] = g;
      setGrants(map);
    } catch (e) {
      setFormError(e.message);
    }
  };

  const toggleModel = async (m, enabled) => {
    if (!modelsTarget) return;
    setModelsLoading(true);
    setFormError(null);
    try {
      await grantModelAccess(modelsTarget.id, { modelId: m.id, isEnabled: enabled });
      setGrants((g) => ({
        ...g,
        [m.id]: { provider_model_id: m.id, model_key: m.model_key, is_enabled: enabled },
      }));
      notify(enabled ? `Granted '${m.model_key}' to ${modelsTarget.credential_key}.` : `Revoked '${m.model_key}' from ${modelsTarget.credential_key}.`);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setModelsLoading(false);
    }
  };

  // -------- resources --------------------------------------------------------

  // Credentials for the provider selected in the resource form.
  const resProviderCreds = creds.filter((c) => c.provider_key === resForm.providerKey);

  const openResource = async (resource) => {
    setResError(null);
    setResConfig({});
    setResKeyTouched(false);
    if (resource) {
      // Edit: prefill from the existing row (resourceKey/credential immutable).
      const templates = await getResourceTemplates(resource.provider_key);
      setResourceModal({ resource, templates });
      setResTemplates(templates);
      setResForm({
        providerKey: resource.provider_key,
        credentialId: String(resource.credential_id),
        resourceType: resource.resource_type,
        resourceName: resource.resource_name,
        resourceKey: resource.resource_key,
        externalResourceId: resource.external_resource_id || "",
      });
      setResConfig(resource.config && typeof resource.config === "object" ? resource.config : {});
    } else {
      setResourceModal({ resource: null, templates: [] });
      setResTemplates([]);
      setResForm({
        providerKey: "",
        credentialId: "",
        resourceType: "",
        resourceName: "",
        resourceKey: "",
        externalResourceId: "",
      });
    }
  };

  const onResProvider = async (pk) => {
    setResForm((f) => ({
      ...f,
      providerKey: pk,
      credentialId: "",
      resourceType: "",
      resourceName: "",
      resourceKey: "",
    }));
    setResKeyTouched(false);
    setResConfig({});
    setResTemplates([]);
    if (!pk) return;
    try {
      const templates = await getResourceTemplates(pk);
      setResTemplates(templates);
      setResError(null);
    } catch (e) {
      setResError(e.message);
    }
  };

  const onResCredential = (credentialId) => {
    const c = creds.find((x) => String(x.id) === String(credentialId));
    setResForm((f) => ({ ...f, credentialId, resourceType: c?.provider_key ? "" : f.resourceType }));
    setResConfig({});
  };

  const onResType = (t) => {
    setResForm((f) => ({ ...f, resourceType: t }));
    // Prefill config defaults from the template's config_schema.
    const template = resTemplates.find((x) => x.resource_type === t);
    const defaults = {};
    if (template?.config_schema && typeof template.config_schema === "object") {
      for (const [key, spec] of Object.entries(template.config_schema)) {
        if (spec?.default !== undefined) defaults[key] = String(spec.default);
      }
    }
    setResConfig(defaults);
  };

  const onResName = (v) => {
    setResForm((f) => ({
      ...f,
      resourceName: v,
      resourceKey: resKeyTouched ? f.resourceKey : resourceSlug(v),
    }));
  };

  const resTemplate = resTemplates.find((t) => t.resource_type === resForm.resourceType);

  const saveResource = async () => {
    setResSaving(true);
    setResError(null);
    try {
      if (!resForm.providerKey) throw new Error("Choose a provider.");
      if (!resForm.credentialId) throw new Error("Choose a credential.");
      if (!resForm.resourceType) throw new Error("Choose a resource type.");
      if (!resForm.resourceName.trim()) throw new Error("Resource name is required.");
      if (!resForm.resourceKey.trim()) throw new Error("Resource key is required.");
      const missing = Object.entries(resTemplate?.config_schema || {})
        .filter(([k, spec]) => spec?.required && !String(resConfig[k] || "").trim())
        .map(([k, spec]) => spec?.label || k);
      if (missing.length) throw new Error(`Missing required config fields: ${missing.join(", ")}`);
      // Only send config keys with values.
      const config = Object.fromEntries(
        Object.entries(resConfig).filter(([, v]) => String(v).trim() !== "")
      );
      const body = {
        providerKey: resForm.providerKey,
        credentialId: Number(resForm.credentialId),
        resourceType: resForm.resourceType,
        resourceKey: resForm.resourceKey.trim(),
        resourceName: resForm.resourceName.trim(),
        externalResourceId: resForm.externalResourceId.trim() || null,
        config,
      };
      if (resourceModal?.resource) {
        await updateResource(resourceModal.resource.id, {
          resourceName: body.resourceName,
          externalResourceId: body.externalResourceId,
          config: Object.keys(config).length ? config : null,
        });
        notify(`Resource '${body.resourceKey}' updated.`);
      } else {
        await createResource(companyKey, body);
        notify(`Resource '${body.resourceKey}' provisioned.`);
      }
      setResourceModal(null);
      await loadResources(companyKey);
    } catch (e) {
      setResError(e.message);
    } finally {
      setResSaving(false);
    }
  };

  const removeResource = async () => {
    if (!resDeleteTarget) return;
    setResBusy(true);
    setResError(null);
    try {
      await deleteResource(resDeleteTarget.id);
      setResDeleteTarget(null);
      notify(`Resource '${resDeleteTarget.resource_key}' deleted.`);
      await loadResources(companyKey);
    } catch (e) {
      setResError(e.message);
    } finally {
      setResBusy(false);
    }
  };

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

      {companyKey && (
        <EnvironmentsCard
          environments={detail?.environments}
          envBusy={envBusy}
          envError={envError}
          envForm={envForm}
          setEnvForm={setEnvForm}
          onSave={saveEnvironment}
          onRemove={removeEnvironment}
        />
      )}

      <CredentialsCard
        companyKey={companyKey}
        creds={creds}
        providers={providers}
        verifyBusy={verifyBusy}
        verifyResult={verifyResult}
        onAddQuick={openAdd}
        onEdit={openEdit}
        onModels={openModels}
        onVerify={verify}
        onRotate={openRotate}
        onDelete={setDeleteTarget}
      />

      <ResourcesCard
        companyKey={companyKey}
        resources={resources}
        resError={resError}
        canProvision={creds.length > 0}
        onEdit={openResource}
        onDelete={setResDeleteTarget}
        onProvision={() => openResource(null)}
      />

      {/* Provision / edit resource */}
      <ResourceModal
        open={resourceModal !== null}
        resource={resourceModal?.resource}
        providers={providers}
        resProviderCreds={resProviderCreds}
        templates={resTemplates}
        resForm={resForm}
        resConfig={resConfig}
        resKeyTouched={resKeyTouched}
        resError={resError}
        resSaving={resSaving}
        onClose={() => setResourceModal(null)}
        onProvider={onResProvider}
        onCredential={onResCredential}
        onType={onResType}
        onName={(v) => setResForm((f) => ({ ...f, resourceName: v }))}
        onKey={(v) => {
          setResKeyTouched(true);
          setResForm((f) => ({ ...f, resourceKey: v }));
        }}
        onExternalId={(v) => setResForm((f) => ({ ...f, externalResourceId: v }))}
        onConfig={(k, v) => setResConfig((c) => ({ ...c, [k]: v }))}
        onSave={saveResource}
      />

      {/* Delete resource */}
      <DeleteResourceModal
        open={resDeleteTarget !== null}
        target={resDeleteTarget}
        busy={resBusy}
        onClose={() => setResDeleteTarget(null)}
        onDelete={removeResource}
      />

      {/* Add / edit credential */}
      <CredentialModal
        open={addOpen}
        editTarget={editTarget}
        providers={providers}
        authForm={authForm}
        fieldValues={fieldValues}
        environments={detail?.environments}
        form={form}
        keyTouched={keyTouched}
        formError={formError}
        saving={saving}
        onClose={closeAdd}
        onProvider={onProvider}
        onName={onName}
        onKey={(v) => {
          setKeyTouched(true);
          setForm((f) => ({ ...f, credentialKey: v }));
        }}
        setField={setField}
        setEnvironment={(v) => setForm((f) => ({ ...f, environmentKey: v }))}
        setDefault={(v) => setForm((f) => ({ ...f, isDefault: v }))}
        onSave={save}
      />

      {/* Rotate credential */}
      <RotateModal
        open={rotateTarget !== null}
        target={rotateTarget}
        schema={rotateSchema}
        values={rotateValues}
        formError={formError}
        saving={saving}
        onClose={() => setRotateTarget(null)}
        setField={setRotateField}
        onRotate={doRotate}
      />

      {/* Model access */}
      <ModelsModal
        open={modelsTarget !== null}
        target={modelsTarget}
        providerModels={providerModels}
        grants={grants}
        modelsLoading={modelsLoading}
        formError={formError}
        onClose={() => setModelsTarget(null)}
        onToggle={toggleModel}
      />

      {/* Delete credential */}
      <DeleteCredentialModal
        open={deleteTarget !== null}
        target={deleteTarget}
        busy={busy}
        onClose={() => setDeleteTarget(null)}
        onDelete={remove}
      />

      <Toast message={toast?.msg} tone={toast?.tone} />
    </div>
  );
}
