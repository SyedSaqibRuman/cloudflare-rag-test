// --------------------------
// VECTOR RESOURCES CARD — live infrastructure CRUD on the provider detail page
// for the non-Cloudflare vector stores (Qdrant / Pinecone / Weaviate). Same
// shape as cloudflare-resources-card.jsx: the list is a LIVE read from the
// store's own API through the company's saved connection, and Create/Delete act
// on the real cluster (a Qdrant collection, a Pinecone index, a Weaviate class).
//
// Creating a store ALSO registers it as a vector_index resource on the server,
// so it appears in the KB wizard's Vector Store dropdown — the generic
// Resources card below stays the place to register/tune pre-existing stores.
// --------------------------
import { useEffect, useState } from "react";
import { createVectorResource, deleteVectorResource, listVectorResources } from "../../api";
import { Badge, Button, Card, Empty, IconButton, Input, Select, Spinner, SkeletonText } from "../../components/ui";
import { formatDate } from "../../util";
import { VECTOR_PROVIDER_META, vectorNameError } from "./vector-providers.js";

export function VectorResourcesCard({ companyKey, providerKey, notify, onResourceChange }) {
  const meta = VECTOR_PROVIDER_META[providerKey];
  const [state, setState] = useState({ loading: true, error: null, resources: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ name: "", config: {} });
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(null);

  const load = async () => {
    if (!companyKey || !meta) {
      setState({ loading: false, error: null, resources: [] });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const resources = await listVectorResources(companyKey, providerKey);
      setState({ loading: false, error: null, resources });
    } catch (e) {
      setState({ loading: false, error: e.message, resources: [] });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, providerKey]);

  if (!meta) return null;

  const openCreate = () => {
    setForm({
      name: "",
      config: Object.fromEntries((meta.configFields || []).map((f) => [f.key, f.defaultValue ?? ""])),
    });
    setModalOpen(true);
  };

  const create = async () => {
    const name = form.name.trim();
    if (!name || busy || vectorNameError(providerKey, name)) return;
    setBusy(true);
    try {
      const d = await createVectorResource(companyKey, providerKey, { name, config: form.config });
      notify(d.message || `${meta.singular} '${name}' created.`);
      setModalOpen(false);
      await load();
      // The registry Resources card lists the row the server just created.
      onResourceChange?.();
    } catch (e) {
      notify(e.message, "red");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (resource) => {
    if (
      !window.confirm(
        `Delete ${meta.singular} '${resource.name}'? This drops the live store and everything in it, and unregisters it from this company. This cannot be undone.`
      )
    )
      return;
    setDeleteBusy(resource.name);
    try {
      const d = await deleteVectorResource(companyKey, providerKey, resource.name);
      notify(d.message || `${meta.singular} '${resource.name}' deleted.`);
      await load();
      onResourceChange?.();
    } catch (e) {
      notify(e.message, "red");
    } finally {
      setDeleteBusy(null);
    }
  };

  return (
    <>
      <Card
        title={meta.label}
        subtitle={`${state.resources.length} on the connected ${meta.singular.split(" ").slice(-1)[0]} store`}
        actions={
          <Button onClick={openCreate} disabled={!companyKey}>
            {meta.createLabel}
          </Button>
        }
      >
        {state.error ? (
          <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {state.error}
          </div>
        ) : state.loading ? (
          <SkeletonText lines={2} className="py-4" />
        ) : state.resources.length === 0 ? (
          <Empty message={meta.empty} />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2 font-medium">Name</th>
                  {meta.columns.map(([, label]) => (
                    <th key={label} className="pb-2 font-medium">{label}</th>
                  ))}
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {state.resources.map((r) => (
                  <tr key={r.name} className="text-slate-300 hover:bg-slate-800/40">
                    <td className="py-2.5 font-medium text-slate-100">{r.name}</td>
                    {meta.columns.map(([key]) => (
                      <td key={key} className="py-2.5">
                        {key === "status" && r[key] ? (
                          <Badge tone={r[key] === "ready" ? "green" : "cyan"}>{r[key]}</Badge>
                        ) : key === "distance" || key === "metric" ? (
                          r[key] ? <Badge tone="cyan">{r[key]}</Badge> : "—"
                        ) : (
                          r[key] ?? "—"
                        )}
                      </td>
                    ))}
                    <td className="py-2.5">{r.createdAt ? formatDate(r.createdAt) : "—"}</td>
                    <td className="py-2.5">
                      <div className="flex items-center justify-end">
                        <IconButton
                          title={`Delete ${r.name}`}
                          className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          onClick={() => remove(r)}
                          disabled={deleteBusy === r.name}
                        >
                          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          </svg>
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

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[10vh]" onClick={() => (busy ? null : setModalOpen(false))}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 font-semibold text-slate-100">{meta.createLabel}</h3>
            <Input
              label="Name"
              placeholder={meta.namePlaceholder}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              error={vectorNameError(providerKey, form.name.trim())}
            />
            {(meta.configFields || []).map((f) => (
              <div key={f.key} className="mt-3">
                {f.type === "select" ? (
                  <Select
                    label={f.label}
                    options={f.options.map((o) => ({ value: o, label: o }))}
                    value={form.config[f.key] ?? ""}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, config: { ...s.config, [f.key]: e.target.value } }))
                    }
                  />
                ) : (
                  <Input
                    label={f.label}
                    type={f.type || "text"}
                    placeholder={f.placeholder}
                    value={form.config[f.key] ?? ""}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, config: { ...s.config, [f.key]: e.target.value } }))
                    }
                  />
                )}
              </div>
            ))}
            <p className="mt-3 text-xs text-slate-500">
              Dimensions must match your embedding model, or upserts will fail.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={busy}>Cancel</Button>
              <Button
                onClick={create}
                disabled={busy || !form.name.trim() || Boolean(vectorNameError(providerKey, form.name.trim()))}
              >
                {busy ? <Spinner className="h-3.5 w-3.5" /> : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

