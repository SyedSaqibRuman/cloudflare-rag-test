import { useState } from "react";
import { api } from "../api";
import { Card, Button, Input, Badge, Empty, Spinner, Modal, IconButton, Toast } from "../components/ui";
import { useCompanies } from "../context";
import { usePoll } from "../hooks";
import { useHeaderActions } from "../components/Layout";
import { formatDate } from "../util";

function ModalForm({ open, title, placeholder, confirmLabel, onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name.trim());
      setName("");
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || busy}>
            {busy ? <Spinner className="h-3.5 w-3.5" /> : confirmLabel}
          </Button>
        </>
      }
    >
      <Input
        label="Resource name"
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={
          name && !/^[a-z0-9-]+$/.test(name)
            ? "Lowercase letters, numbers, and hyphens only (3–63 chars)."
            : undefined
        }
      />
      {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}
    </Modal>
  );
}

export default function Cloudflare() {
  const { company } = useCompanies();
  const [indexes, setIndexes] = useState([]);
  const [buckets, setBuckets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [createIndex, setCreateIndex] = useState(false);
  const [createBucket, setCreateBucket] = useState(false);
  const [busyName, setBusyName] = useState(null);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    setError(null);
    if (!company) {
      setIndexes([]);
      setBuckets([]);
      setLoading(false);
      return;
    }
    try {
      const [i, b] = await Promise.all([api("/cloudflare/indexes", { company }), api("/cloudflare/buckets", { company })]);
      setIndexes(i.indexes || []);
      setBuckets(b.buckets || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  usePoll(load, 15000, [company]);

  const handleCreateIndex = async (name) => {
    await api("/cloudflare/indexes", { method: "POST", body: { name }, company });
    notify(`Index '${name}' ready.`);
  };

  const handleCreateBucket = async (name) => {
    await api("/cloudflare/buckets", { method: "POST", body: { name }, company });
    notify(`Bucket '${name}' ready.`);
  };

  const deleteIndex = async (name) => {
    if (!window.confirm(`Delete vector index '${name}'?`)) return;
    setBusyName(name);
    setError(null);
    try {
      await api(`/cloudflare/indexes/${encodeURIComponent(name)}`, { method: "DELETE", company });
      await load();
      notify(`Index '${name}' deleted.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyName(null);
    }
  };

  const deleteBucket = async (name) => {
    if (!window.confirm(`Delete bucket '${name}' and all its contents?`)) return;
    setBusyName(name);
    setError(null);
    try {
      await api(`/cloudflare/buckets/${encodeURIComponent(name)}`, { method: "DELETE", company });
      await load();
      notify(`Bucket '${name}' deleted.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyName(null);
    }
  };

  const clearBucket = async (name) => {
    if (!window.confirm(`Clear all objects from bucket '${name}'?`)) return;
    setBusyName(name);
    setError(null);
    try {
      await api(`/cloudflare/buckets/${encodeURIComponent(name)}/clear`, { method: "POST", company });
      notify(`Bucket '${name}' cleared.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyName(null);
    }
  };

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={load} disabled={loading}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {!company ? (
        <Card>
          <div className="py-10 text-center text-sm text-slate-500">
            Select a company in the sidebar to view its Cloudflare resources.
          </div>
        </Card>
      ) : (
      <>
      <Card
        title="Vector Indexes"
        subtitle={`${indexes.length} indexes`}
        actions={<Button onClick={() => setCreateIndex(true)}>Create Index</Button>}
      >
        {indexes.length === 0 ? (
          <Empty message={loading ? "Loading…" : "No vector indexes found."} />
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Dimensions</th>
                  <th className="pb-2 font-medium">Vectors</th>
                  <th className="pb-2 font-medium">Metric</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {indexes.map((idx) => (
                  <tr key={idx.name} className="text-slate-300 hover:bg-slate-800/40">
                    <td className="py-2.5 font-medium text-slate-100">{idx.name}</td>
                    <td className="py-2.5">{idx.dimensions ?? "—"}</td>
                    <td className="py-2.5">{idx.vectorCount ?? idx.count ?? "—"}</td>
                    <td className="py-2.5">{idx.metric ?? "—"}</td>
                    <td className="py-2.5">{formatDate(idx.created_on ?? idx.createdOn)}</td>
                    <td className="py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton
                          title={`Delete ${idx.name}`}
                          className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          onClick={() => deleteIndex(idx.name)}
                          disabled={busyName === idx.name}
                        >
                          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="R2 Buckets"
        subtitle={`${buckets.length} buckets`}
        actions={<Button onClick={() => setCreateBucket(true)}>Create Bucket</Button>}
      >
        {buckets.length === 0 ? (
          <Empty message={loading ? "Loading…" : "No R2 buckets found."} />
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Location</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {buckets.map((b) => (
                  <tr key={b.name} className="text-slate-300 hover:bg-slate-800/40">
                    <td className="py-2.5 font-medium text-slate-100">{b.name}</td>
                    <td className="py-2.5">
                      {b.location ? <Badge tone="cyan">{b.location}</Badge> : "—"}
                    </td>
                    <td className="py-2.5">{formatDate(b.creation_date ?? b.creationDate)}</td>
                    <td className="py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title={`Clear ${b.name}`}
                          aria-label={`Clear ${b.name}`}
                          onClick={() => clearBucket(b.name)}
                          disabled={busyName === b.name}
                          className="inline-flex h-7 items-center gap-1.5 rounded-lg border-0 px-2.5 text-xs text-slate-500 transition-all hover:bg-amber-500/10 hover:text-amber-600 disabled:pointer-events-none disabled:opacity-40"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                          Clear
                        </button>
                        <IconButton
                          title={`Delete ${b.name}`}
                          className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          onClick={() => deleteBucket(b.name)}
                          disabled={busyName === b.name}
                        >
                          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </>

      )}

      <ModalForm
        open={createIndex}
        title="Create Vector Index"
        placeholder="e.g. acme-knowledge"
        confirmLabel="Create"
        onClose={() => setCreateIndex(false)}
        onSubmit={handleCreateIndex}
      />
      <ModalForm
        open={createBucket}
        title="Create R2 Bucket"
        placeholder="e.g. acme-chunks"
        confirmLabel="Create"
        onClose={() => setCreateBucket(false)}
        onSubmit={handleCreateBucket}
      />

      <Toast message={toast} />
    </div>
  );
}
