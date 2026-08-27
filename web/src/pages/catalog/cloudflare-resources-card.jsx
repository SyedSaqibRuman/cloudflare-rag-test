// --------------------------
// CLOUDFLARE RESOURCES CARD — live infrastructure CRUD on the provider detail
// page (cloudflare family). Unlike the generic Resources card (registry rows),
// this one actually creates/deletes resources on the Cloudflare account via
// the gateway endpoints, using the company's saved Cloudflare connection:
//   vector_index  → Vectorize indexes
//   object_bucket → R2 buckets
//   sql_database  → D1 databases
//   kv_namespace  → KV namespaces
// Which types show depends on the provider: the umbrella `cloudflare` gets
// all four; cloudflare_vectorize/r2/d1 get their own type.
// --------------------------
import { useEffect, useState } from "react";
import { RESOURCE_NAME_RE } from "#shared/patterns.js";
import {
  createCloudflareResource,
  deleteCloudflareResource,
  listCloudflareResources,
} from "../../api";
import { Badge, Button, Card, Empty, IconButton, Input, Select, Spinner, SkeletonText } from "../../components/ui";
import { formatDate } from "../../util";

// Which resource types each cloudflare-family provider manages.
const TYPES_BY_PROVIDER = {
  cloudflare: ["vector_index", "object_bucket", "sql_database", "kv_namespace"],
  cloudflare_vectorize: ["vector_index"],
  cloudflare_r2: ["object_bucket"],
  cloudflare_d1: ["sql_database"],
};

const TYPES = {
  vector_index: {
    label: "Vector Indexes",
    createLabel: "Create Index",
    namePlaceholder: "e.g. acme-embeddings",
    empty: "No vector indexes found.",
    locationLabel: null,
    columns: [
      ["dimensions", "Dimensions"],
      ["metric", "Metric"],
      ["vectorCount", "Vectors"],
    ],
    configFields: [
      { key: "dimensions", label: "Dimensions", type: "number", placeholder: "768", defaultValue: "768" },
      {
        key: "metric",
        label: "Metric",
        type: "select",
        options: ["cosine", "euclidean", "dot_product"],
        defaultValue: "cosine",
      },
    ],
  },
  object_bucket: {
    label: "R2 Buckets",
    createLabel: "Create Bucket",
    namePlaceholder: "e.g. acme-chunks",
    empty: "No R2 buckets found.",
    locationLabel: "Location",
    columns: [["location", "Location"]],
    configFields: [
      {
        key: "locationHint",
        label: "Location hint (optional)",
        type: "select",
        options: ["", "WEUR", "ENAM", "WNAM", "APAC", "OC", "ME", "SAM"],
        defaultValue: "",
      },
    ],
  },
  sql_database: {
    label: "D1 Databases",
    createLabel: "Create Database",
    namePlaceholder: "e.g. acme-analytics",
    empty: "No D1 databases found.",
    locationLabel: "Region",
    columns: [
      ["region", "Region"],
      ["numTables", "Tables"],
    ],
    configFields: [
      {
        key: "locationHint",
        label: "Primary location hint (optional)",
        type: "select",
        options: ["", "weur", "wnam", "enam", "apac", "oc", "me", "sam"],
        defaultValue: "",
      },
    ],
  },
  kv_namespace: {
    label: "KV Namespaces",
    createLabel: "Create Namespace",
    namePlaceholder: "e.g. acme-config",
    empty: "No KV namespaces found.",
    locationLabel: null,
    columns: [],
    configFields: [],
  },
};

