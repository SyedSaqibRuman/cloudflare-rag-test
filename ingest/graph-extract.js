// --------------------------
// GRAPH EXTRACTION ADAPTER
// Extracts knowledge from document chunks and writes it to Neo4j during
// ingestion. Used by the ingest pipeline when a KB has enable_graph_rag =
// true and a Neo4j connection is configured.
//
// This is best-effort: any failure (LLM, network, Cypher) is logged and
// skipped — never blocks or fails the ingestion pipeline.
//
// Phase 3 flow — LLM output is treated as *knowledge proposals* that are
// routed through the Knowledge Service boundary (`knowledge/`), never
// written as raw Cypher from the adapter:
//
//   chunk → LLM extraction (entities + relationships + confidence)
//        → proposals normalized against the RELATIONSHIP_TYPES allowlist
//        → createEntity()      validated canonical node (per-KB identity)
//        → createRelationship() entity resolution + duplicate/conflict
//                               detection + typed allowlist edge + evidence
//        → createClaim()       first-class claim lifecycle (subject/
//                               predicate/object, confidence, chunk evidence,
//                               contradiction triage)
//
// The ingestion pipeline is the tenant's own content import, so claims it
// derives are written as accepted UNLESS they contradict an existing
// accepted claim (createClaim demotes both sides to `conflicting`, which
// feeds the review queue). The candidate/review queue stays reserved for
// low-confidence chat-time AI proposals. Relationships/claims below the
// confidence floor (0.5) are dropped — ungrounded extraction never reaches
// the graph.
// --------------------------

import pLimit from "p-limit";
import { logToFile } from "../utils/logger.js";
import { checkAbort } from "../utils/helpers.js";
import { ENTITY_LABEL, normalizeRelationshipType } from "../knowledge/graph-schema.js";
import { openKnowledgeSession } from "../knowledge/neo4j.js";
import { normalizeEvidence } from "../knowledge/provenance.js";
import { createEntity } from "../knowledge/entity-service.js";
import { createRelationship } from "../knowledge/relationship-service.js";
import { CLAIM_LABEL, createClaim } from "../knowledge/claim-service.js";

const EXTRACTION_MAX_CHUNKS = 10; // default max chunks to extract from per item
const EXTRACTION_CONCURRENCY = 4; // default parallel LLM extraction calls (Neo4j writes stay sequential)
const ENTITY_TIMEOUT_MS = 30_000; // per-chunk LLM extraction cap
const NEO4J_TIMEOUT_MS = 20_000; // per-query cap (routing discovery can hang)

/**
 * Clamp a per-KB override to a sane range, falling back to the default when
 * null/undefined/invalid. Keeps bad DB values from producing 0 or Infinity.
 */
