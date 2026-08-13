// --------------------------
// CATALOG WIZARD — step components (presentational).
// Each step receives its slice of wizard state + the setters it needs; all
// validation/draft logic stays in the container (wizard.jsx). Extracted so
// the wizard file is just the stateful shell.
// --------------------------
import { Badge, Button, IconButton, Input, Select } from "../../../components/ui";
import {
  AUTH_FIELD_TYPES,
  AUTH_TYPES,
  CATEGORIES,
  FIELD_GROUPS,
  FIELD_WIDTHS,
  HTTP_METHODS,
  RESOURCE_TYPES,
} from "../constants";
import { IconPencil, IconTrash } from "../icons";
import { OverviewItem } from "../components";
import { emptyEndpoint, emptyField, emptyResource } from "./helpers";
import { InlineEditor } from "./inline-editor";
import { endpointKeyFromName, resourceTypeFromName } from "../utils";

// ---------- Step 1: Basics ----------
export function Step1Basics({ form, isEdit, keyTouched, onName, set, setKeyTouched }) {
  return (
    <div className="space-y-3">
      <Input
        label="Provider name *"
        placeholder="e.g. Cloudflare Workers AI"
        value={form.providerName}
        onChange={(e) => onName(e.target.value)}
        autoFocus
      />
      <div>
        <Input
          label="Provider key *"
          placeholder="auto-generated from the name"
          value={form.providerKey}
          disabled={isEdit}
          onChange={(e) => {
            setKeyTouched(true);
            set("providerKey", e.target.value);
          }}
          error={
            !isEdit &&
            form.providerKey &&
            !/^[a-z0-9_]+$/.test(form.providerKey)
              ? "Lowercase letters, numbers, and underscores only (3–50 chars)."
              : !isEdit && form.providerKey.length > 0 && form.providerKey.length < 3
                ? "Must be at least 3 characters."
                : undefined
          }
        />
        <p className="mt-1.5 text-[11px] text-slate-500">
          {isEdit
            ? "Provider key is the route identity and cannot be changed."
            : keyTouched
              ? "Manual value — auto-sync from the name is off."
              : "Auto-generated from the name (lowercase, spaces → _)."}{" "}
          Used as the stable identifier.
        </p>
      </div>
      <Select label="Service category *" options={CATEGORIES} value={form.category} onChange={(e) => set("category", e.target.value)} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Website URL (optional)" placeholder="https://example.com" value={form.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} />
        <Input label="Docs URL (optional)" placeholder="https://docs.example.com" value={form.documentationUrl} onChange={(e) => set("documentationUrl", e.target.value)} />
      </div>
      <Input label="Logo URL (optional)" placeholder="https://example.com/logo.png" value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} />
    </div>
  );
}

// ---------- Step 2: Auth defaults ----------
export function Step2Auth({ auth, setAuthField }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Defaults stored on the provider row — credential form behavior comes from the fields in the next step.</p>
      <Select label="Auth type *" options={AUTH_TYPES} value={auth.authType} onChange={(e) => setAuthField("authType", e.target.value)} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Auth header name" placeholder="Authorization" value={auth.authHeaderName} onChange={(e) => setAuthField("authHeaderName", e.target.value)} />
        <Input label="Default API base URL (optional)" placeholder="https://api.example.com/v1" value={auth.defaultApiBaseUrl} onChange={(e) => setAuthField("defaultApiBaseUrl", e.target.value)} />
      </div>
      <Input
        label="API key format regex (optional)"
        placeholder="^[A-Za-z0-9_-]{40}$"
        value={auth.apiKeyFormatRegex}
        onChange={(e) => setAuthField("apiKeyFormatRegex", e.target.value)}
        error={
          auth.apiKeyFormatRegex.trim()
            ? (() => {
                try {
                  new RegExp(auth.apiKeyFormatRegex);
                  return undefined;
                } catch {
                  return "Invalid regular expression.";
                }
              })()
            : undefined
        }
      />
    </div>
  );
}

