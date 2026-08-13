import { useState } from "react";
import { listKbs, deleteKb } from "../api";
import { Card, Button, Badge, Empty, Spinner } from "../components/ui";
import { usePoll } from "../hooks";
import { useHeaderActions } from "../components/Layout";
import { useCompanies } from "../context";
import KbModal from "../components/kb-modal";

const statusTone = (s) =>
  ({ active: "green", indexing: "amber", error: "red", archived: "slate" })[s] || "slate";

export default function KbList({ navigate }) {
  const { company } = useCompanies();
  const [kbs, setKbs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    if (!company) return;
    setError(null);
    try {
      setKbs(await listKbs(company));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  usePoll(load, 30000, [company]);

  useHeaderActions(
    <div className="flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={load} disabled={loading || !company}>
        {loading ? <Spinner className="h-3.5 w-3.5" /> : "Refresh"}
      </Button>
      <Button onClick={() => setCreateOpen(true)} disabled={!company}>+ Create KB</Button>
    </div>
  );

  if (!company) {
    return <Empty message="Select a company to manage its knowledge bases." />;
  }

  const remove = async (kb) => {
    if (!window.confirm(`Delete knowledge base '${kb.kb_key}'? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteKb(kb.kb_key, company);
      notify(`Deleted '${kb.kb_key}'.`);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <Card
        title="Knowledge Bases"
        subtitle={`${kbs.length} KB${kbs.length === 1 ? "" : "s"} for ${company} — ingestion settings and live status`}
      >
        {kbs.length === 0 && !loading ? (
          <Empty message="No knowledge bases yet. Create one to bind a RAG corpus (index, storage, chunking) to this company." />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Key</th>
                  <th className="pb-2 font-medium">Embedding model</th>
                  <th className="pb-2 font-medium">Vector index</th>
                  <th className="pb-2 font-medium">Chunk size</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {kbs.map((kb) => (
                  <tr key={kb.id} className="border-t border-slate-800/70">
                    <td className="py-2.5 pr-4 font-medium text-slate-100">{kb.kb_name}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-400">{kb.kb_key}</td>
                    <td className="py-2.5 pr-4 text-slate-300">
                      {kb.embedding_model_name || <span className="text-slate-500">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-300">
                      {kb.vector_external_id || kb.vector_resource_name || (
                        <span className="text-slate-500">Company default</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums text-slate-300">{kb.chunk_size}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={statusTone(kb.status)}>{kb.status}</Badge>
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => navigate(`kbs/${kb.kb_key}`)}>
                          Open
                        </Button>
                        <button
                          type="button"
                          title={`Delete ${kb.kb_key}`}
                          onClick={() => remove(kb)}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                        >
                          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <KbModal
        open={createOpen}
        row={null}
        company={company}
        onClose={() => setCreateOpen(false)}
        onSaved={async () => {
          setCreateOpen(false);
          notify("Knowledge base created.");
          await load();
        }}
      />

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50">
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-200 shadow-xl">{toast}</div>
        </div>
      )}
    </div>
  );
}
