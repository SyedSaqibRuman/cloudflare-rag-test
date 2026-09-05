// --------------------------
// KNOWLEDGE GRAPH TAB (Phase 6) — per-KB view of the Neo4j knowledge layer.
// Shows what ingestion extracted: entities, typed relationships, claims with
// their lifecycle status, contradictions and the review queue. Review actions
// (accept / reject) resolve candidate/conflicting claims from the portal.
//
// Rendered inside KbDetail (#ingestion/kbs/:key) via the "Knowledge Graph"
// tab. Data comes from /gateway/knowledge/kbs/:key/* — company-scoped by the
// portal's selected company.
// --------------------------

import { useEffect, useMemo, useState } from "react";
import {
  listKnowledgeEntities,
  getKnowledgeEntity,
  listKnowledgeRelationships,
  listKnowledgeClaims,
  listKnowledgeConflicts,
  listKnowledgeReview,
  updateKnowledgeClaimStatus,
  clearKbGraph,
} from "../../api";
import { Card, Button, Badge, Empty, Spinner, StatCard, SkeletonCard, Modal, Tabs, TabPanel, InfoTip } from "../../components/ui";

// ---------------------------------------------------------------------------
// Claim lifecycle presentation
// ---------------------------------------------------------------------------
const CLAIM_META = {
  accepted: { tone: "green", label: "Accepted" },
  candidate: { tone: "amber", label: "Candidate" },
  needs_review: { tone: "amber", label: "Needs review" },
  conflicting: { tone: "rose", label: "Conflicting" },
  rejected: { tone: "slate", label: "Rejected" },
  deprecated: { tone: "slate", label: "Deprecated" },
};

const REVIEWABLE = new Set(["candidate", "needs_review", "conflicting"]);