function clampOverride(value, min, max, fallback) {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
const DEFAULT_CONFIDENCE = 0.8; // provenance: extraction without a score
const MIN_CONFIDENCE = 0.5; // below this, a relationship/claim is dropped
const INGEST_ACTOR = { type: "api", id: "ingest" }; // trusted pipeline actor

/**
 * Resolve a promise or reject after `ms` — graph I/O must never hang an
 * ingest indefinitely. The losing promise keeps settling in the background
 * (its rejection is handled by Promise.race), so no unhandled rejections.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Ensure the schema the knowledge layer relies on exists. Best-effort:
 * constraint / index creation is idempotent (IF NOT EXISTS) and wrapped so a
 * missing permission or older Neo4j never blocks extraction.
 */
async function ensureGraphSchema(session) {
  const statements = [
    `CREATE CONSTRAINT entity_id_unique IF NOT EXISTS
       FOR (e:${ENTITY_LABEL}) REQUIRE e.id IS UNIQUE`,
    `CREATE INDEX entity_kb_id IF NOT EXISTS
       FOR (e:${ENTITY_LABEL}) ON (e.kb_key, e.id)`,
    `CREATE INDEX entity_kb_name IF NOT EXISTS
       FOR (e:${ENTITY_LABEL}) ON (e.kb_key, e.name)`,
    `CREATE INDEX claim_kb IF NOT EXISTS
       FOR (c:${CLAIM_LABEL}) ON (c.kb_key, c.status)`,
  ];
  for (const statement of statements) {
    try {
      await withTimeout(
        session.run(statement, {}, { timeout: NEO4J_TIMEOUT_MS }),
        NEO4J_TIMEOUT_MS,
        "Neo4j schema ensure"
      );
    } catch (err) {
      logToFile("error.log", `⚠️ Neo4j schema ensure skipped: ${err.message}`);
    }
  }
}

/**
 * Normalize one chunk's LLM extraction into knowledge proposals. Every
 * relationship type passes through the allowlist; endpoints are trimmed;
 * self-loops, empty endpoints and unmappable types are dropped and counted
 * in `skipped`. Entity list entries dedupe on canonical (lowercased) name,
 * first occurrence winning the type.
 *
 * @param {object} extraction  { entities: [{name, type, confidence?}],
 *                              relationships: [{from, to, type, confidence?}] }
 * @returns {{ entities: Array, relationships: Array, skipped: number }}
 */
export function toProposals(extraction) {
  const entities = [];
  const seenEntities = new Set();
  for (const raw of extraction.entities || []) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenEntities.has(key)) continue; // first occurrence wins the type
    seenEntities.add(key);
    entities.push({
      name,
      type: raw?.type || "Other",
      confidence:
        typeof raw?.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1
          ? raw.confidence
          : DEFAULT_CONFIDENCE,
    });
  }

  let skipped = 0;
  const relationships = [];
  for (const raw of extraction.relationships || []) {
    const from = String(raw?.from || "").trim();
    const to = String(raw?.to || "").trim();
    if (!from || !to) { skipped++; continue; }
    if (from.toLowerCase() === to.toLowerCase()) { skipped++; continue; } // self-loop
    const type = normalizeRelationshipType(raw?.type);
    if (!type) { skipped++; continue; } // empty / unmappable type
    const confidence =
      typeof raw?.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1
        ? raw.confidence
        : DEFAULT_CONFIDENCE;
    relationships.push({ from, to, type, confidence });
  }
  return { entities, relationships, skipped };
}

/**
 * Create a graph extraction adapter for a company.
 * @param {Object} opts
 * @param {string} opts.companyName    Company key
 * @param {string} opts.kbKey          Knowledge base key
 * @param {Object} opts.graphConfig    { uri, username, password, database }
 * @param {Function} opts.extractEntities  LLM entity extraction function
 * @param {number|null} [opts.maxChunks]       Per-KB cap override (1-50; null = default 10)
 * @param {number|null} [opts.concurrency]     Per-KB parallelism override (1-10; null = default 4)
 * @returns {{ extractFromChunks: Function }}
 */
