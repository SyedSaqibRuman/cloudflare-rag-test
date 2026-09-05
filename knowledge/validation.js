// --------------------------
// KNOWLEDGE VALIDATION — pure, DB-free rules for the knowledge layer.
//   - claim shape validation (subject/predicate/object)
//   - confidence → status policy (proposal §13)
//   - mutation policy: what an actor may write (proposal §20)
//   - conflict detection between claims (proposal §14)
// All functions are pure so they can be unit-tested without Neo4j/MySQL.
// --------------------------
import { strictRelationshipType, SINGULAR_RELATIONSHIP_TYPES } from "./graph-schema.js";

// ------------------------------------------------------------------
// CLAIM LIFECYCLE
// ------------------------------------------------------------------

/** Claim lifecycle statuses (proposal §24). */
export const CLAIM_STATUSES = new Set([
  "candidate",
  "accepted",
  "rejected",
  "deprecated",
  "conflicting",
  "needs_review",
]);

/** Auto-accept threshold (≥): 0.90+ accepted, 0.70–0.90 candidate, <0.70 rejected. */
export const CONFIDENCE_THRESHOLDS = {
  accept: 0.9,
  review: 0.7,
};

/** Actor types that may commit directly (bypass the review queue). */
export const TRUSTED_ACTOR_TYPES = new Set(["admin", "api", "migration"]);

/**
 * Map a raw confidence score to the claim lifecycle status (proposal §13).
 * @param {number} confidence  0..1
 * @returns {"accepted"|"candidate"|"rejected"}
 */
export function confidenceToStatus(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return "rejected";
  if (c >= CONFIDENCE_THRESHOLDS.accept) return "accepted";
  if (c >= CONFIDENCE_THRESHOLDS.review) return "candidate";
  return "rejected";
}

// ------------------------------------------------------------------
// CLAIM VALIDATION
// ------------------------------------------------------------------

/**
 * Validate a knowledge claim. A claim is a subject → predicate → object
 * triple with optional evidence + confidence.
 * @param {object} input
 * @param {boolean} [input.allowAutoCreateEntities]  Resolve missing endpoints
 *        to new entities instead of failing (write tools should pass true).
 * @returns {{ ok: true, value: object } | { ok: false, errors: object }}
 */
