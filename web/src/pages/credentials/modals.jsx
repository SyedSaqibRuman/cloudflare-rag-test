// --------------------------
// CREDENTIALS — modal components (presentational). Each modal receives its
// slice of page state + callbacks; all data loading and handlers stay in
// page.jsx. Extracted so the page file is just the stateful shell + cards.
// --------------------------
import { Button, Empty, Input, Modal, Select, Spinner } from "../../components/ui";
import { AuthFields, ResourceConfigFields } from "./fields";

// -------- Add / edit credential --------
export function CredentialModal({
  open,
  editTarget,
  providers,
  authForm,
  fieldValues,
  environments,
  form,
  keyTouched,
  formError,
  saving,
  onClose,
  onProvider,
  onName,
  onKey,
  setField,
  setEnvironment,
  setDefault,
  onSave,
}) {
  return (
    <Modal
      open={open}
      title={editTarget ? "Edit credential" : "Add credential"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Spinner className="h-3.5 w-3.5" /> : editTarget ? "Save changes" : "Save credential"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</div>
        )}
        <Select
          label="Provider *"
          options={[
            { value: "", label: "— select a provider —" },
            ...providers.map((p) => ({ value: p.providerKey, label: p.providerName })),
          ]}
          value={form.providerKey}
          disabled={!!editTarget}
          onChange={(e) => onProvider(e.target.value)}
        />
        {editTarget && (
          <p className="-mt-2 text-[11px] text-slate-500">Provider cannot be changed after creation.</p>
        )}
        <Input
          label="Credential name *"
          value={form.credentialName}
          onChange={(e) => onName(e.target.value)}
          placeholder="e.g. OpenAI main key"
          autoFocus
        />
        <div>
          <Input
            label="Credential key *"
            value={form.credentialKey}
            disabled={!!editTarget}
            onChange={(e) => onKey(e.target.value)}
            placeholder="auto-generated from the name"
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            {editTarget
              ? "Credential key is immutable."
              : keyTouched
                ? "Manual value — type in the name field to re-sync it."
                : "Auto-generated from the name (lowercase, spaces → _)."}
          </p>
        </div>
        {environments?.length > 0 && (
          <Select
            label="Environment"
            options={[{ value: "", label: "— none —" }, ...environments.map((e) => ({ value: e.env_key, label: e.env_key }))]}
            value={form.environmentKey}
            onChange={(e) => setEnvironment(e.target.value)}
          />
        )}
        {editTarget && authForm.length > 0 && (
          <p className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-300">
            Secret values are stored encrypted and never shown. Leave a field blank to keep its stored value;
            entering a value replaces it (this re-encrypts the credential).
          </p>
        )}
        <AuthFields schema={authForm} values={fieldValues} onChange={setField} />
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => setDefault(e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500"
          />
          Default credential for this provider
        </label>
      </div>
    </Modal>
  );
}

