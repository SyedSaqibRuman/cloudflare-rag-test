// --------------------------
// CATALOG — DeleteProviderModal (confirmation, with force-delete variant).
// --------------------------
import { Button, Modal, Spinner } from "../../../components/ui";

export function DeleteProviderModal({ provider, busy, force, onClose, onConfirm }) {
  if (!provider) return null;
  return (
    <Modal
      open
      title="Delete Provider"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : force ? "Force Delete Provider" : "Delete Provider"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-300">
        Delete <span className="font-semibold text-slate-100">{provider.providerName || provider.providerKey}</span>{" "}
        <span className="font-mono text-slate-400">({provider.providerKey})</span> from the catalog?
      </p>
      {force ? (
        <p className="mt-2 text-sm text-amber-400">
          Tenant credentials and resources still reference this provider. Force-deleting will{" "}
          <span className="font-semibold">permanently delete those rows</span> — this cannot be undone.
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-500">
          Its models, capabilities, endpoints, and resources are removed, and the key becomes reusable. Deletion is refused if tenant
          credentials or resources still reference this provider.
        </p>
      )}
    </Modal>
  );
}