// ---------- Step 3: Credential form fields ----------
export function Step3Fields({
  fields,
  fieldEditor,
  setFieldEditor,
  saveField,
  removeField,
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        These fields define the credential form end users see when connecting this provider (provider_auth_schemas — one row per field).
      </p>
      {fields.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
          No fields yet — add at least one (e.g. an API key) so the Credentials page can collect it.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">field_name</th>
                <th className="px-3 py-2 font-medium">field_label</th>
                <th className="px-3 py-2 font-medium">type</th>
                <th className="px-3 py-2 font-medium">req?</th>
                <th className="px-3 py-2 font-medium">enc?</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-xs text-slate-300">
              {fields.map((f, i) => (
                <tr key={i} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2 font-mono">{f.name || "—"}</td>
                  <td className="px-3 py-2">{f.label || "—"}</td>
                  <td className="px-3 py-2"><Badge tone="slate">{f.type}</Badge></td>
                  <td className="px-3 py-2">{f.required ? <Badge tone="indigo">✓</Badge> : "—"}</td>
                  <td className="px-3 py-2">{f.encrypted ? <Badge tone="green">✓</Badge> : "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton title="Edit field" onClick={() => setFieldEditor({ index: i, draft: { ...f } })}><IconPencil /></IconButton>
                      <IconButton title="Remove field" className="hover:text-rose-300" onClick={() => removeField(i)}><IconTrash /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setFieldEditor({ index: -1, draft: emptyField(fields.length) })}>
        + Add field
      </Button>
      {fieldEditor && (
        <InlineEditor
          title={fieldEditor.index === -1 ? "Add field" : `Edit #${fieldEditor.index + 1}`}
          onSave={saveField}
          onCancel={() => setFieldEditor(null)}
          fields={[
            <Input key="name" label="Field name *" placeholder="api_key" value={fieldEditor.draft.name} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, name: e.target.value } }))} />,
            <Input key="label" label="Field label *" placeholder="API Key" value={fieldEditor.draft.label} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, label: e.target.value } }))} />,
            <Select key="type" label="Field type *" options={AUTH_FIELD_TYPES} value={fieldEditor.draft.type} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, type: e.target.value } }))} />,
            <Input key="placeholder" label="Placeholder (optional)" placeholder="Paste your API token" value={fieldEditor.draft.placeholder} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, placeholder: e.target.value } }))} />,
            <Input key="helpText" label="Help text (optional)" value={fieldEditor.draft.helpText} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, helpText: e.target.value } }))} />,
            <Input key="regex" label="Validation regex (optional)" value={fieldEditor.draft.validationRegex} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, validationRegex: e.target.value } }))} />,
            <Input key="storagePath" label="Storage path (in blob)" placeholder="same as field name" value={fieldEditor.draft.storagePath} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, storagePath: e.target.value } }))} />,
            fieldEditor.index !== -1 &&
              (() => {
                // Editing an existing field: warn when the effective storage
                // path (storage path, or the field name when blank) would
                // change — stored credential values are keyed by that path,
                // so a rename orphans them unless the path is pinned.
                const original = fields[fieldEditor.index];
                const originalPath = ((original?.storagePath || "").trim() || (original?.name || "").trim()) || null;
                const newPath = (fieldEditor.draft.storagePath.trim() || fieldEditor.draft.name.trim()) || null;
                if (!originalPath || newPath === originalPath) return null;
                return (
                  <div key="storagePathWarn" className="sm:col-span-2">
                    <p className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-300">
                      ⚠ Renaming this field changes where values are stored — saved credentials keyed by{" "}
                      <span className="font-mono text-indigo-100">{originalPath}</span> will be orphaned. Set the storage path to{" "}
                      <span className="font-mono text-indigo-100">{originalPath}</span> to keep them accessible.
                    </p>
                  </div>
                );
              })(),
            <Input key="order" label="Display order" type="number" value={fieldEditor.draft.displayOrder} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, displayOrder: e.target.value } }))} />,
            <Select key="group" label="Field group" options={FIELD_GROUPS} value={fieldEditor.draft.group} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, group: e.target.value } }))} />,
            <Select key="width" label="Field width" options={FIELD_WIDTHS} value={fieldEditor.draft.width} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, width: e.target.value } }))} />,
            fieldEditor.draft.type === "select" ? (
              <div key="selectOptions" className="sm:col-span-2">
                <Input label="Select options (JSON array of { value, label })" value={fieldEditor.draft.selectOptions} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, selectOptions: e.target.value } }))} placeholder='[{"value":"us-east-1","label":"US East"}]' />
              </div>
            ) : null,
            <label key="flags" className="flex items-center gap-5 text-sm text-slate-300 sm:col-span-2">
              <span className="flex items-center gap-2">
                <input type="checkbox" name="fieldRequired" checked={fieldEditor.draft.required} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, required: e.target.checked } }))} className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500" />
                Required
              </span>
              <span className="flex items-center gap-2">
                <input type="checkbox" name="fieldEncrypted" checked={fieldEditor.draft.encrypted} onChange={(e) => setFieldEditor((ed) => ({ ...ed, draft: { ...ed.draft, encrypted: e.target.checked } }))} className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500" />
                Encrypted at rest
              </span>
            </label>,
          ]}
        />
      )}
    </div>
  );
}

