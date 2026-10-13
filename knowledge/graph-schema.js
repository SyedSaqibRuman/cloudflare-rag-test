// --------------------------
// KNOWLEDGE GRAPH SCHEMA — shared constants for the Neo4j knowledge layer.
// Single source of truth for what the knowledge layer may write. Used by:
//   - ingest/graph-extract.js  (ingestion-time writes)
//   - scripts/migrate-graph-relationship-types.js  (one-time RELATES_TO migration)
//   - knowledge/ services (later phases: claims, proposals, validation)
// Never interpolate an LLM-supplied string into Cypher without passing it
// through this allowlist first.
// --------------------------

/** Entity node label used across the knowledge layer. */
export const ENTITY_LABEL = "Entity";

/**
 * Entity labels a knowledge entity node may carry. Extraction and the
 * knowledge service both normalize to this set.
 */
export const ENTITY_TYPES = new Set([
  "Person",
  "Organization",
  "Concept",
  "Standard",
  "Location",
  "Product",
  "Event",
  "Document",
  "Technology",
  "Service",
  "Other",
]);

/**
 * Relationship types the knowledge layer is allowed to write as real Cypher
 * relationship types (not properties). Unknown LLM types are mapped through
 * normalizeRelationshipType() and dropped when no mapping exists.
 */
export const RELATIONSHIP_TYPES = new Set([
  "USES",
  "PROVIDES",
  "DEPENDS_ON",
  "PART_OF",
  "IMPLEMENTS",
  "REQUIRES",
  "CERTIFIES",
  "LOCATED_IN",
  "CREATED_BY",
  "OWNED_BY",
  "RELATED_TO",
  "SUPERSEDES",
  "MENTIONS",
]);

/**
 * Relationship types treated as SINGLE-VALUED per subject: a subject holding
 * one of these to two different objects is a genuine contradiction ("X
 * SUPERSEDES Y" vs "X SUPERSEDES Z"), not merely a second relationship.
 * Every other allowlisted type is multi-valued in an entity-relationship
 * graph — "X PROVIDES A" and "X PROVIDES B" coexist legitimately, so a
 * different object is a new fact, never a conflict. Claim conflict triage
 * (assessClaimLifecycle, claim/relationship services) only applies to these.
 */
export const SINGULAR_RELATIONSHIP_TYPES = new Set(["SUPERSEDES", "OWNED_BY"]);

/** Legacy fallback for RELATES_TO edges that carried a type property. */
const TYPE_FALLBACK = "RELATED_TO";

/** Uppercase + strip non-word chars → canonical relation key. */
function canonicalRelKey(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return key || null;
}

/**
 * True when `type` is a member of the write allowlist (case-insensitive).
 * @param {string} type
 * @returns {boolean}
 */
export function isValidRelationshipType(type) {
  const key = canonicalRelKey(type);
  return key !== null && RELATIONSHIP_TYPES.has(key);
}

/**
 * Map an arbitrary relationship label to a writable relationship type.
 * Exact allowlist match wins; legacy RELATES_TO/unknown maps to RELATED_TO;
 * empty → null. The returned string is always a member of RELATIONSHIP_TYPES
 * or null — safe to interpolate into a Cypher statement.
 * @param {string|undefined} type
 * @returns {string|null}
 */
export function normalizeRelationshipType(type) {
  const key = canonicalRelKey(type);
  if (!key) return null;
  if (RELATIONSHIP_TYPES.has(key)) return key;
  return TYPE_FALLBACK;
}

/**
 * Strict relationship resolution for writes. Unlike normalizeRelationshipType
 * (lenient: unknown → RELATED_TO), this only accepts exact allowlist members
 * and the single legacy RELATES_TO alias. Used by the claim validator so
 * unexpected LLM-supplied predicates are flagged instead of silently
 * re-categorized.
 * @param {string|undefined} type
 * @returns {string|null}  allowlist member, "RELATED_TO" for legacy, or null
 */
export function strictRelationshipType(type) {
  const key = canonicalRelKey(type);
  if (!key) return null;
  if (RELATIONSHIP_TYPES.has(key)) return key;
  if (key === "RELATES_TO") return TYPE_FALLBACK;
  return null;
}

/**
 * Normalize an entity type to the ENTITY_TYPES allowlist (or "Other").
 * @param {string|undefined} type
 * @returns {string}
 */
export function normalizeEntityType(type) {
  if (typeof type !== "string") return "Other";
  const trimmed = type.trim();
  if (!trimmed) return "Other";
  const key = trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
  if (ENTITY_TYPES.has(key)) return key;
  // Fuzzy: "Organizations" → "Organization", "technologies" → "Technology"
  const singular = key.replace(/ies$/i, "y").replace(/s$/i, "");
  for (const t of ENTITY_TYPES) {
    if (t.toLowerCase() === singular.toLowerCase()) return t;
  }
  return "Other";
}

/**
 * Deterministic stable entity id. Identity is scoped to the canonical name
 * WITHIN one (company, kb) — the same name inside a KB always resolves to the
 * same node id, and entities in different KBs or companies never collide.
 * Entity `type` is deliberately NOT part of the id: type is a mutable,
 * descriptive property (conflict handling is the knowledge service's job),
 * while the canonical name defines the node.
 * @param {string} companyName
 * @param {string} kbKey
 * @param {string} name
 * @returns {string}
 */
export function stableEntityId(companyName, kbKey, name) {
  const scope = `${String(companyName).toLowerCase()}:${String(kbKey).toLowerCase()}:${String(name || "").trim().toLowerCase()}`;
  // FNV-1a 64-bit over the scope string — deterministic, dependency-free.
  let hash = 0xcbf29ce484222325n;
  for (const ch of scope) {
    hash ^= BigInt(ch.charCodeAt(0));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `ent_${companyName.toLowerCase()}_${kbKey.toLowerCase()}_${hash.toString(36)}`;
}
