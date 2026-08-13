// --------------------------
// CREDENTIALS — card components (presentational). Each card receives its data
// + callbacks from page.jsx (the stateful shell). Extracted so the page file
// stays readable and each card is a single-responsibility component.
// --------------------------
import { Badge, Button, Card, Empty, IconButton, Input, Spinner } from "../../components/ui";
import { timeAgo } from "../../util";
import { statusBadge } from "./fields";
import { IconCheck, IconGrid, IconPencil, IconRotate, IconTrash } from "./icons";

// -------- Environments card --------
export function EnvironmentsCard({
  environments,
  envBusy,
  envError,
  envForm,
  setEnvForm,
  onSave,
  onRemove,
}) {
  return (
    <Card
      title="Environments"
      subtitle="Credentials can be pinned to an environment (production, staging, development…); new companies get these three by default"
    >
      {envError && (
        <div role="alert" className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{envError}</div>
      )}
      {environments?.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {environments.map((e) => (
            <span
              key={e.env_key}
              className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
            >
              <span className={`h-2 w-2 rounded-full ${e.is_production ? "bg-emerald-400" : "bg-sky-400"}`} />
              <span className="font-medium">{e.env_name}</span>
              <span className="font-mono text-slate-500">{e.env_key}</span>
              <button
                type="button"
                onClick={() => onRemove(e.env_key)}
                disabled={envBusy}
                className="ml-1 text-slate-500 transition-colors hover:text-rose-300"
                title={`Delete ${e.env_key}`}
              >
                <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      ) : (
        <Empty message="No environments yet — create one below or in the gateway API." />
      )}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Input
          label="Key"
          placeholder="e.g. sandbox"
          value={envForm.envKey}
          onChange={(e) => setEnvForm((f) => ({ ...f, envKey: e.target.value }))}
          className="w-40"
        />
        <Input
          label="Name"
          placeholder="e.g. Sandbox"
          value={envForm.envName}
          onChange={(e) => setEnvForm((f) => ({ ...f, envName: e.target.value }))}
          className="w-56"
        />
        <Button variant="secondary" onClick={onSave} disabled={envBusy || !envForm.envKey.trim() || !envForm.envName.trim()}>
          {envBusy ? <Spinner className="h-3.5 w-3.5" /> : "Add environment"}
        </Button>
      </div>
    </Card>
  );
}

// -------- Credentials card --------
export function CredentialsCard({
  companyKey,
  creds,
  providers,
  verifyBusy,
  verifyResult,
  onAddQuick,
  onEdit,
  onModels,
  onVerify,
  onRotate,
  onDelete,
}) {
  return (
    <Card
      title={`Credentials${companyKey ? ` — ${companyKey}` : ""}`}
      subtitle={`${creds.length} credential${creds.length === 1 ? "" : "s"} — keys are encrypted at rest and values are never returned by the API`}
    >
      {(verifyBusy || verifyResult) && (
        <div
          key={verifyResult ? `${verifyResult.credentialId}-${verifyResult.status}-${verifyResult.latencyMs ?? ""}` : "busy"}
          role={verifyResult?.status === "failed" ? "alert" : "status"}
          className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${
            verifyBusy
              ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
              : verifyResult?.status === "success"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/40 bg-rose-500/10 text-rose-300"
          }`}
        >
          {verifyBusy ? (
            <>
              <Spinner className="h-3.5 w-3.5" />
              Verifying credential '{verifyResult?.credentialKey || ""}'…
            </>
          ) : verifyResult?.status === "success" ? (
            <>
              <IconCheck />
              <span>
                Credential '<span className="font-semibold">{verifyResult.credentialKey}</span>' verified
                {verifyResult.latencyMs != null ? ` in ${verifyResult.latencyMs}ms` : ""}
                {verifyResult.warning ? ` — ${verifyResult.warning}` : ""}.
              </span>
            </>
          ) : (
            <>
              <span aria-hidden="true">⚠️</span>
              <span>
                Credential '<span className="font-semibold">{verifyResult?.credentialKey}</span>' verification failed
                {verifyResult?.error ? `: ${verifyResult.error}` : "."}
              </span>
            </>
          )}
        </div>
      )}
      {creds.length === 0 ? (
        <div className="space-y-4">
          <Empty message="No credentials yet. Add a provider and its API key — the key unlocks that provider's models." />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Quick start:</span>
            {["openai", "anthropic", "cloudflare"].map((pk) => {
              const p = providers.find((x) => x.providerKey === pk);
              return p ? (
                <Button key={pk} variant="secondary" onClick={() => onAddQuick(pk)}>
                  Add {p.providerName}
                </Button>
              ) : null;
            })}
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-3 font-medium">Provider</th>
                <th className="pb-3 font-medium">Credential</th>
                <th className="pb-3 font-medium">Environment</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium">Default</th>
                <th className="pb-3 font-medium">Priority</th>
                <th className="pb-3 font-medium">Last verified</th>
                <th className="pb-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {creds.map((c) => (
                <tr key={c.id} className="text-slate-300 hover:bg-slate-800/40">
                  <td className="py-3">
                    <span className="font-medium text-slate-100">{c.provider_name}</span>
                    <div className="font-mono text-xs text-slate-500">{c.provider_key}</div>
                  </td>
                  <td className="py-3">
                    <span className="text-slate-200">{c.credential_name}</span>
                    <div className="font-mono text-xs text-slate-500">{c.credential_key}</div>
                  </td>
                  <td className="py-3">{c.env_key ? <Badge tone="cyan">{c.env_key}</Badge> : "—"}</td>
                  <td className="py-3">{statusBadge(c)}</td>
                  <td className="py-3">{c.is_default ? <Badge tone="indigo">default</Badge> : "—"}</td>
                  <td className="py-3 tabular-nums">{c.priority ?? "—"}</td>
                  <td className="py-3 text-xs text-slate-500">{timeAgo(c.last_verified_at)}</td>
                  <td className="py-3">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton title="Edit credential" onClick={() => onEdit(c)}><IconPencil /></IconButton>
                      <IconButton title="Model access" onClick={() => onModels(c)}><IconGrid /></IconButton>
                      <IconButton title="Verify credential" onClick={() => onVerify(c)}><IconCheck /></IconButton>
                      <IconButton title="Rotate credential" onClick={() => onRotate(c)}><IconRotate /></IconButton>
                      <IconButton title="Delete credential" className="hover:text-rose-300" onClick={() => onDelete(c)}><IconTrash /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// -------- Resources card --------
export function ResourcesCard({
  companyKey,
  resources,
  resError,
  canProvision = true,
  onEdit,
  onDelete,
  onProvision,
}) {
  return (
    <Card
      title={`Resources${companyKey ? ` — ${companyKey}` : ""}`}
      subtitle={`${resources.length} resource${resources.length === 1 ? "" : "s"} — vector indexes, buckets, and databases provisioned under a credential (Phase D)`}
    >
      {resError && (
        <div role="alert" className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{resError}</div>
      )}
      {resources.length === 0 ? (
        <div className="space-y-4">
          <Empty message="No resources yet. Provision a vector index or storage bucket under a credential — knowledge bases bind to these." />
          <Button variant="secondary" onClick={onProvision} disabled={!canProvision}>
            Provision resource
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-3 font-medium">Resource</th>
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">Credential</th>
                  <th className="pb-3 font-medium">Env</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {resources.map((r) => (
                  <tr key={r.id} className="text-slate-300 hover:bg-slate-800/40">
                    <td className="py-3">
                      <span className="font-medium text-slate-100">{r.resource_name}</span>
                      <div className="font-mono text-xs text-slate-500">{r.resource_key}</div>
                    </td>
                    <td className="py-3"><Badge tone="cyan">{r.resource_type}</Badge></td>
                    <td className="py-3">
                      <span className="text-slate-200">{r.credential_name}</span>
                      <div className="font-mono text-xs text-slate-500">{r.provider_key}</div>
                    </td>
                    <td className="py-3">{r.env_key ? <Badge tone="cyan">{r.env_key}</Badge> : "—"}</td>
                    <td className="py-3">
                      {r.status === "active" ? <Badge tone="green">active</Badge> : <Badge tone="amber">{r.status}</Badge>}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton title="Edit resource" onClick={() => onEdit(r)}><IconPencil /></IconButton>
                        <IconButton title="Delete resource" className="hover:text-rose-300" onClick={() => onDelete(r)}><IconTrash /></IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button variant="secondary" onClick={onProvision} disabled={!canProvision}>
            Provision resource
          </Button>
        </div>
      )}
    </Card>
  );
}