// -------- Rotate credential --------
export function RotateModal({
  open,
  target,
  schema,
  values,
  formError,
  saving,
  onClose,
  setField,
  onRotate,
}) {
  return (
    <Modal
      open={open}
      title={`Rotate credential — ${target?.credential_key || ""}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onRotate} disabled={saving}>
            {saving ? <Spinner className="h-3.5 w-3.5" /> : "Rotate & re-encrypt"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</div>
        )}
        <p className="text-xs text-slate-500">
          Enter the new secret(s). Fields you leave empty keep their current (encrypted) value.
        </p>
        <AuthFields schema={schema} values={values} onChange={setField} />
      </div>
    </Modal>
  );
}

// -------- Model access --------
export function ModelsModal({
  open,
  target,
  providerModels,
  grants,
  modelsLoading,
  formError,
  onClose,
  onToggle,
}) {
  return (
    <Modal
      open={open}
      title={`Model access — ${target?.credential_key || ""}`}
      onClose={onClose}
    >
      <div className="space-y-3">
        {formError && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{formError}</div>
        )}
        {providerModels.length === 0 ? (
          <Empty message="This provider has no models in the catalog yet." />
        ) : (
          providerModels.map((m) => {
            const on = grants[m.id] ? grants[m.id].is_enabled : false;
            return (
              <label
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-slate-100">{m.model_name}</span>
                  <span className="block font-mono text-xs text-slate-500">
                    {m.model_key} · {m.category}
                    {m.max_context_window ? ` · ${Math.round(m.max_context_window / 1000)}k ctx` : ""}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={modelsLoading}
                  onChange={(e) => onToggle(m, e.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-950 accent-indigo-500"
                />
              </label>
            );
          })
        )}
      </div>
    </Modal>
  );
}

// -------- Delete credential --------
export function DeleteCredentialModal({ open, target, busy, onClose, onDelete }) {
  return (
    <Modal
      open={open}
      title="Delete credential"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={onDelete} disabled={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : "Delete"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-300">
        Delete credential <span className="font-mono text-rose-300">{target?.credential_key}</span> for{" "}
        <span className="font-medium text-slate-100">{target?.provider_name}</span>? This soft-deletes
        the row and it can no longer be resolved.
      </p>
    </Modal>
  );
}

// -------- Provision / edit resource --------
export function ResourceModal({
  open,
  resource,
  providers,
  resProviderCreds,
  templates,
  resForm,
  resConfig,
  resKeyTouched,
  resError,
  resSaving,
  onClose,
  onProvider,
  onCredential,
  onType,
  onName,
  onKey,
  onExternalId,
  onConfig,
  onSave,
}) {
  const resTemplate = templates.find((t) => t.resource_type === resForm.resourceType);
  return (
    <Modal
      open={open}
      title={resource ? `Edit resource — ${resource.resource_key}` : "Provision resource"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} disabled={resSaving}>
            {resSaving ? <Spinner className="h-3.5 w-3.5" /> : resource ? "Save changes" : "Provision"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {resError && (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{resError}</div>
        )}
        {!resource && (
          <Select
            label="Provider *"
            options={[
              { value: "", label: "— select a provider —" },
              ...providers.map((p) => ({ value: p.providerKey, label: p.providerName })),
            ]}
            value={resForm.providerKey}
            onChange={(e) => onProvider(e.target.value)}
          />
        )}
        <Select
          label="Credential *"
          disabled={!!resource}
          options={[
            { value: "", label: "— select a credential —" },
            ...resProviderCreds.map((c) => ({ value: String(c.id), label: `${c.credential_name} (${c.provider_key})` })),
          ]}
          value={resForm.credentialId}
          onChange={(e) => onCredential(e.target.value)}
        />
        <Select
          label="Resource type *"
          disabled={!!resource}
          options={[
            { value: "", label: "— select a type —" },
            ...templates.map((t) => ({ value: t.resource_type, label: t.display_name || t.resource_type })),
          ]}
          value={resForm.resourceType}
          onChange={(e) => onType(e.target.value)}
        />
        <div>
          <Input
            label="Resource name *"
            value={resForm.resourceName}
            onChange={(e) => onName(e.target.value)}
            placeholder="e.g. PopularCert Documents"
            autoFocus={!resource}
          />
          {!resource && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              {resKeyTouched
                ? "Manual key — type in the name field to re-sync it."
                : "Key auto-generates from the name (lowercase, spaces → -)."}
            </p>
          )}
        </div>
        {!resource && (
          <div>
            <Input
              label="Resource key *"
              value={resForm.resourceKey}
              onChange={(e) => onKey(e.target.value)}
              placeholder="auto-generated from the name"
            />
          </div>
        )}
        <Input
          label="External resource id (optional)"
          value={resForm.externalResourceId}
          onChange={(e) => onExternalId(e.target.value)}
          placeholder="e.g. the provider-side index / bucket name"
        />
        {resTemplate?.config_schema && (
          <ResourceConfigFields
            schema={resTemplate.config_schema}
            values={resConfig}
            onChange={(k, v) => onConfig(k, v)}
          />
        )}
        {templates.length === 0 && !resource && resForm.providerKey && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            This provider advertises no resource templates yet — the resource type is free-form via the API.
          </p>
        )}
      </div>
    </Modal>
  );
}

// -------- Delete resource --------
export function DeleteResourceModal({ open, target, busy, onClose, onDelete }) {
  return (
    <Modal
      open={open}
      title="Delete resource"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={onDelete} disabled={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : "Delete"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-300">
        Delete resource <span className="font-mono text-rose-300">{target?.resource_key}</span> ({" "}
        <span className="text-slate-100">{target?.resource_name}</span>)? This soft-deletes the
        row so it can no longer be resolved or bound to a knowledge base.
      </p>
    </Modal>
  );
}
