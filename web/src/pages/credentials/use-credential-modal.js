// --------------------------
// CREDENTIALS — useCredentialModal
// The credential-actions controller for the provider detail page's
// ConnectionsCard (catalog/connections-card.jsx). It owns the whole lifecycle:
// the add/edit modal (incl. Check Connection + auto-verify), per-credential
// verification, deletion, ROTATION, and per-credential MODEL ACCESS — the
// features that used to live on the standalone Connections page. Callers wire
// their data loading through onChanged and surface the post-save auto-verify
// result through onVerified.
// --------------------------
import { useEffect, useState } from "react";
import {
  createCredential,
  deleteCredential,
  getAuthForm,
  getGatewayCompany,
  grantModelAccess,
  listCredentialModels,
  listProviderModels,
  rotateCredential,
  testCredentialConnection,
  updateCredential,
  verifyCredential,
} from "../../api";
import { slugify } from "./helpers";

/**
 * Add/edit credential modal controller (9Router ConnectionsCard flow).
 * @param {Object} opts
 * @param {string|null} opts.companyKey  gateway tenant the credential belongs to
 * @param {Array} opts.providers         catalog providers for the create-mode
 *                                       select (pass a single-element list to
 *                                       lock the modal to one provider)
 * @param {(msg: string, tone?: string) => void} opts.notify  toast helper
 * @param {() => Promise<void>} [opts.onChanged]  reload credentials after
 *                                       save/verify/delete so the list stays fresh
 * @param {(r: Object) => void} [opts.onVerified]  post-save auto-verify result
 *                                       (e.g. surfaced as a toast)
 * @returns {{
 *   modalProps: Object,   // spread into <CredentialModal>
 *   deleteProps: Object,  // spread into <DeleteCredentialModal>
 *   rotateProps: Object,  // spread into <RotateModal>
 *   modelsProps: Object,  // spread into <ModelsModal>
 *   openAdd: (providerKey?: string) => Promise<void>,
 *   openEdit: (c: Object) => Promise<void>,
 *   verify: (c: Object) => Promise<void>,
 *   openDelete: (c: Object) => void,
 *   openRotate: (c: Object) => Promise<void>,
 *   openModels: (c: Object) => Promise<void>,
 * }}
 */