export function validateClaim(input = {}) {
  const errors = {};

  const subject = pickEndpoint(input.subject, errors, "subject");
  const object = pickEndpoint(input.object, errors, "object");

  const predicate = strictRelationshipType(input.predicate);
  if (!predicate) errors.predicate = "predicate must be one of the allowed relationship types.";

  let confidence = input.confidence;
  if (confidence === undefined || confidence === null) confidence = 0.8;
  confidence = Number(confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    errors.confidence = "confidence must be a number between 0 and 1.";
  }

  if (input.status !== undefined && input.status !== null && !CLAIM_STATUSES.has(input.status)) {
    errors.status = `status must be one of: ${[...CLAIM_STATUSES].join(", ")}.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      subject,
      predicate,
      object,
      confidence,
      evidence: input.evidence || [],
      status: input.status || null, // null → derived from confidence
      allowAutoCreateEntities: Boolean(input.allowAutoCreateEntities),
    },
  };
}

function pickEndpoint(endpoint, errors, field) {
  if (endpoint && typeof endpoint === "object") {
    // { id } or { name, type? } — resolved later by the entity service.
    if (endpoint.id) return { id: String(endpoint.id) };
    if (endpoint.name && String(endpoint.name).trim()) {
      return { name: String(endpoint.name).trim(), type: endpoint.type || null };
    }
  }
  if (typeof endpoint === "string" && endpoint.trim()) {
    return { name: endpoint.trim(), type: null };
  }
  errors[field] = `${field} must be an entity id or { name } reference.`;
  return null;
}

// ------------------------------------------------------------------
// CONFLICT DETECTION
// ------------------------------------------------------------------

/**
 * Classify two claims on the same subject+predicate. Identical objects are
 * duplicates; a DIFFERENT object is only a conflict when the predicate is
 * single-valued per subject (SINGULAR_RELATIONSHIP_TYPES) — multi-valued
 * predicates (USES, PROVIDES, …) legitimately point at many objects, so a
 * different object is simply a separate fact (returns null).
 * @param {object} a  { subjectId, predicate, objectId } (+ optional kb)
 * @param {object} b
 * @returns {"duplicate"|"conflict"|null}
 */
export function classifyClaimPair(a, b) {
  if (!a || !b) return null;
  if (String(a.subjectId) !== String(b.subjectId)) return null;
  if (a.predicate !== b.predicate) return null;
  if (String(a.objectId) === String(b.objectId)) return "duplicate";
  return SINGULAR_RELATIONSHIP_TYPES.has(a.predicate) ? "conflict" : null;
}

/**
 * Given the existing accepted/candidate claims for a (subject, predicate)
 * scope and a new claim, decide its lifecycle:
 *   - identical object   → "duplicate" (caller can keep the higher confidence)
 *   - singular predicate, different object → "conflicting" / "needs_review"
 *   - otherwise           → derived from confidence (a new parallel fact)
 * @param {object} opts
 * @param {object} opts.existing  { subjectId, predicate, objectId, confidence, status }
 * @param {object} opts.incoming  { subjectId, predicate, objectId, confidence }
 * @returns {{ status: string, reason: string, duplicateOf: object|null, conflictsWith: object|null }}
 */
export function assessClaimLifecycle(existing, incoming) {
  const relation = classifyClaimPair(existing, incoming);
  if (relation === "duplicate") {
    const keepExisting = (existing.confidence ?? 0) >= (incoming.confidence ?? 0);
    return {
      status: "duplicate",
      reason: "An identical claim already exists.",
      duplicateOf: existing,
      keepExisting,
    };
  }
  if (relation === "conflict") {
    // Conflicting evidence on a single-valued predicate: flag both sides for
    // review instead of silently overwriting one claim with the other (§14).
    const existingAccepted = existing.status === "accepted" || existing.status === "candidate";
    return {
      status: "conflicting",
      reason: `Contradicts an existing ${existing.status || "claim"} on the same subject/predicate.`,
      conflictsWith: existing,
      demoteExisting: existingAccepted,
    };
  }
  return {
    status: confidenceToStatus(incoming.confidence),
    reason: null,
    duplicateOf: null,
    conflictsWith: null,
  };
}

// ------------------------------------------------------------------
// MUTATION POLICY (proposal §20)
// ------------------------------------------------------------------
// READ      → automatic (any authenticated tenant actor)
// PROPOSE   → automatic, writes lifecycle "candidate"/"needs_review"
// COMMIT    → trusted actors only (admin/api/migration) or explicit policy
//             grant; anything else is queued as a candidate.
// ------------------------------------------------------------------

/** Read tools can be used freely during answering. */
export function canReadKnowledge(actor = {}) {
  return Boolean(actor?.companyKey || actor?.type === "admin");
}

/**
 * Decide whether an actor may commit a write directly, or must be queued as
 * a candidate for review.
 * @param {object} opts
 * @param {object} [opts.actor]        { type, id }
 * @param {boolean} [opts.policyAllow] extra per-actor grant (e.g. service token)
 * @returns {{ commit: boolean, reason: string }}
 */
export function canCommitMutation({ actor = {}, policyAllow = false } = {}) {
  const type = actor?.type;
  if (policyAllow || TRUSTED_ACTOR_TYPES.has(type)) {
    return { commit: true, reason: "actor is trusted for direct commits" };
  }
  if (type === "llm" || type === "ai") {
    return {
      commit: false,
      reason: "AI actors propose; a trusted actor or policy grant must commit.",
    };
  }
  return {
    commit: false,
    reason: `actor type '${type || "unknown"}' may only propose knowledge changes.`,
  };
}

/**
 * Resolve the effective write status for a proposal given the actor policy.
 * Trusted actors writing confident claims get accepted; everything else is
 * queued as a candidate unless the caller supplied an explicit status.
 * @param {object} opts
 * @param {number} opts.confidence
 * @param {string} [opts.requestedStatus]
 * @param {object} [opts.actor]
 * @param {boolean} [opts.policyAllow]
 * @returns {{ status: string, commit: boolean, reason: string }}
 */
export function resolveWriteStatus({ confidence, requestedStatus = null, actor = {}, policyAllow = false }) {
  if (requestedStatus && CLAIM_STATUSES.has(requestedStatus)) {
    return { status: requestedStatus, commit: true, reason: "explicit status provided" };
  }
  const derived = confidenceToStatus(confidence);
  const policy = canCommitMutation({ actor, policyAllow });
  if (derived === "accepted" && policy.commit) {
    return { status: "accepted", commit: true, reason: policy.reason };
  }
  if (derived === "rejected") {
    return { status: "rejected", commit: false, reason: "below the review confidence threshold." };
  }
  return { status: "candidate", commit: false, reason: "queued for review" };
}
