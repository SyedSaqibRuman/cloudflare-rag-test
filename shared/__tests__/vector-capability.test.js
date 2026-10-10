// --------------------------
// VECTOR CAPABILITY TESTS — pure-ESM tests for shared/vector-capability.js.
// No I/O, no node_modules. Locks the provider list that mirrors the vector
// adapter factory (cloudflare/pinecone/qdrant/weaviate/openai) so storage-only
// providers (cloudflare_r2, aws_s3, …) can never serve KB vector ingestion.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  VECTOR_CAPABLE_PROVIDER_KEYS,
  isVectorCapableProvider,
  splitVectorCapable,
} from "../vector-capability.js";

describe("VECTOR_CAPABLE_PROVIDER_KEYS", () => {
  it("mirrors the vector adapter factory's supported providers", () => {
    assert.deepEqual(VECTOR_CAPABLE_PROVIDER_KEYS.sort(), [
      "cloudflare",
      "openai",
      "pinecone",
      "qdrant",
      "weaviate",
    ].sort());
  });

  it("does NOT include storage-only providers", () => {
    for (const key of ["cloudflare_r2", "aws_s3", "minio", "aws"]) {
      assert.ok(!VECTOR_CAPABLE_PROVIDER_KEYS.includes(key), `${key} must not be vector-capable`);
    }
  });
});

describe("isVectorCapableProvider", () => {
  it("accepts every capable provider key", () => {
    for (const key of VECTOR_CAPABLE_PROVIDER_KEYS) {
      assert.equal(isVectorCapableProvider(key), true, key);
    }
  });

  it("rejects storage providers and junk input", () => {
    assert.equal(isVectorCapableProvider("cloudflare_r2"), false);
    assert.equal(isVectorCapableProvider("aws_s3"), false);
    assert.equal(isVectorCapableProvider(""), false);
    assert.equal(isVectorCapableProvider(null), false);
    assert.equal(isVectorCapableProvider(undefined), false);
  });
});

describe("splitVectorCapable", () => {
  it("partitions resources by provider_key capability", () => {
    const rows = [
      { id: 1, provider_key: "qdrant", resource_key: "qd" },
      { id: 2, provider_key: "cloudflare_r2", resource_key: "r2" },
      { id: 3, provider_key: "cloudflare", resource_key: "vx" },
      { id: 4, provider_key: "aws_s3", resource_key: "s3" },
      { id: 5, provider_key: "pinecone", resource_key: "pc" },
    ];
    const { capable, incapable } = splitVectorCapable(rows);
    assert.deepEqual(capable.map((r) => r.id), [1, 3, 5]);
    assert.deepEqual(incapable.map((r) => r.id), [2, 4]);
  });

  it("returns two empty lists for null/undefined/empty input without throwing", () => {
    assert.deepEqual(splitVectorCapable(null), { capable: [], incapable: [] });
    assert.deepEqual(splitVectorCapable(undefined), { capable: [], incapable: [] });
    assert.deepEqual(splitVectorCapable([]), { capable: [], incapable: [] });
  });

  it("treats rows missing provider_key as incapable (not a crash)", () => {
    const { capable, incapable } = splitVectorCapable([{ id: 9 }]);
    assert.deepEqual(capable, []);
    assert.deepEqual(incapable, [{ id: 9 }]);
  });
});