export function useCredentialModal({ companyKey, providers = [], notify, onChanged, onVerified }) {
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // credential row being edited (null = create mode)
  const [form, setForm] = useState({
    providerKey: "",
    credentialName: "",
    credentialKey: "",
    environmentKey: "",
    isDefault: false,
  });
  const [authForm, setAuthForm] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [keyTouched, setKeyTouched] = useState(false);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Pre-save "Check Connection" (test-before-connect) state.
  const [checkResult, setCheckResult] = useState(null); // null | { status, error, latencyMs }
  const [checkBusy, setCheckBusy] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Environments feed the modal's environment select.
  const [environments, setEnvironments] = useState([]);
  useEffect(() => {
    if (!companyKey) {
      setEnvironments([]);
      return;
    }
    getGatewayCompany(companyKey)
      .then((d) => setEnvironments(d.environments || []))
      .catch(() => setEnvironments([]));
  }, [companyKey]);

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

  // Open the modal with the first provider pre-selected (a controlled <select>
  // whose value matches no option displays the first option WITHOUT firing a
  // change event — leaving providerKey empty).
  const openAdd = async (providerKey) => {
    setFormError(null);
    setFieldValues({});
    setKeyTouched(false);
    setCheckResult(null);
    setCheckBusy(false);
    setEditTarget(null);
    const initial = providerKey || providers[0]?.providerKey || "";
    setForm({
      providerKey: initial,
      credentialName: "",
      credentialKey: "",
      environmentKey: "",
      isDefault: false,
    });
    if (initial) await loadAuthForm(initial);
    setAddOpen(true);
  };

  // Open the same modal prefilled with a credential's values. Provider and
  // credential key are immutable; secret fields are left blank so the stored
  // encrypted values are kept (the backend merges only non-empty fields).
  const openEdit = async (c) => {
    setFormError(null);
    // Prefill the NON-SECRET stored fields (account_id, base_url, …) so the
    // admin sees what's saved; password fields stay blank (server keeps them
    // when left empty).
    setFieldValues(c.fields || {});
    setCheckResult(null);
    setCheckBusy(false);
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
    setCheckResult(null);
    setCheckBusy(false);
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

  const onKey = (v) => {
    setKeyTouched(true);
    setForm((f) => ({ ...f, credentialKey: v }));
  };

  const setField = (name, value) => setFieldValues((v) => ({ ...v, [name]: value }));
  const setEnvironment = (v) => setForm((f) => ({ ...f, environmentKey: v }));
  const setDefault = (v) => setForm((f) => ({ ...f, isDefault: v }));

  // Pre-save connectivity check — validates the UNSAVED fields against the
  // provider's auth schema + live probe (9Router "Check"). No credential is
  // created; nothing is persisted.
  const checkConnection = async () => {
    if (!form.providerKey) return;
    if (!companyKey) {
      setCheckResult({ status: "failed", error: "No company selected — create one on the Companies page, then select it in the sidebar." });
      return;
    }
    setCheckBusy(true);
    setCheckResult(null);
    setFormError(null);
    try {
      const fields = Object.fromEntries(
        Object.entries(fieldValues).filter(([, v]) => String(v).trim() !== "")
      );
      if (!Object.keys(fields).length) throw new Error("Enter at least one credential value first.");
      setCheckResult(await testCredentialConnection(companyKey, { providerKey: form.providerKey, fields }));
    } catch (e) {
      setCheckResult({ status: "failed", error: e.message });
    } finally {
      setCheckBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const isEdit = !!editTarget;
      if (!form.providerKey) throw new Error("Choose a provider.");
      if (!companyKey) throw new Error("No company selected — create one on the Companies page, then select it in the sidebar.");
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
      await onChanged?.();
      // Auto-verify the saved credential and surface the probe result through
      // onVerified (the caller's toast/banner) — nothing is stored here.
      if (credentialId) {
        try {
          const r = await verifyCredential(credentialId);
          onVerified?.({
            credentialId,
            credentialKey: form.credentialKey.trim(),
            status: r.status,
            latencyMs: r.latencyMs,
            error: r.error,
            warning: r.warning,
          });
        } catch (e) {
          onVerified?.({
            credentialId,
            credentialKey: form.credentialKey.trim(),
            status: "failed",
            error: e.message,
          });
        }
      }
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Per-row live probe (the small checkmark button).
  const verify = async (c) => {
    try {
      const r = await verifyCredential(c.id);
      notify(
        r.status === "success"
          ? `${c.credential_name}: verified${r.latencyMs != null ? ` in ${r.latencyMs}ms` : ""}`
          : `${c.credential_name}: ${r.error || "verification failed"}`,
        r.status === "success" ? "green" : "red"
      );
      await onChanged?.();
    } catch (e) {
      notify(`${c.credential_name}: ${e.message}`, "red");
    }
  };

  // -------- rotate ----------------------------------------------------------
  const [rotateTarget, setRotateTarget] = useState(null);
  const [rotateSchema, setRotateSchema] = useState([]);
  const [rotateValues, setRotateValues] = useState({});
  const [rotateError, setRotateError] = useState(null);
  const [rotateSaving, setRotateSaving] = useState(false);

  const openRotate = async (c) => {
    setRotateTarget(c);
    setRotateValues({});
    setRotateError(null);
    try {
      setRotateSchema(await getAuthForm(c.provider_key));
    } catch (e) {
      setRotateError(e.message);
    }
  };

  const doRotate = async () => {
    if (!rotateTarget) return;
    setRotateSaving(true);
    setRotateError(null);
    try {
      const fields = Object.fromEntries(
        Object.entries(rotateValues).filter(([, v]) => String(v).trim() !== "")
      );
      if (!Object.keys(fields).length)
        throw new Error("Enter at least one new value — empty fields keep the current secret.");
      await rotateCredential(rotateTarget.id, { fields, reason: "manual rotation (portal)" });
      setRotateTarget(null);
      notify(`Credential '${rotateTarget.credential_key}' rotated and re-encrypted.`);
      await onChanged?.();
    } catch (e) {
      setRotateError(e.message);
    } finally {
      setRotateSaving(false);
    }
  };

  // -------- model access ----------------------------------------------------
  const [modelsTarget, setModelsTarget] = useState(null);
  const [providerModels, setProviderModels] = useState([]);
  const [grants, setGrants] = useState({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);

  const openModels = async (c) => {
    setModelsTarget(c);
    setProviderModels([]);
    setGrants({});
    setModelsError(null);
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
      setModelsError(e.message);
    }
  };

  const toggleModel = async (m, enabled) => {
    if (!modelsTarget) return;
    setModelsLoading(true);
    setModelsError(null);
    try {
      await grantModelAccess(modelsTarget.id, { modelId: m.id, isEnabled: enabled });
      setGrants((g) => ({
        ...g,
        [m.id]: { provider_model_id: m.id, model_key: m.model_key, is_enabled: enabled },
      }));
      notify(
        enabled
          ? `Granted '${m.model_key}' to ${modelsTarget.credential_key}.`
          : `Revoked '${m.model_key}' from ${modelsTarget.credential_key}.`
      );
    } catch (e) {
      setModelsError(e.message);
    } finally {
      setModelsLoading(false);
    }
  };

  const openDelete = (c) => setDeleteTarget(c);

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await deleteCredential(deleteTarget.id);
      setDeleteTarget(null);
      notify(`Credential '${deleteTarget.credential_key}' deleted.`);
      await onChanged?.();
    } catch (e) {
      notify(`Delete failed: ${e.message}`, "red");
    } finally {
      setDeleteBusy(false);
    }
  };

  return {
    modalProps: {
      open: addOpen,
      editTarget,
      providers,
      authForm,
      fieldValues,
      environments,
      form,
      keyTouched,
      formError,
      saving,
      checkResult,
      checkBusy,
      onCheck: checkConnection,
      onClose: closeAdd,
      onProvider,
      onName,
      onKey,
      setField,
      setEnvironment,
      setDefault,
      onSave: save,
    },
    deleteProps: {
      open: deleteTarget !== null,
      target: deleteTarget,
      busy: deleteBusy,
      onClose: () => setDeleteTarget(null),
      onDelete: remove,
    },
    rotateProps: {
      open: rotateTarget !== null,
      target: rotateTarget,
      schema: rotateSchema,
      values: rotateValues,
      formError: rotateError,
      saving: rotateSaving,
      onClose: () => setRotateTarget(null),
      setField: (name, value) => setRotateValues((v) => ({ ...v, [name]: value })),
      onRotate: doRotate,
    },
    modelsProps: {
      open: modelsTarget !== null,
      target: modelsTarget,
      providerModels,
      grants,
      modelsLoading,
      formError: modelsError,
      onClose: () => setModelsTarget(null),
      onToggle: toggleModel,
    },
    openAdd,
    openEdit,
    verify,
    openDelete,
    openRotate,
    openModels,
  };
}
