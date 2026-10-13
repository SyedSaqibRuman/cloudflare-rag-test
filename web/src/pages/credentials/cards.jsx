// --------------------------
// CREDENTIALS — company-scoped cards re-surfaced on the provider detail page
// (they used to live on the standalone Connections page): EnvironmentsCard
// (create/delete env keys) and ResourcesCard (provision/edit/delete provider
// resources under a company credential). Both are self-contained: they load
// their own data and only need companyKey + notify (+ providerKey for
// ResourcesCard, which locks provisioning to the current provider).
// --------------------------
import { useEffect, useState } from "react";
import {
  createEnvironment,
  createResource,
  deleteEnvironment,
  deleteResource,
  getGatewayCompany,
  getResourceTemplates,
  listCompanyResources,
  listCredentials,
  updateResource,
} from "../../api";
import { Badge, Button, Card, Empty, IconButton, Input, Spinner, SkeletonText } from "../../components/ui";
import { DeleteResourceModal, ResourceModal } from "./modals";
import { resourceSlug } from "./helpers";

// -------- Environments (per-company) --------
export function EnvironmentsCard({ companyKey, notify }) {
  const [environments, setEnvironments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [envForm, setEnvForm] = useState({ envKey: "", envName: "" });
  const [busy, setBusy] = useState(false);
  const [envError, setEnvError] = useState(null);

  const load = async () => {
    if (!companyKey) {
      setEnvironments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const d = await getGatewayCompany(companyKey);
      setEnvironments(d.environments || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey]);

  const save = async () => {
    const envKey = envForm.envKey.trim();
    const envName = envForm.envName.trim();
    if (!envKey || !envName) return;
    setBusy(true);
    setEnvError(null);
    try {
      await createEnvironment(companyKey, { envKey, envName });
      setEnvForm({ envKey: "", envName: "" });
      notify(`Environment '${envKey}' created.`);
      await load();
    } catch (e) {
      setEnvError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (envKey) => {
    if (!window.confirm(`Delete environment '${envKey}'? Credentials assigned to it will become unassigned.`)) return;
    setBusy(true);
    setEnvError(null);
    try {
      await deleteEnvironment(companyKey, envKey);
      notify(`Environment '${envKey}' deleted.`);
      await load();
    } catch (e) {
      setEnvError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Environments"
      subtitle="Pin credentials to an environment (production, staging, development…); new companies get three by default"
    >
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
      )}
      {loading ? (
        <SkeletonText lines={2} className="py-4" />
      ) : (
        <div className="flex flex-wrap gap-2">
          {environments.map((env) => (
            <div key={env.env_key} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-1.5 text-sm">
              <span className="font-mono text-slate-100">{env.env_key}</span>
              {env.env_name && <span className="text-xs text-slate-500">{env.env_name}</span>}
              <IconButton title={`Delete environment ${env.env_key}`} className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => remove(env.env_key)}>
                <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </IconButton>
            </div>
          ))}
          {environments.length === 0 && <span className="text-sm text-slate-500">No environments yet.</span>}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-4">
        <div className="w-40">
          <Input label="Env key" value={envForm.envKey} onChange={(e) => setEnvForm((f) => ({ ...f, envKey: e.target.value }))} placeholder="staging" />
        </div>
        <div className="w-48">
          <Input label="Env name" value={envForm.envName} onChange={(e) => setEnvForm((f) => ({ ...f, envName: e.target.value }))} placeholder="Staging" />
        </div>
        <Button onClick={save} disabled={busy || !envForm.envKey.trim() || !envForm.envName.trim()}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : "Add Environment"}
        </Button>
      </div>
      {envError && (
        <div role="alert" className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{envError}</div>
      )}
    </Card>
  );
}

// -------- Resources (per-company, provisioned under a credential) --------
export function ResourcesCard({ companyKey, providerKey, providers, notify }) {
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resourceModal, setResourceModal] = useState(null); // null | { resource, templates } (resource null = create)
  const [templates, setTemplates] = useState([]);
  const [creds, setCreds] = useState([]); // company creds for THIS provider (credential dropdown)
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
  const [resError, setResError] = useState(null);
  const [resSaving, setResSaving] = useState(false);
  const [resDeleteTarget, setResDeleteTarget] = useState(null);
  const [resBusy, setResBusy] = useState(false);

  const load = async () => {
    if (!companyKey) {
      setResources([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await listCompanyResources(companyKey);
      // Only this provider's resources — the card lives on its detail page.
      setResources(list.filter((r) => r.provider_key === providerKey));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, providerKey]);

  const openResource = async (resource) => {
    setResError(null);
    setResConfig({});
    setResKeyTouched(false);
    const tpls = await getResourceTemplates(providerKey).catch(() => []);
    setTemplates(tpls);
    if (resource) {
      // Edit: prefill from the existing row (resourceKey/credential immutable).
      setResourceModal({ resource, templates: tpls });
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
      // Create: provider locked to the page's provider; load its credentials.
      setResourceModal({ resource: null, templates: tpls });
      try {
        const list = await listCredentials(companyKey, false);
        setCreds(list.filter((c) => c.provider_key === providerKey));
      } catch (e) {
        setResError(e.message);
      }
      setResForm({
        providerKey,
        credentialId: "",
        resourceType: "",
        resourceName: "",
        resourceKey: "",
        externalResourceId: "",
      });
    }
  };

  const onResCredential = (credentialId) => setResForm((f) => ({ ...f, credentialId }));
  const onResType = (t) => {
    setResForm((f) => ({ ...f, resourceType: t }));
    // Prefill config defaults from the template's config_schema.
    const template = templates.find((x) => x.resource_type === t);
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

  const resTemplate = templates.find((t) => t.resource_type === resForm.resourceType);

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
      await load();
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
      await load();
    } catch (e) {
      setResError(e.message);
    } finally {
      setResBusy(false);
    }
  };

  return (
    <Card
      title="Resources"
      subtitle={`Provisioned infrastructure under this provider's credentials`}
      actions={
        <Button onClick={() => openResource(null)} disabled={!companyKey}>
          Provision Resource
        </Button>
      }
    >
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
      )}
      {loading ? (
        <SkeletonText lines={3} className="py-4" />
      ) : resources.length === 0 ? (
        <Empty message="No resources provisioned for this provider yet — use Provision Resource to create one under a credential." />
      ) : (
        <div className="divide-y divide-slate-800/70">
          {resources.map((r) => (
            <div key={r.id} className="group flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-100">{r.resource_name || r.resource_key}</span>
                  <Badge tone="indigo">{r.resource_type}</Badge>
                  <Badge>{r.credential_name ? `via ${r.credential_name}` : ""}</Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono">{r.resource_key}</span>
                  {r.external_resource_id && <span className="truncate">{r.external_resource_id}</span>}
                  {r.status && <Badge tone={r.status === "provisioned" ? "green" : "slate"}>{r.status}</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton title={`Edit resource ${r.resource_key}`} onClick={() => openResource(r)}>
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </IconButton>
                <IconButton title={`Delete resource ${r.resource_key}`} className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => setResDeleteTarget(r)}>
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <ResourceModal
        open={resourceModal !== null}
        resource={resourceModal?.resource}
        providers={providers.filter((p) => p.providerKey === providerKey)}
        resProviderCreds={creds}
        templates={templates}
        resForm={resForm}
        resConfig={resConfig}
        resKeyTouched={resKeyTouched}
        resError={resError}
        resSaving={resSaving}
        onClose={() => setResourceModal(null)}
        onProvider={(pk) => setResForm((f) => ({ ...f, providerKey: pk }))}
        onCredential={onResCredential}
        onType={onResType}
        onName={onResName}
        onKey={(v) => {
          setResKeyTouched(true);
          setResForm((f) => ({ ...f, resourceKey: v }));
        }}
        onExternalId={(v) => setResForm((f) => ({ ...f, externalResourceId: v }))}
        onConfig={(k, v) => setResConfig((c) => ({ ...c, [k]: v }))}
        onSave={saveResource}
      />
      <DeleteResourceModal
        open={resDeleteTarget !== null}
        target={resDeleteTarget}
        busy={resBusy}
        onClose={() => setResDeleteTarget(null)}
        onDelete={removeResource}
      />
    </Card>
  );
}
