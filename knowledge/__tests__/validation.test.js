// --------------------------
// KNOWLEDGE VALIDATION TESTS — pure domain rules (no Neo4j/MySQL).
// Confidence policy, claim shape validation, conflict lifecycle, mutation
// policy. Runs with zero node_modules (node builtins only).
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_STATUSES,
  confidenceToStatus,
  validateClaim,
  classifyClaimPair,
  assessClaimLifecycle,
  canReadKnowledge,
  canCommitMutation,
  resolveWriteStatus,
} from "../index.js";

describe("confidence → status policy", () => {
  it("auto-accepts ≥ 0.90", () => {
    assert.equal(confidenceToStatus(0.95), "accepted");
    assert.equal(confidenceToStatus(0.9), "accepted");
  });
  it("queues 0.70–0.90 as candidate", () => {
    assert.equal(confidenceToStatus(0.8), "candidate");
    assert.equal(confidenceToStatus(0.7), "candidate");
  });
  it("rejects < 0.70", () => {
    assert.equal(confidenceToStatus(0.69), "rejected");
    assert.equal(confidenceToStatus(0), "rejected");
  });
  it("rejects non-finite confidence", () => {
    assert.equal(confidenceToStatus("abc"), "rejected");
    assert.equal(confidenceToStatus(NaN), "rejected");
  });
});

describe("claim validation", () => {
  it("accepts a well-formed claim with names", () => {
    const check = validateClaim({
      subject: "PopularCert RAG",
      predicate: "USES",
      object: "Cloudflare Vectorize",
      confidence: 0.94,
    });
    assert.equal(check.ok, true);
    assert.equal(check.value.predicate, "USES");
    assert.equal(check.value.subject.name, "PopularCert RAG");
    assert.equal(check.value.object.name, "Cloudflare Vectorize");
  });

  it("accepts entity-id references", () => {
    const check = validateClaim({ subject: { id: "ent_1" }, predicate: "USES", object: { id: "ent_2" } });
    assert.equal(check.ok, true);
    assert.equal(check.value.subject.id, "ent_1");
  });

  it("rejects unknown predicates (no raw LLM types)", () => {
    const check = validateClaim({
      subject: "A",
      predicate: "MATCH (n) DELETE",
      object: "B",
      confidence: 0.9,
    });
    assert.equal(check.ok, false);
    assert.ok(check.errors.predicate);
  });

  it("falls back unknown-but-harmless predicates to the allowlist via normalization", () => {
    const check = validateClaim({ subject: "A", predicate: "relates_to", object: "B", confidence: 0.9 });
    assert.equal(check.ok, true);
    assert.equal(check.value.predicate, "RELATED_TO");
  });

  it("rejects empty endpoints and out-of-range confidence", () => {
    const check = validateClaim({ subject: "", predicate: "USES", object: "B", confidence: 2 });
    assert.equal(check.ok, false);
    assert.ok(check.errors.subject);
    assert.ok(check.errors.confidence);
  });

  it("validates explicit lifecycle statuses", () => {
    const ok = validateClaim({ subject: "A", predicate: "USES", object: "B", status: "needs_review" });
    assert.equal(ok.ok, true);
    const bad = validateClaim({ subject: "A", predicate: "USES", object: "B", status: "vaporized" });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.status);
  });
});

describe("conflict detection", () => {
  it("classifies duplicates vs conflicts", () => {
    // Identical triples are duplicates.
    const a = { subjectId: "s1", predicate: "USES", objectId: "o1" };
    assert.equal(classifyClaimPair(a, { ...a, objectId: "o1" }), "duplicate");
    // Different subject → unrelated.
    assert.equal(classifyClaimPair(a, { ...a, subjectId: "s2" }), null);
    assert.equal(classifyClaimPair(null, a), null);
  });

  it("only single-valued predicates conflict on a different object", () => {
    const uses = { subjectId: "s1", predicate: "USES", objectId: "o1" };
    // Multi-valued predicate: different object is a separate fact, not a conflict.
    assert.equal(classifyClaimPair(uses, { ...uses, objectId: "o2" }), null);
    const supersedes = { subjectId: "s1", predicate: "SUPERSEDES", objectId: "o1" };
    assert.equal(classifyClaimPair(supersedes, { ...supersedes, objectId: "o2" }), "conflict");
  });

  it("lifecycle: no existing claim → derived status", () => {
    const r = assessClaimLifecycle(null, { subjectId: "s", predicate: "USES", objectId: "o", confidence: 0.95 });
    assert.equal(r.status, "accepted");
    const r2 = assessClaimLifecycle(null, { subjectId: "s", predicate: "USES", objectId: "o", confidence: 0.75 });
    assert.equal(r2.status, "candidate");
  });

  it("lifecycle: duplicate keeps the higher-confidence claim", () => {
    const existing = { subjectId: "s", predicate: "USES", objectId: "o", confidence: 0.9, status: "accepted" };
    const r = assessClaimLifecycle(existing, { subjectId: "s", predicate: "USES", objectId: "o", confidence: 0.8 });
    assert.equal(r.status, "duplicate");
    assert.equal(r.keepExisting, true);
  });

  it("lifecycle: parallel facts on multi-valued predicates never conflict", () => {
    const existing = { subjectId: "s", predicate: "PROVIDES", objectId: "o1", confidence: 0.95, status: "accepted" };
    const r = assessClaimLifecycle(existing, { subjectId: "s", predicate: "PROVIDES", objectId: "o2", confidence: 0.96 });
    assert.notEqual(r.status, "conflicting");
    assert.equal(r.conflictsWith, null);
  });

  it("lifecycle: contradiction on a single-valued predicate flags both sides for review, never overwrites", () => {
    const existing = { subjectId: "s", predicate: "SUPERSEDES", objectId: "o1", confidence: 0.95, status: "accepted" };
    const r = assessClaimLifecycle(existing, { subjectId: "s", predicate: "SUPERSEDES", objectId: "o2", confidence: 0.96 });
    assert.equal(r.status, "conflicting");
    assert.equal(r.conflictsWith.objectId, "o1");
    assert.equal(r.demoteExisting, true); // the old accepted claim must be demoted too
  });
});

describe("mutation policy (proposal §20)", () => {
  it("admin / api actors can commit", () => {
    assert.equal(canCommitMutation({ actor: { type: "admin" } }).commit, true);
    assert.equal(canCommitMutation({ actor: { type: "api" } }).commit, true);
  });

  it("AI actors may propose but not commit", () => {
    const r = canCommitMutation({ actor: { type: "llm" } });
    assert.equal(r.commit, false);
    assert.match(r.reason, /propose/);
  });

  it("explicit policy grant can allow commit", () => {
    assert.equal(canCommitMutation({ actor: { type: "service-token" }, policyAllow: true }).commit, true);
  });

  it("read is automatic for tenant actors", () => {
    assert.equal(canReadKnowledge({ companyKey: "acme" }), true);
    assert.equal(canReadKnowledge({ type: "admin" }), true);
    assert.equal(canReadKnowledge({}), false);
  });

  it("resolveWriteStatus queues confident AI claims as candidates", () => {
    const r = resolveWriteStatus({ confidence: 0.94, actor: { type: "llm" } });
    assert.equal(r.status, "candidate");
    assert.equal(r.commit, false);
  });
});

describe("claim statuses enum", () => {
  it("contains the full lifecycle", () => {
    for (const s of ["candidate", "accepted", "rejected", "deprecated", "conflicting", "needs_review"]) {
      assert.ok(CLAIM_STATUSES.has(s));
    }
  });
});