export function CloudflareResourcesCard({ companyKey, providerKey, notify }) {
  const types = TYPES_BY_PROVIDER[providerKey] || ["vector_index", "object_bucket", "sql_database", "kv_namespace"];
  const [data, setData] = useState(() =>
    Object.fromEntries(types.map((t) => [t, { loading: true, error: null, resources: [] }]))
  );
  const [modal, setModal] = useState(null); // { type } | null
  const [form, setForm] = useState({ name: "", config: {} });
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(null); // `${type}:${id}` while deleting

  const loadType = async (type) => {
    if (!companyKey) {
      setData((d) => ({ ...d, [type]: { loading: false, error: null, resources: [] } }));
      return;
    }
    setData((d) => ({ ...d, [type]: { ...d[type], loading: true, error: null } }));
    try {
      const resources = await listCloudflareResources(companyKey, type);
      setData((d) => ({ ...d, [type]: { loading: false, error: null, resources } }));
    } catch (e) {
      setData((d) => ({ ...d, [type]: { loading: false, error: e.message, resources: [] } }));
    }
  };

  useEffect(() => {
    types.forEach((t) => loadType(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, providerKey]);

  const openCreate = (type) => {
    setForm({
      name: "",
      config: Object.fromEntries((TYPES[type].configFields || []).map((f) => [f.key, f.defaultValue ?? ""])),
    });
    setModal({ type });
  };

  const create = async () => {
    const type = modal.type;
    const name = form.name.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await createCloudflareResource(companyKey, type, {
        name,
        providerKey,
        config: form.config,
      });
      notify(`${TYPES[type].label.slice(0, -1)} '${name}' created.`);
      setModal(null);
      await loadType(type);
    } catch (e) {
      notify(e.message, "red");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (type, resource) => {
    const id = resource.id;
    if (!window.confirm(`Delete ${TYPES[type].label.slice(0, -1).toLowerCase()} '${resource.name}'? This cannot be undone.`)) return;
    setDeleteBusy(`${type}:${id}`);
    try {
      await deleteCloudflareResource(companyKey, type, id);
      notify(`${TYPES[type].label.slice(0, -1)} '${resource.name}' deleted.`);
      await loadType(type);
    } catch (e) {
      notify(e.message, "red");
    } finally {
      setDeleteBusy(null);
    }
  };

  return (
    <>
      {types.map((type) => {
        const meta = TYPES[type];
        const state = data[type] || { loading: true, error: null, resources: [] };
        return (
          <Card
            key={type}
            title={meta.label}
            subtitle={`${state.resources.length} ${meta.label.toLowerCase()} on the connected Cloudflare account`}
            actions={
              <Button onClick={() => openCreate(type)} disabled={!companyKey}>
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
              <div className="overflow-x-auto -mx-5 px-5">
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
                      <tr key={r.id} className="text-slate-300 hover:bg-slate-800/40">
                        <td className="py-2.5 font-medium text-slate-100">{r.name}</td>
                        {meta.columns.map(([key]) => (
                          <td key={key} className="py-2.5">
                            {key === "location" || key === "region" ? (
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
                              onClick={() => remove(type, r)}
                              disabled={deleteBusy === `${type}:${r.id}`}
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
        );
      })}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-3 pt-[10vh]" onClick={() => setModal(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 font-semibold text-slate-100">
              {TYPES[modal.type].createLabel}
            </h3>
            <Input
              label="Resource name"
              placeholder={TYPES[modal.type].namePlaceholder}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              error={
                form.name && !RESOURCE_NAME_RE.test(form.name)
                  ? "Lowercase letters, numbers, hyphens, underscores (3–63 chars)."
                  : undefined
              }
            />
            {(TYPES[modal.type].configFields || []).map((f) => (
              <div key={f.key} className="mt-3">
                {f.type === "select" ? (
                  <Select
                    label={f.label}
                    options={f.options.map((o) => (o ? { value: o, label: o } : { value: "", label: "Default" }))}
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
            {modal.type === "vector_index" && (
              <p className="mt-3 text-xs text-slate-500">
                Dimensions must match your embedding model, or upserts will fail.
              </p>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={create} disabled={busy || !form.name.trim() || !RESOURCE_NAME_RE.test(form.name.trim())}>
                {busy ? <Spinner className="h-3.5 w-3.5" /> : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