function ClaimBadge({ status }) {
  const meta = CLAIM_META[status] || { tone: "slate", label: status || "—" };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function Confidence({ value }) {
  if (value === null || value === undefined) return <span className="text-xs text-slate-500">—</span>;
  return (
    <span className="font-mono text-xs text-slate-300">
      {Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}
    </span>
  );
}

function Evidence({ items, max = 2 }) {
  const list = Array.isArray(items) ? items.slice(0, max) : [];
  if (!list.length) return <span className="text-xs text-slate-600">—</span>;
  return (
    <div className="flex max-w-64 flex-wrap gap-1">
      {list.map((e, i) => (
        <span key={i} className="truncate rounded bg-slate-800/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-400" title={e}>
          {e}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entity detail modal — full record + its typed relationships
// ---------------------------------------------------------------------------
function EntityDetail({ kbKey, company, entityId, onClose }) {
  const [entity, setEntity] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setEntity(null);
    (async () => {
      try {
        const res = await getKnowledgeEntity(kbKey, entityId, company);
        if (!cancelled) setEntity(res);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [kbKey, company, entityId]);

  return (
    <Modal open onClose={onClose} title={entity ? entity.name : "Entity"} wide>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {!entity && !error && (
        <div className="flex justify-center py-10"><Spinner className="h-5 w-5" /></div>
      )}
      {entity && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="indigo">{entity.type || "Other"}</Badge>
            <Confidence value={entity.confidence} />
            <span className="font-mono text-[11px] text-slate-500">{entity.id}</span>
          </div>

          {Array.isArray(entity.aliases) && entity.aliases.length > 0 && (
            <p className="text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Aliases:</span>{" "}
              {entity.aliases.join(", ")}
            </p>
          )}

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Relationships ({entity.relationships?.length || 0})
            </h4>
            {!entity.relationships?.length && (
              <p className="text-xs text-slate-500">No relationships extracted yet.</p>
            )}
            <ul className="space-y-1.5">
              {(entity.relationships || []).map((r, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-xs">
                  <Badge tone="cyan">{r.type}</Badge>
                  <span className="text-slate-300">{r.direction === "out" ? "→" : "←"}</span>
                  <span className="text-slate-200">{r.otherName}</span>
                  <span className="text-slate-500">({r.otherType})</span>
                  <Confidence value={r.confidence} />
                  {r.sourceTitle && <span className="ml-auto truncate text-[10px] text-slate-500">{r.sourceTitle}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------
export default function KnowledgeGraphTab({ kbKey, company, kb, notify }) {
  const [active, setActive] = useState("overview");
  const [data, setData] = useState({ entities: [], relationships: [], claims: [], conflicts: [], review: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [entityQuery, setEntityQuery] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [busyClaim, setBusyClaim] = useState(null);
  const [clearing, setClearing] = useState(false);

  const load = async () => {
    if (!company || !kbKey) return;
    setLoading(true);
    setError(null);
    try {
      const [entities, relationships, claims, conflicts, review] = await Promise.all([
        listKnowledgeEntities(kbKey, company, { limit: 500 }),
        listKnowledgeRelationships(kbKey, company, { limit: 500 }),
        listKnowledgeClaims(kbKey, company, { limit: 500 }),
        listKnowledgeConflicts(kbKey, company),
        listKnowledgeReview(kbKey, company),
      ]);
      setData({ entities, relationships, claims, conflicts, review });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [kbKey, company]); // eslint-disable-line react-hooks/exhaustive-deps

  const graphEnabled = Boolean(kb?.enable_graph_rag);
  const emptyHint = graphEnabled
    ? "Nothing extracted yet — run an ingestion with Graph RAG enabled to build this knowledge graph."
    : "Graph RAG is disabled for this KB. Enable it under Configuration and re-ingest to extract entities and relationships.";

  const setClaimStatus = async (claimId, status) => {
    setBusyClaim(claimId);
    setError(null);
    try {
      await updateKnowledgeClaimStatus(kbKey, claimId, status, company);
      notify(status === "accepted" ? "Claim accepted." : "Claim rejected.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyClaim(null);
    }
  };

  const clearGraph = async () => {
    if (!window.confirm(`Delete all knowledge-graph data for '${kbKey}'?\n\nThis removes its entities, relationships and claims from Neo4j. The knowledge base itself and its vectors are NOT affected.`)) return;
    setClearing(true);
    setError(null);
    try {
      const res = await clearKbGraph(kbKey, company);
      notify(res.message || "Knowledge graph data deleted.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setClearing(false);
    }
  };

  const filteredEntities = useMemo(() => {
    const q = entityQuery.trim().toLowerCase();
    if (!q) return data.entities;
    return data.entities.filter(
      (e) =>
        (e.name || "").toLowerCase().includes(q) ||
        (Array.isArray(e.aliases) && e.aliases.some((a) => String(a).toLowerCase().includes(q)))
    );
  }, [data.entities, entityQuery]);

  const reviewItems = useMemo(() => {
    const seen = new Set();
    return [...data.review].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [data.review]);

  const reviewCount = reviewItems.length;
  const conflictCount = data.conflicts.length;

  return (
    <div className="space-y-4">
      {/* ── Header actions ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs leading-relaxed text-slate-400">
          The knowledge graph stores the entities, relationships and evidence-backed claims
          extracted from this KB's content — the structural memory your AI consults alongside
          vector search.
        </p>
        <div className="flex items-center gap-2">
          {!graphEnabled && <Badge tone="amber">Graph RAG off</Badge>}
          <Button variant="danger" onClick={clearGraph} disabled={clearing || loading} className="text-xs">
            {clearing ? <Spinner className="h-3.5 w-3.5" /> : "🗑️ Delete graph data"}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {loading && !data.entities.length && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} rows={1} />)}
        </div>
      )}

      {!loading && !error && (
        <Tabs
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "entities", label: `Entities (${data.entities.length})` },
            { id: "relationships", label: `Relationships (${data.relationships.length})` },
            { id: "claims", label: `Claims (${data.claims.length})` },
            { id: "review", label: `Review (${reviewCount})` },
            { id: "conflicts", label: `Conflicts (${conflictCount})` },
          ]}
          active={active}
          onChange={setActive}
        >
          {/* ── Overview ───────────────────────────────────────────── */}
          <TabPanel id="overview" active={active}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard label="Entities" value={data.entities.length} tone="indigo" icon="🕸️" meta="named things" />
              <StatCard label="Relationships" value={data.relationships.length} tone="cyan" icon="🔗" meta="typed edges" />
              <StatCard label="Claims" value={data.claims.length} tone="green" icon="💡" meta="evidence-backed" />
              <StatCard label="In review" value={reviewCount} tone="amber" icon="📥" meta="awaiting decision" />
              <StatCard label="Conflicts" value={conflictCount} tone="rose" icon="⚡" meta="contradictions" />
            </div>
            <Card title="How to use this page" subtitle="Browse what your AI knows from the graph">
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• <span className="text-slate-300">Entities</span> — canonical things extracted from your content (companies, standards, concepts…). Click one to see its relationships.</li>
                <li>• <span className="text-slate-300">Claims</span> — subject → predicate → object statements with confidence and source evidence.</li>
                <li>• <span className="text-slate-300">Review</span> — candidate claims awaiting your decision. Accept or reject them to keep the graph trustworthy.</li>
                <li>• <span className="text-slate-300">Conflicts</span> — contradictory statements flagged for triage (e.g. two documents disagreeing).</li>
              </ul>
            </Card>
          </TabPanel>

          {/* ── Entities ───────────────────────────────────────────── */}
          <TabPanel id="entities" active={active}>
            <Card
              title="Entities"
              subtitle={`${data.entities.length} canonical entities in '${kbKey}'`}
              actions={
                <input
                  type="search"
                  value={entityQuery}
                  onChange={(e) => setEntityQuery(e.target.value)}
                  placeholder="Filter by name or alias…"
                  className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              }
            >
              {filteredEntities.length === 0 ? (
                <Empty message={entityQuery ? `No entities match '${entityQuery}'.` : emptyHint} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                        <th className="py-2 pr-3">Entity</th>
                        <th className="py-2 pr-3">Type</th>
                        <th className="py-2 pr-3">Confidence</th>
                        <th className="py-2 pr-3">Relations</th>
                        <th className="py-2 pr-3">Aliases</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntities.map((e) => (
                        <tr
                          key={e.id}
                          className="cursor-pointer border-t border-slate-800/60 transition-colors hover:bg-slate-800/40"
                          onClick={() => setDetailId(e.id)}
                          title="View relationships"
                        >
                          <td className="py-2 pr-3 text-slate-200">{e.name}</td>
                          <td className="py-2 pr-3"><Badge tone="indigo">{e.type || "Other"}</Badge></td>
                          <td className="py-2 pr-3"><Confidence value={e.confidence} /></td>
                          <td className="py-2 pr-3 font-mono text-xs text-slate-300">{e.relationshipCount ?? 0}</td>
                          <td className="py-2 pr-3 text-xs text-slate-500">
                            {Array.isArray(e.aliases) ? e.aliases.slice(0, 2).join(", ") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </TabPanel>

          {/* ── Relationships ──────────────────────────────────────── */}
          <TabPanel id="relationships" active={active}>
            <Card title="Relationships" subtitle={`${data.relationships.length} typed edges in '${kbKey}'`}>
              {data.relationships.length === 0 ? (
                <Empty message={emptyHint} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                        <th className="py-2 pr-3">From</th>
                        <th className="py-2 pr-3">Type</th>
                        <th className="py-2 pr-3">To</th>
                        <th className="py-2 pr-3">Confidence</th>
                        <th className="py-2 pr-3">Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.relationships.map((r, i) => (
                        <tr key={`${r.fromId}-${r.type}-${r.toId}-${i}`} className="border-t border-slate-800/60">
                          <td className="py-2 pr-3 text-slate-200">{r.fromName}</td>
                          <td className="py-2 pr-3"><Badge tone="cyan">{r.type}</Badge></td>
                          <td className="py-2 pr-3 text-slate-200">{r.toName}</td>
                          <td className="py-2 pr-3"><Confidence value={r.confidence} /></td>
                          <td className="py-2 pr-3"><Evidence items={r.evidence} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </TabPanel>

          {/* ── Claims ─────────────────────────────────────────────── */}
          <TabPanel id="claims" active={active}>
            <Card title="Claims" subtitle={`${data.claims.length} subject → predicate → object statements`}>
              {data.claims.length === 0 ? (
                <Empty message={emptyHint} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                        <th className="py-2 pr-3">Subject</th>
                        <th className="py-2 pr-3">Predicate</th>
                        <th className="py-2 pr-3">Object</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Confidence</th>
                        <th className="py-2 pr-3">Evidence</th>
                        <th className="py-2 pr-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.claims.map((c) => (
                        <tr key={c.id} className="border-t border-slate-800/60">
                          <td className="py-2 pr-3 text-slate-200">{c.subjectName}</td>
                          <td className="py-2 pr-3"><Badge tone="cyan">{c.predicate}</Badge></td>
                          <td className="py-2 pr-3 text-slate-200">{c.objectName}</td>
                          <td className="py-2 pr-3"><ClaimBadge status={c.status} /></td>
                          <td className="py-2 pr-3"><Confidence value={c.confidence} /></td>
                          <td className="py-2 pr-3"><Evidence items={c.evidence} /></td>
                          <td className="py-2 pr-3 text-right">
                            {REVIEWABLE.has(c.status) && (
                              <div className="flex justify-end gap-1.5">
                                <Button variant="primary" className="!px-2 !py-1 text-[11px]" disabled={busyClaim === c.id} onClick={() => setClaimStatus(c.id, "accepted")}>
                                  {busyClaim === c.id ? <Spinner className="h-3 w-3" /> : "Accept"}
                                </Button>
                                <Button variant="danger" className="!px-2 !py-1 text-[11px]" disabled={busyClaim === c.id} onClick={() => setClaimStatus(c.id, "rejected")}>
                                  Reject
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </TabPanel>

          {/* ── Review queue ───────────────────────────────────────── */}
          <TabPanel id="review" active={active}>
            <Card title="Review queue" subtitle="Candidate claims from AI extraction, waiting for your decision">
              {reviewItems.length === 0 ? (
                <Empty message="Nothing to review — the review queue is clear. 🎉" />
              ) : (
                <ul className="divide-y divide-slate-800/60">
                  {reviewItems.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                      <span className="text-slate-200">{c.subjectName}</span>
                      <Badge tone="cyan">{c.predicate}</Badge>
                      <span className="text-slate-200">{c.objectName}</span>
                      <ClaimBadge status={c.status} />
                      <span className="text-xs text-slate-500">conf {Number(c.confidence ?? 0).toFixed(2)}</span>
                      <span className="ml-auto flex gap-1.5">
                        <Button variant="primary" className="!px-2.5 !py-1 text-[11px]" disabled={busyClaim === c.id} onClick={() => setClaimStatus(c.id, "accepted")}>
                          {busyClaim === c.id ? <Spinner className="h-3 w-3" /> : "✓ Accept"}
                        </Button>
                        <Button variant="danger" className="!px-2.5 !py-1 text-[11px]" disabled={busyClaim === c.id} onClick={() => setClaimStatus(c.id, "rejected")}>
                          ✕ Reject
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabPanel>

          {/* ── Conflicts ──────────────────────────────────────────── */}
          <TabPanel id="conflicts" active={active}>
            <Card
              title="Conflicts"
              subtitle="Contradictory statements flagged for triage — resolve in favour of one side"
              actions={<InfoTip content="Conflicts arise when a single-valued statement (e.g. SUPERSEDES) points at different objects. Accepting one side keeps it; rejecting deprecates it." />}
            >
              {conflictCount === 0 ? (
                <Empty message="No conflicting claims — the graph is consistent. 🎉" />
              ) : (
                <ul className="divide-y divide-slate-800/60">
                  {data.conflicts.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                      <span className="text-slate-200">{c.subjectName}</span>
                      <Badge tone="rose">{c.predicate}</Badge>
                      <span className="text-slate-200">{c.objectName}</span>
                      <ClaimBadge status={c.status} />
                      <span className="text-xs text-slate-500">conf {Number(c.confidence ?? 0).toFixed(2)}</span>
                      <span className="ml-auto flex gap-1.5">
                        <Button variant="primary" className="!px-2.5 !py-1 text-[11px]" disabled={busyClaim === c.id} onClick={() => setClaimStatus(c.id, "accepted")}>
                          {busyClaim === c.id ? <Spinner className="h-3 w-3" /> : "Resolve"}
                        </Button>
                        <Button variant="danger" className="!px-2.5 !py-1 text-[11px]" disabled={busyClaim === c.id} onClick={() => setClaimStatus(c.id, "rejected")}>
                          Reject
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabPanel>
        </Tabs>
      )}

      {detailId && (
        <EntityDetail
          kbKey={kbKey}
          company={company}
          entityId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}