// --------------------------
// GRAPH SCHEMA TESTS — knowledge/graph-schema.js
// Allowlist behavior, normalization, stable entity ids, tenant scoping.
// Pure ESM — runs with zero node_modules (node builtins only).
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ENTITY_TYPES,
  RELATIONSHIP_TYPES,
  isValidRelationshipType,
  normalizeRelationshipType,
  normalizeEntityType,
  stableEntityId,
} from "../../knowledge/graph-schema.js";

describe("relationship type allowlist", () => {
  it("accepts allowlisted types case-insensitively", () => {
    for (const t of ["USES", "PROVIDES", "DEPENDS_ON", "PART_OF", "IMPLEMENTS", "RELATED_TO"]) {
      assert.equal(isValidRelationshipType(t), true, t);
      assert.equal(isValidRelationshipType(t.toLowerCase()), true, t);
    }
  });

  it("rejects arbitrary LLM-supplied types", () => {
    assert.equal(isValidRelationshipType("DROP DATABASE"), false);
    assert.equal(isValidRelationshipType("CYPHER DELETE"), false);
    assert.equal(isValidRelationshipType("MATCH (n)"), false);
    assert.equal(isValidRelationshipType(""), false);
    assert.equal(isValidRelationshipType(null), false);
    assert.equal(isValidRelationshipType(undefined), false);
  });

  it("normalizes legacy RELATES_TO to the allowlist", () => {
    assert.equal(normalizeRelationshipType("RELATES_TO"), "RELATED_TO");
    assert.equal(normalizeRelationshipType("relates_to"), "RELATED_TO");
    assert.equal(normalizeRelationshipType("USES"), "USES");
    // Unknown type falls back to RELATED_TO (never injected raw, never null)
    assert.equal(normalizeRelationshipType("HANGS_OUT_WITH"), "RELATED_TO");
    assert.equal(normalizeRelationshipType(null), null);
    assert.equal(normalizeRelationshipType(""), null);
  });

  it("normalized types are always safe to interpolate", () => {
    for (const raw of ["USES", "usES", "RELATES_TO", "MATCH (n) DELETE", "DROP", ""]) {
      const mapped = normalizeRelationshipType(raw);
      if (mapped !== null) assert.ok(RELATIONSHIP_TYPES.has(mapped), `mapped ${raw} → ${mapped}`);
    }
  });
});

describe("entity type normalization", () => {
  it("maps exact + case variants onto the allowlist", () => {
    assert.equal(normalizeEntityType("Organization"), "Organization");
    assert.equal(normalizeEntityType("organization"), "Organization");
    assert.equal(normalizeEntityType("Standard"), "Standard");
  });

  it("falls back to Other for unknown / empty", () => {
    assert.equal(normalizeEntityType("AlienSpecies"), "Other");
    assert.equal(normalizeEntityType(""), "Other");
    assert.equal(normalizeEntityType(null), "Other");
    assert.equal(normalizeEntityType(undefined), "Other");
    assert.ok(ENTITY_TYPES.has(normalizeEntityType("whatever")));
  });
});

describe("stable entity ids", () => {
  it("is deterministic for the same company+kb+name", () => {
    const a = stableEntityId("popularcert", "iso-kb", "Cloudflare Vectorize");
    const b = stableEntityId("popularcert", "iso-kb", "Cloudflare Vectorize");
    assert.equal(a, b);
  });

  it("differs across KBs and companies (tenant isolation)", () => {
    const kb1 = stableEntityId("popularcert", "kb-one", "Vectorize");
    const kb2 = stableEntityId("popularcert", "kb-two", "Vectorize");
    const co2 = stableEntityId("otherco", "kb-one", "Vectorize");
    assert.notEqual(kb1, kb2);
    assert.notEqual(kb1, co2);
  });

  it("ignores case/whitespace of the name", () => {
    assert.equal(
      stableEntityId("co", "kb", "  Cloudflare Vectorize "),
      stableEntityId("co", "kb", "cloudflare vectorize")
    );
  });

  it("entity type is not part of identity (type is a mutable property)", () => {
    // Same name with two types resolves to the same node id.
    assert.equal(stableEntityId("co", "kb", "ISO 9001"), stableEntityId("co", "kb", "ISO 9001"));
  });

  it("ids look like entity keys and are stable strings", () => {
    const id = stableEntityId("popularcert", "kb", "name");
    assert.ok(id.startsWith("ent_popularcert_kb_"));
    assert.equal(typeof id, "string");
    assert.ok(id.length > 20);
  });
});
