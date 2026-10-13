// --------------------------
// RAG-SYNC TESTS — pure field-mapping logic, no MySQL needed.
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { ragPatchFor, ragPatchForResource } from "../services/rag-sync.js";

test("ragPatchFor maps cloudflare fields to RAG credential keys", () => {
  const patch = ragPatchFor({ api_token: "tok-123", account_id: "acc-456" });
  assert.deepEqual(patch, {
    CLOUDFLARE_API_TOKEN: "tok-123",
    CLOUDFLARE_ACCOUNT_ID: "acc-456",
  });
});

test("ragPatchFor maps cloudflare_r2 fields to RAG R2 keys", () => {
  const patch = ragPatchFor({
    api_token: "tok-123",
    account_id: "acc-456",
    access_key_id: "ak-id",
    secret_access_key: "sk-secret",
  });
  assert.deepEqual(patch, {
    CLOUDFLARE_API_TOKEN: "tok-123",
    CLOUDFLARE_ACCOUNT_ID: "acc-456",
    R2_ACCESS_KEY_ID: "ak-id",
    R2_SECRET_ACCESS_KEY: "sk-secret",
  });
});

test("ragPatchFor trims values and drops empties", () => {
  const patch = ragPatchFor({ api_token: "  tok  ", account_id: "", zone_id: "not-mapped" });
  assert.deepEqual(patch, { CLOUDFLARE_API_TOKEN: "tok" });
});

test("ragPatchFor ignores fields without a RAG key mapping", () => {
  // zone_id, api_key, region etc. are not consumed by the RAG pipeline.
  assert.deepEqual(ragPatchFor({ zone_id: "z", api_key: "sk-123", region: "us-east-1" }), {});
  assert.deepEqual(ragPatchFor({}), {});
  assert.deepEqual(ragPatchFor(null), {});
});

test("ragPatchFor never maps R2_TOKEN_VALUE / R2_JURISDICTION_END_POINT", () => {
  // Those RAG keys have no gateway field source and are not consumed at runtime.
  const patch = ragPatchFor({ api_token: "tok", account_id: "acc", token_value: "tv", jurisdiction: "eu" });
  assert.ok(!("R2_TOKEN_VALUE" in patch));
  assert.ok(!("R2_JURISDICTION_END_POINT" in patch));
});

test("ragPatchFor maps neo4j fields only when providerKey is neo4j", () => {
  const fields = { uri: "neo4j+s://abc.databases.neo4j.io", username: "29abc", password: "pw123", api_token: "tok" };
  // Without the provider scope, neo4j field names map nothing (they'd collide
  // with other providers' 'username'/'password' fields).
  assert.deepEqual(ragPatchFor(fields), { CLOUDFLARE_API_TOKEN: "tok" });
  // With providerKey: 'neo4j' the connection's auth fields map to NEO4J_*.
  assert.deepEqual(ragPatchFor(fields, { providerKey: "neo4j" }), {
    NEO4J_URI: "neo4j+s://abc.databases.neo4j.io",
    NEO4J_USERNAME: "29abc",
    NEO4J_PASSWORD: "pw123",
    CLOUDFLARE_API_TOKEN: "tok",
  });
});

test("ragPatchForResource maps graph_database database_name to NEO4J_DATABASE", () => {
  assert.deepEqual(
    ragPatchForResource({ resourceType: "graph_database", config: { database_name: "29abc" } }),
    { NEO4J_DATABASE: "29abc" }
  );
});

test("ragPatchForResource ignores non-graph resources and empties", () => {
  assert.deepEqual(ragPatchForResource({ resourceType: "vector_index", config: { database_name: "x" } }), {});
  assert.deepEqual(ragPatchForResource({ resourceType: "graph_database", config: {} }), {});
  assert.deepEqual(ragPatchForResource({ resourceType: "graph_database", config: null }), {});
});
