// --------------------------
// VECTOR ID NORMALIZER TESTS — pure-ESM, no node_modules.
// Locks the provider-specific id rules: Qdrant (unsigned int), Weaviate (UUID),
// everything else unchanged. Determinism matters: re-ingestion must derive the
// same id so upserts overwrite instead of duplicating.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeVectorId, uuidFromString, uintFromString } from "../adapters/vector/vector-ids.js";

const PIPELINE_ID = "a3f1c2d4e5b60718293a4b5c6d7e8f901122334455667788-3";

describe("uuidFromString", () => {
  it("produces an RFC-4122-shaped UUID", () => {
    const uuid = uuidFromString(PIPELINE_ID);
    assert.match(
      uuid,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("is deterministic", () => {
    assert.equal(uuidFromString("x"), uuidFromString("x"));
  });

  it("does not collide for different inputs", () => {
    assert.notEqual(uuidFromString("a"), uuidFromString("b"));
  });
});

describe("uintFromString", () => {
  it("fits Qdrant's u64 (sign-safe 63-bit) range", () => {
    const n = uintFromString(PIPELINE_ID);
    assert.ok(Number.isInteger(n), "must be an integer");
    assert.ok(n > 0, "must be positive");
    assert.ok(n <= 0x7fffffffffffffff, "must fit 63 bits");
  });

  it("is deterministic", () => {
    assert.equal(uintFromString("x"), uintFromString("x"));
  });
});

describe("normalizeVectorId", () => {
  it("weaviate: returns a UUID", () => {
    assert.match(normalizeVectorId(PIPELINE_ID, "weaviate"), /^[0-9a-f-]{36}$/);
  });

  it("qdrant: returns a positive integer", () => {
    const id = normalizeVectorId(PIPELINE_ID, "qdrant");
    assert.ok(Number.isInteger(id) && id > 0);
  });

  it("pinecone + cloudflare: unchanged (raw pipeline id accepted)", () => {
    assert.equal(normalizeVectorId(PIPELINE_ID, "pinecone"), PIPELINE_ID);
    assert.equal(normalizeVectorId(PIPELINE_ID, "cloudflare"), PIPELINE_ID);
    assert.equal(normalizeVectorId(PIPELINE_ID, "cloudflare_vectorize"), PIPELINE_ID);
  });

  it("is deterministic per provider (re-ingestion overwrites, never duplicates)", () => {
    assert.equal(
      normalizeVectorId(PIPELINE_ID, "weaviate"),
      normalizeVectorId(PIPELINE_ID, "weaviate")
    );
    assert.equal(
      normalizeVectorId(PIPELINE_ID, "qdrant"),
      normalizeVectorId(PIPELINE_ID, "qdrant")
    );
  });

  it("passes through empty/null ids untouched", () => {
    assert.equal(normalizeVectorId("", "weaviate"), "");
    assert.equal(normalizeVectorId(null, "qdrant"), null);
  });
});
