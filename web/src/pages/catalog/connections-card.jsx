// --------------------------
// CATALOG — ConnectionsCard (9Router ConnectionsCard equivalent).
// Self-contained card for the provider detail page: lists every credential of
// the selected company for this provider, with add/edit/delete, per-row verify
// (live probe), and an enable/disable toggle. The add/edit modal form
// lifecycle lives in the shared useCredentialModal hook
// (../credentials/use-credential-modal.js) — this card just wires it to its
// own data loading + toasts.
// --------------------------
import { useEffect, useState } from "react";
import { listCredentials, updateCredential, updateProvider } from "../../api";
import { Badge, Button, Card, Empty, IconButton, Toggle, SkeletonText } from "../../components/ui";
import { CredentialModal, DeleteCredentialModal, ModelsModal, RotateModal } from "../credentials/modals";
import { useCredentialModal } from "../credentials/use-credential-modal";

// Credential status → badge (verified / error / untested / disabled).
function statusBadge(c) {
  if (!c.is_active) return <Badge tone="slate">disabled</Badge>;
  if (c.last_verification_status === "success") return <Badge tone="green">verified</Badge>;
  if (c.last_verification_status === "failed") return <Badge tone="red">error</Badge>;
  return <Badge tone="slate">untested</Badge>;
}

export function ConnectionsCard({ providerKey, companyKey, providers, notify, provider, onProviderChanged }) {
  const [creds, setCreds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    if (!companyKey) {
      setCreds([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // includeStored returns NON-SECRET stored fields (account_id, base_url,
      // …) so the edit form can prefill them; password values stay hidden.
      const list = await listCredentials(companyKey, true, true);
      setCreds(list.filter((c) => c.provider_key === providerKey));
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

  // Shared add/edit modal (useCredentialModal). The provider select is locked
  // by passing a single-element providers list; the post-save auto-verify
  // result surfaces as a toast.
  const credModal = useCredentialModal({
    companyKey,
    providers: providers.filter((p) => p.providerKey === providerKey),
    notify,
    onChanged: load,
    onVerified: async (r) => {
      notify(
        r.status === "success"
          ? `Verified${r.latencyMs != null ? ` in ${r.latencyMs}ms` : ""}.`
          : `Verification failed: ${r.error || "unknown error"}`,
        r.status === "success" ? "green" : "red"
      );
      await load();
    },
  });

  const toggleActive = async (c, isActive) => {
    setCreds((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_active: isActive } : x)));
    try {
      await updateCredential(c.id, { isActive });
    } catch (e) {
      setError(e.message);
      await load();
    }
  };

  // 9Router Round Robin: rotate chat traffic across this provider's active
  // credentials. Persisted on the providers row via PUT (catalog-level
  // switch, company-agnostic); the executor honors it when resolving a
  // credential for a company.
  const [roundRobinBusy, setRoundRobinBusy] = useState(false);
  const roundRobin = !!provider?.roundRobinEnabled;
  const toggleRoundRobin = async () => {
    if (roundRobinBusy) return;
    setRoundRobinBusy(true);
    setError(null);
    try {
      await updateProvider(providerKey, { roundRobinEnabled: !roundRobin });
      await onProviderChanged?.();
      notify(roundRobin ? "Round Robin disabled — default credential wins." : "Round Robin enabled — traffic rotates across connections.");
    } catch (e) {
      setError(e.message);
    } finally {
      setRoundRobinBusy(false);
    }
  };

  return (
    <Card
      title="Connections"
      subtitle={`${creds.length} connection${creds.length === 1 ? "" : "s"}`}
      actions={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Rotate chat traffic across this provider's active connections">
            Round Robin
            <Toggle checked={roundRobin} onChange={toggleRoundRobin} disabled={roundRobinBusy} title="Toggle round robin" />
          </label>
          <Button
            onClick={() => credModal.openAdd()}
            disabled={!companyKey}
            title={companyKey ? "Add a connection for this provider" : "Select or create a company first to add a connection"}
          >
            Add Connection
          </Button>
        </div>
      }
    >
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
      )}
      {loading ? (
        <SkeletonText lines={2} className="py-4" />
      ) : creds.length === 0 ? (
        <Empty
          message={
            companyKey
              ? "No connections for this provider yet — add one to use it with this company."
              : "No company selected — create one on the Companies page, then select it in the sidebar to add connections."
          }
        />
      ) : (
        <div className="divide-y divide-slate-800/70">
          {creds.map((c) => (
            <div key={c.id} className="group flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-950/40">
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden="true" className="text-slate-500">🔑</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">{c.credential_name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                    {statusBadge(c)}
                    {c.env_key && <span className="text-slate-500">{c.env_key}</span>}
                    {c.is_default && <Badge tone="indigo">default</Badge>}
                    {c.is_active && c.last_verification_status === "failed" && c.verification_error && (
                      <span className="max-w-[300px] truncate text-rose-400" title={c.verification_error}>{c.verification_error}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton title={`Verify ${c.credential_key}`} onClick={() => credModal.verify(c)}>
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 3h6M10 3v3.5a2 2 0 0 1-.6 1.4L4.6 12.7A2 2 0 0 0 4 14.1V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.9a2 2 0 0 0-.6-1.4l-4.4-4.8A2 2 0 0 1 14 6.5V3" />
                    <path d="M8.5 14.5 11 17l4.5-5" />
                  </svg>
                </IconButton>
                <IconButton title={`Edit ${c.credential_key}`} onClick={() => credModal.openEdit(c)}>
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </IconButton>
                <IconButton title={`Model access — ${c.credential_key}`} onClick={() => credModal.openModels(c)}>
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                </IconButton>
                <IconButton title={`Rotate ${c.credential_key}`} onClick={() => credModal.openRotate(c)}>
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                </IconButton>
                <IconButton title={`Delete ${c.credential_key}`} className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10" onClick={() => credModal.openDelete(c)}>
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </IconButton>
                <div className="ml-1 pl-1 border-l border-slate-800">
                  <Toggle checked={!!c.is_active} onChange={(v) => toggleActive(c, v)} title={c.is_active ? "Disable credential" : "Enable credential"} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CredentialModal {...credModal.modalProps} />
      <DeleteCredentialModal {...credModal.deleteProps} />
      <RotateModal {...credModal.rotateProps} />
      <ModelsModal {...credModal.modelsProps} />
    </Card>
  );
}
