// --------------------------
// KNOWLEDGE LAYER — barrel entry point.
// Exposes the single Knowledge Service boundary (knowledge-service.js) plus
// the pure domain rules (validation, provenance) and graph schema so callers
// (routes, ingest, query, later MCP) import from one path.
// --------------------------
export {
  createEntity,
  resolveEntity,
  updateEntity,
  mergeEntities,
  addAlias,
  listEntities,
  getEntity,
  createRelationship,
  listRelationships,
  removeRelationship,
  createClaim,
  listClaims,
  updateClaimStatus,
  findConflicts,
  listReviewQueue,
  requireGraphConfig,
  graphConfigured,
} from "./knowledge-service.js";

export {
  CLAIM_STATUSES,
  CONFIDENCE_THRESHOLDS,
  TRUSTED_ACTOR_TYPES,
  confidenceToStatus,
  validateClaim,
  classifyClaimPair,
  assessClaimLifecycle,
  canReadKnowledge,
  canCommitMutation,
  resolveWriteStatus,
} from "./validation.js";

export {
  normalizeEvidence,
  evidenceRefs,
  buildProvenance,
  knowledgeScore,
} from "./provenance.js";

export {
  ENTITY_TYPES,
  RELATIONSHIP_TYPES,
  SINGULAR_RELATIONSHIP_TYPES,
  isValidRelationshipType,
  normalizeRelationshipType,
  normalizeEntityType,
  stableEntityId,
} from "./graph-schema.js";

export { withKnowledgeSession } from "./neo4j.js";

export {
  KNOWLEDGE_TOOLS,
  TOOL_NAMES,
  executeKnowledgeTool,
  validateToolArgs,
  resolveToolPolicy,
} from "./tools.js";