export function createGraphExtractor({ companyName, kbKey, graphConfig, extractEntities, maxChunks = null, concurrency = null }) {
  const sampleCap = clampOverride(maxChunks, 1, 50, EXTRACTION_MAX_CHUNKS);
  const extractConcurrency = clampOverride(concurrency, 1, 10, EXTRACTION_CONCURRENCY);
/**
 * Commit one chunk's normalized proposals to Neo4j (sequential writes).
   * Entities MERGE by per-KB stable id; relationships become typed allowlist
   * edges + the claims that back them; one bad proposal never kills the
   * rest of the chunk.
   */
  async function commitProposals(session, chunk, { entities, relationships }, stats) {
    // Evidence ties every write back to this chunk (proposal §5).
    const evidence = normalizeEvidence([
      { chunkId: chunk.id, title: chunk.title || null, url: chunk.url || null, source: "ingest" },
    ]);

    // 1) Entities → canonical nodes (MERGE by per-KB stable id).
    for (const entity of entities) {
      const res = await createEntity(session, {
        companyName,
        kbKey,
        name: entity.name,
        type: entity.type,
        provenance: { ...INGEST_ACTOR, confidence: entity.confidence },
      });
      if (res.created) stats.nodesCreated++;
    }

    // 2) Relationships → typed allowlist edges, then the claim that
    //    backs them. createRelationship resolves endpoints against
    //    the canonical nodes (auto-creating stragglers not in the
    //    entity list) and merges duplicate edges + evidence.
    for (const rel of relationships) {
      if (rel.confidence < MIN_CONFIDENCE) {
        stats.skippedRelationships++;
        continue;
      }
      try {
        const edge = await createRelationship(session, {
          companyName,
          kbKey,
          source: { name: rel.from },
          type: rel.type,
          target: { name: rel.to },
          confidence: rel.confidence,
          evidence,
          actor: INGEST_ACTOR,
          autoCreateEntities: true,
        });
        if (edge.created) stats.relationshipsCreated++;

        // 3) Claims → first-class lifecycle. Fresh non-conflicting
        //    triples are accepted (trusted import pipeline); a
        //    contradiction demotes both sides to `conflicting`
        //    inside createClaim, feeding the review queue.
        if (rel.confidence >= MIN_CONFIDENCE) {
          const claim = await createClaim(session, {
            companyName,
            kbKey,
            subject: { name: rel.from },
            predicate: rel.type,
            object: { name: rel.to },
            confidence: rel.confidence,
            evidence,
            actor: INGEST_ACTOR,
            status: "accepted", // conflicts still triaged by createClaim
            allowAutoCreateEntities: true,
          });
          if (claim.created) stats.claimsCreated++;
        }
      } catch (err) {
        // One bad proposal must not kill the chunk's remaining ones.
        stats.skippedRelationships++;
        logToFile("error.log", `⚠️ Graph proposal skipped (${rel.from} ${rel.type} ${rel.to}): ${err.message}`);
      }
    }
  }

  /**
   * Extract knowledge proposals from chunks and commit them through the
   * Knowledge Service (capped, parallel LLM extraction → sequential
   * WRITE-session commits).
   * @param {Array}  chunks     Vector chunks [{ id, text, title, url, metadata }]
   * @param {AbortSignal} signal
   * @param {Function} [onProgress]  Optional (subPhase, detail) reporter for
   *   live progress — e.g. ("extracting", "3/10 chunks · 4 parallel") then
   *   ("committing", "12 proposals to graph").
   * @returns {Promise<{ nodesCreated: number, relationshipsCreated: number,
   *   claimsCreated: number, skippedRelationships: number }>}
   */
  async function extractFromChunks(chunks, signal, onProgress) {
    const stats = { nodesCreated: 0, relationshipsCreated: 0, claimsCreated: 0, skippedRelationships: 0 };
    if (!graphConfig || !chunks.length) return stats;

    // Validate config before connecting — prevents hanging on empty creds
    if (!graphConfig.uri || !graphConfig.username || !graphConfig.password) {
      logToFile("error.log", `🕸️ Graph extraction skipped: missing Neo4j credentials (uri=${!!graphConfig.uri}, user=${!!graphConfig.username}, pass=${!!graphConfig.password})`);
      return stats;
    }

    // Cap extraction to avoid excessive LLM calls on large ingests.
    const sample = chunks.slice(0, sampleCap);

    // ---- Phase 1: LLM extraction (parallel, no Neo4j) -------------------
    const proposals = [];
    let extracted = 0;
    const limit = pLimit(extractConcurrency);
    onProgress?.("extracting", `0/${sample.length} chunks · ${extractConcurrency} parallel`);
    await Promise.all(
      sample.map((chunk) =>
        limit(async () => {
          try {
            checkAbort(signal);
            const extraction = await extractEntities(chunk.text, chunk.title);
            extracted += 1;
            onProgress?.("extracting", `${extracted}/${sample.length} chunks · ${extractConcurrency} parallel`);
            if (!extraction) return;
            const normalized = toProposals(extraction);
            stats.skippedRelationships += normalized.skipped;
            if (!normalized.entities.length && !normalized.relationships.length) return;
            proposals.push({ chunk, ...normalized });
          } catch (err) {
            if (err.name === "AbortError") return; // stop this task; run is aborting
            logToFile("error.log", `⚠️ Graph extraction failed for chunk: ${err.message}`);
          }
        })
      )
    );

    if (!proposals.length || signal?.aborted) return stats;

    // ---- Phase 2: commit to Neo4j (single write session, sequential) ----
    onProgress?.(
      "committing",
      `${proposals.length} chunk(s) → graph (${proposals.reduce((n, p) => n + p.relationships.length, 0)} relationships)`
    );
    try {
      const { session, close } = await openKnowledgeSession(graphConfig, { write: true });
      try {
        // One-time per-run schema (unique entity ids + KB lookup indexes).
        await ensureGraphSchema(session);

        for (const proposal of proposals) {
          checkAbort(signal);
          await commitProposals(session, proposal.chunk, proposal, stats);
        }
      } finally {
        await close();
      }
    } catch (err) {
      // Graph extraction is best-effort — never block ingestion
      logToFile("error.log", `⚠️ Graph adapter error: ${err.message}`);
    }

    if (stats.nodesCreated > 0 || stats.relationshipsCreated > 0 || stats.claimsCreated > 0 || stats.skippedRelationships > 0) {
      const skips = stats.skippedRelationships ? ` (${stats.skippedRelationships} skipped)` : "";
      console.log(`🕸️ Graph: ${stats.nodesCreated} nodes, ${stats.relationshipsCreated} relationships, ${stats.claimsCreated} claims${skips}`);
      logToFile("process.log", `🕸️ Graph extraction: ${stats.nodesCreated} nodes, ${stats.relationshipsCreated} relationships, ${stats.claimsCreated} claims${skips}`);
    }

    return stats;
  }

  return { extractFromChunks };
}