// ---------- Step 4: Endpoints & resource types ----------
export function Step4Endpoints({
  endpoints,
  resources,
  endpointEditor,
  resourceEditor,
  setEndpointEditor,
  setResourceEditor,
  saveEndpoint,
  removeEndpoint,
  saveResource,
  removeResource,
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-200">Endpoints</h3>
          <span className="text-xs text-slate-500">(provider_endpoints)</span>
          <div className="h-px flex-1 bg-slate-800" />
          <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setEndpointEditor({ index: -1, draft: emptyEndpoint(endpoints.length), keyAuto: true })}>+ Add endpoint</Button>
        </div>
        {endpoints.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 px-3 py-3 text-center text-xs text-slate-500">No endpoints yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">endpoint_key</th>
                  <th className="px-3 py-2 font-medium">method</th>
                  <th className="px-3 py-2 font-medium">endpoint_url</th>
                  <th className="px-3 py-2 font-medium">default</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs text-slate-300">
                {endpoints.map((e, i) => (
                  <tr key={i} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                    <td className="px-3 py-2 font-mono">{e.key || "—"}</td>
                    <td className="px-3 py-2"><Badge tone="slate">{e.method}</Badge></td>
                    <td className="max-w-[260px] truncate px-3 py-2 font-mono text-slate-400">{e.url || "—"}</td>
                    <td className="px-3 py-2">{e.isDefault ? <Badge tone="indigo">default</Badge> : "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton title="Edit endpoint" onClick={() => setEndpointEditor({ index: i, draft: { ...e }, keyAuto: false })}><IconPencil /></IconButton>
                        <IconButton title="Remove endpoint" className="hover:text-rose-300" onClick={() => removeEndpoint(i)}><IconTrash /></IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {endpointEditor && (
          <InlineEditor
            title={endpointEditor.index === -1 ? "Add endpoint" : `Edit #${endpointEditor.index + 1}`}
            onSave={saveEndpoint}
            onCancel={() => setEndpointEditor(null)}
            fields={[
              <Input
                key="name"
                label="Name *"
                placeholder="Chat Completions"
                value={endpointEditor.draft.name}
                onChange={(e) =>
                  setEndpointEditor((ed) => ({
                    ...ed,
                    draft: {
                      ...ed.draft,
                      name: e.target.value,
                      ...(ed.keyAuto !== false ? { key: endpointKeyFromName(e.target.value) } : {}),
                    },
                  }))
                }
              />,
              <div key="key">
                <Input
                  label="Endpoint key *"
                  placeholder="auto-generated from the name"
                  value={endpointEditor.draft.key}
                  onChange={(e) => setEndpointEditor((ed) => ({ ...ed, draft: { ...ed.draft, key: e.target.value }, keyAuto: false }))}
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {endpointEditor.index !== -1
                    ? "Existing endpoint key — kept as-is when you rename."
                    : endpointEditor.keyAuto === false
                      ? "Manual value — auto-sync from the name is off."
                      : "Auto-generated from the name (lowercase, spaces → -)."}{" "}
                  Used as the unique endpoint identifier.
                </p>
              </div>,
              <Select key="method" label="HTTP method" options={HTTP_METHODS} value={endpointEditor.draft.method} onChange={(e) => setEndpointEditor((ed) => ({ ...ed, draft: { ...ed.draft, method: e.target.value } }))} />,
              <Input key="timeout" label="Timeout (seconds)" type="number" min={1} max={3600} value={endpointEditor.draft.timeoutSeconds} onChange={(e) => setEndpointEditor((ed) => ({ ...ed, draft: { ...ed.draft, timeoutSeconds: e.target.value } }))} />,
              <div key="url" className="sm:col-span-2">
                <Input label="Endpoint URL *" placeholder="https://api.example.com/v1/chat/completions" value={endpointEditor.draft.url} onChange={(e) => setEndpointEditor((ed) => ({ ...ed, draft: { ...ed.draft, url: e.target.value } }))} />
              </div>,
              <label key="default" className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" name="endpointIsDefault" checked={endpointEditor.draft.isDefault} onChange={(e) => setEndpointEditor((ed) => ({ ...ed, draft: { ...ed.draft, isDefault: e.target.checked } }))} className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500" />
                Default endpoint for this provider
              </label>,
            ]}
          />
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-200">Resource Types</h3>
          <span className="text-xs text-slate-500">(provider_resource_types)</span>
          <div className="h-px flex-1 bg-slate-800" />
          <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setResourceEditor({ index: -1, draft: emptyResource(resources.length), keyAuto: true })}>+ Add resource type</Button>
        </div>
        {resources.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 px-3 py-3 text-center text-xs text-slate-500">No resource types yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">resource_type</th>
                  <th className="px-3 py-2 font-medium">display_name</th>
                  <th className="px-3 py-2 font-medium">required</th>
                  <th className="px-3 py-2 font-medium">max/credential</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs text-slate-300">
                {resources.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                    <td className="px-3 py-2 font-mono">{r.type}</td>
                    <td className="px-3 py-2">{r.displayName || "—"}</td>
                    <td className="px-3 py-2">{r.required ? <Badge tone="indigo">✓</Badge> : "—"}</td>
                    <td className="px-3 py-2">{r.maxPerCredential || "unlimited"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton title="Edit resource type" onClick={() => setResourceEditor({ index: i, draft: { ...r }, keyAuto: false })}><IconPencil /></IconButton>
                        <IconButton title="Remove resource type" className="hover:text-rose-300" onClick={() => removeResource(i)}><IconTrash /></IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {resourceEditor && (
          <InlineEditor
            title={resourceEditor.index === -1 ? "Add resource type" : `Edit #${resourceEditor.index + 1}`}
            onSave={saveResource}
            onCancel={() => setResourceEditor(null)}
            fields={[
              <Input
                key="displayName"
                label="Display name *"
                placeholder="Vectorize Index"
                value={resourceEditor.draft.displayName}
                onChange={(e) => {
                  const matched = resourceTypeFromName(e.target.value);
                  setResourceEditor((ed) => ({
                    ...ed,
                    draft: {
                      ...ed.draft,
                      displayName: e.target.value,
                      ...(ed.keyAuto !== false && matched ? { type: matched } : {}),
                    },
                  }));
                }}
              />,
              <div key="type">
                <Select
                  label="Resource type *"
                  options={RESOURCE_TYPES}
                  value={resourceEditor.draft.type}
                  onChange={(e) => setResourceEditor((ed) => ({ ...ed, draft: { ...ed.draft, type: e.target.value }, keyAuto: false }))}
                />
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {resourceEditor.index !== -1
                    ? "Existing resource type — kept as-is when you rename."
                    : resourceEditor.keyAuto === false
                      ? "Manual selection — auto-match from the display name is off."
                      : "Auto-matched from the display name (e.g. \"Vectorize Index\" → vector_index)."}
                </p>
              </div>,
              <div key="description" className="sm:col-span-2">
                <Input label="Description (optional)" placeholder="Serverless vector database" value={resourceEditor.draft.description} onChange={(e) => setResourceEditor((ed) => ({ ...ed, draft: { ...ed.draft, description: e.target.value } }))} />
              </div>,
              <Input key="max" label="Max per credential (optional)" type="number" min={1} placeholder="unlimited" value={resourceEditor.draft.maxPerCredential} onChange={(e) => setResourceEditor((ed) => ({ ...ed, draft: { ...ed.draft, maxPerCredential: e.target.value } }))} />,
              <label key="required" className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" name="resourceRequired" checked={resourceEditor.draft.required} onChange={(e) => setResourceEditor((ed) => ({ ...ed, draft: { ...ed.draft, required: e.target.checked } }))} className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-indigo-500" />
                Required for every credential
              </label>,
            ]}
          />
        )}
      </div>
    </div>
  );
}

// ---------- Step 5: Review ----------
export function Step5Review({ form, auth, fields, endpoints, resources, isEdit }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <OverviewItem term="provider_key" desc={form.providerKey.trim()} mono />
          <OverviewItem term="provider_name" desc={form.providerName.trim()} mono />
          <OverviewItem term="category" desc={form.category} mono />
          <OverviewItem term="auth_type" desc={auth.authType} mono />
        </dl>
      </div>
      <div className="space-y-1.5 text-sm text-slate-300">
        <p><span className="font-mono text-xs text-slate-500">auth fields ({fields.length})</span> — {fields.length ? fields.map((f, i) => `${f.name}${f.required ? "*" : ""}`).join(", ") : <span className="text-amber-400">none — add at least one so the Credentials page can collect a key</span>}</p>
        <p><span className="font-mono text-xs text-slate-500">endpoints ({endpoints.length})</span> — {endpoints.length ? endpoints.map((e, i) => `${e.key}${e.isDefault ? " [default]" : ""}`).join(", ") : "none"}</p>
        <p><span className="font-mono text-xs text-slate-500">resource types ({resources.length})</span> — {resources.length ? resources.map((r) => r.type).join(", ") : "none"}</p>
      </div>
      {!isEdit && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/15 px-4 py-3">
          <svg
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-300">No models attached</p>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-300">
              Add provider_models afterward from the provider detail page - the catalog card will
              show a model count of 0 until then.
            </p>
          </div>
        </div>
      )}
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {isEdit ? "This will refresh" : "This will upsert"}
        </p>
        <ul className="space-y-1 font-mono text-xs text-slate-400">
          <li>1 row → providers</li>
          <li>{fields.length} row{fields.length === 1 ? "" : "s"} → provider_auth_schemas</li>
          <li>{endpoints.length} row{endpoints.length === 1 ? "" : "s"} → provider_endpoints</li>
          <li>{resources.length} row{resources.length === 1 ? "" : "s"} → provider_resource_types</li>
        </ul>
        <p className="mt-2 text-[11px] text-slate-500">
          {isEdit
            ? "In one transaction through the catalog importer — the auth fields, endpoints, and resource types above replace the provider's current set; rows you removed are deleted. Capabilities and models are never touched."
            : "In one transaction through the catalog importer — existing rows (same key) are refreshed, never duplicated."}
        </p>
      </div>
    </div>
  );
}
