// --------------------------
// PROVENANCE & EVIDENCE — "why does the system believe this?"
// Every AI-created piece of knowledge (entity, relationship, claim) carries
// provenance: who created it, from which document/chunk, with what
// confidence and when. Callers attach a provenance record on write; the
// retrieval path can then cite it back to the source chunk.
// --------------------------

/**
 * Normalize free-form evidence into the canonical array shape.
 * Accepts:
 *   - an array of { documentId?, chunkId?, title?, url?, source? } objects
 *   - a single object
 *   - a string (treated as a document id / short note)
 * Entries are deduplicated (chunkId + documentId) and capped.
 * @param {unknown} evidence
 * @param {number} [maxEntries=20]
 * @returns {Array<{ documentId: string|null, chunkId: string|null, title: string|null, url: string|null, source: string|null }>}
 */
export function normalizeEvidence(evidence, maxEntries = 20) {
  if (evidence == null) return [];
  const raw = Array.isArray(evidence) ? evidence : [evidence];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const entry = { documentId: item.trim() || null, chunkId: null, title: null, url: null, source: "manual" };
      add(entry, seen, out, maxEntries);
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const entry = {
      documentId: item.documentId || item.document_id || null,
      chunkId: item.chunkId || item.chunk_id || null,
      title: item.title || null,
      url: item.url || null,
      source: item.source || item.extractedBy || item.extracted_by || "llm",
    };
    add(entry, seen, out, maxEntries);
  }
  return out;
}

function add(entry, seen, out, max) {
  if (out.length >= max) return;
  const key = `${entry.documentId || ""}|${entry.chunkId || ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(entry);
}

/**
 * Compact string form of evidence for graph storage / logs:
 *   "doc_123/chunk_17" · "architecture.md (chunk 7)"
 * @param {Array} evidence
 * @returns {string[]}
 */
export function evidenceRefs(evidence) {
  const normalized = normalizeEvidence(evidence);
  return normalized.map((e) => {
    if (e.documentId && e.chunkId) return `${e.documentId}/${e.chunkId}`;
    if (e.documentId) return e.documentId;
    if (e.title) return e.chunkId ? `${e.title} (chunk ${e.chunkId})` : e.title;
    return e.chunkId ? `chunk_${e.chunkId}` : "—";
  });
}

/**
 * Build the provenance payload attached to a node/edge/claim on write.
 * @param {object} opts
 * @param {string} opts.companyName
 * @param {string} opts.kbKey
 * @param {object} [opts.actor]        { type: 'llm'|'admin'|'api'|'migration', id? }
 * @param {number} [opts.confidence]   0..1 — falls back to DEFAULT when undefined
 * @param {Array}  [opts.evidence]     evidence array (normalized)
 * @returns {object}
 */
export function buildProvenance({ companyName, kbKey, actor = {}, confidence, evidence = [] }) {
  const now = new Date().toISOString();
  return {
    company: companyName,
    kb_key: kbKey,
    extracted_by: actor.type || "admin",
    created_by: actor.id || actor.type || null,
    confidence:
      typeof confidence === "number" && confidence >= 0 && confidence <= 1 ? confidence : 0.8,
    evidence: normalizeEvidence(evidence),
    created_at: now,
    updated_at: now,
  };
}

/**
 * Knowledge score = model_confidence + source_quality + evidence_count
 *                    - contradiction_penalty   (proposal §13).
 * Returns a number 0..1 useful as a combined confidence for ranking.
 * @param {object} opts
 * @param {number} opts.confidence          model confidence 0..1
 * @param {number} [opts.sourceQuality]     0..0.1 (default 0.05)
 * @param {number} [opts.evidenceCount]     supporting evidence entries
 * @param {number} [opts.contradictions]    number of contradicting claims
 */
export function knowledgeScore({ confidence, sourceQuality = 0.05, evidenceCount = 0, contradictions = 0 }) {
  const model = Math.min(Math.max(confidence ?? 0.8, 0), 1);
  const evidenceBonus = Math.min(evidenceCount, 5) * 0.02; // up to +0.10
  const contradictionPenalty = Math.min(contradictions, 5) * 0.15; // up to -0.75
  return Math.min(Math.max(model + sourceQuality + evidenceBonus - contradictionPenalty, 0), 1);
}