/**
 * Default LLM-based knowledge extractor using Cloudflare AI.
 * Extracts entities (Person, Organization, Concept, etc.) and relationships
 * with per-relationship confidence. The LLM is told the relationship
 * allowlist so its output maps cleanly onto real relationship types; unknown
 * types are still normalized downstream.
 */
export function createLlmEntityExtractor(companyName) {
  return async function extractEntities(text, title) {
    // Lazy-import to avoid circular deps
    const { runCloudflareAI } = await import("../services/cloudflare_ai.js");
    const { getLlmModel } = await import("../query/llm.js");

    // Truncate text to avoid exceeding context window
    const truncated = text.length > 3000 ? text.slice(0, 3000) + "…" : text;

    const prompt = `Extract entities and relationships from this text.
Return ONLY valid JSON with this structure:
{
  "entities": [
    {"name": "Entity Name", "type": "Person|Organization|Concept|Standard|Location|Product|Event|Technology|Document|Service", "confidence": 0.9}
  ],
  "relationships": [
    {"from": "Entity A Name", "to": "Entity B Name", "type": "USES|PROVIDES|DEPENDS_ON|PART_OF|IMPLEMENTS|REQUIRES|CERTIFIES|LOCATED_IN|CREATED_BY|OWNED_BY|RELATED_TO", "confidence": 0.9}
  ]
}

Text title: ${title || "Untitled"}
Text content:
${truncated}

Rules:
- Extract 5-15 key entities
- Extract 3-10 relationships between extracted entities
- Entity names should be specific and canonical (e.g. "ISO 9001" not "the standard")
- Relationship type MUST be one of the allowed values above (UPPERCASE). If unsure use RELATED_TO.
- Relationship endpoints must match extracted entity names exactly (same spelling).
- confidence is 0-1: give 0.9+ only when the text directly states the relationship or entity role, 0.7-0.9 when it is strongly implied, lower when speculative.
- Return ONLY the JSON object, no explanation`;

    const model = getLlmModel(companyName);
    if (!model) return null;

    // Per-call deadline so a stalled provider can't hang ingestion indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("LLM request timed out")), ENTITY_TIMEOUT_MS);
    try {
      const res = await runCloudflareAI(companyName, model, {
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 1200,
      }, { signal: controller.signal });

      const raw = String(res.response || "").trim();
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        entities: Array.isArray(parsed.entities) ? parsed.entities : [],
        relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
