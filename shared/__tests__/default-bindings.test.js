// --------------------------
// DEFAULT-BINDINGS SHARED MATCHER TESTS — pure ESM, no node_modules.
// shared/default-bindings.js is the single source of truth used by the server
// (kb-service auto-bind) AND the wizard's review-step amber hint. These tests
// lock findDefaultBinding + evaluateDefaultBindings so both sides can't drift.
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";

import { findDefaultBinding, evaluateDefaultBindings } from "../default-bindings.js";

const RESOURCES = [
  { id: 22, resource_type: "vector_index", resource_key: "qdrant-neoco-kb-vectors", external_resource_id: "neoco-kb-vectors", provider_key: "qdrant", is_active: 1 },
  { id: 24, resource_type: "object_bucket", resource_key: "neoco-doc-storage", external_resource_id: "neoco-doc-storage", provider_key: "cloudflare_r2", is_active: 1 },
  { id: 15, resource_type: "vector_index", resource_key: "test-index", external_resource_id: "test-index", provider_key: "cloudflare_r2", is_active: 1 },
  { id: 30, resource_type: "vector_index", resource_key: "old-index", external_resource_id: "old-index", provider_key: "qdrant", is_active: 0 },
];

test("findDefaultBinding matches resource_key", () => {
  const r = findDefaultBinding(RESOURCES, "qdrant-neoco-kb-vectors", "vector_index");
  assert.equal(r?.id, 22);
});

test("findDefaultBinding matches external_resource_id", () => {
  const r = findDefaultBinding(RESOURCES, "neoco-kb-vectors", "vector_index");
  assert.equal(r?.id, 22);
});

test("findDefaultBinding enforces resource_type", () => {
  assert.equal(findDefaultBinding(RESOURCES, "neoco-doc-storage", "vector_index"), null);
  const r = findDefaultBinding(RESOURCES, "neoco-doc-storage", "object_bucket");
  assert.equal(r?.id, 24);
});

test("findDefaultBinding skips inactive rows", () => {
  assert.equal(findDefaultBinding(RESOURCES, "old-index", "vector_index"), null);
});

test("findDefaultBinding requireVectorCapable skips storage-only providers", () => {
  assert.equal(findDefaultBinding(RESOURCES, "test-index", "vector_index", { requireVectorCapable: true }), null);
  assert.notEqual(findDefaultBinding(RESOURCES, "test-index", "vector_index"), null); // without the flag it matches
});

test("findDefaultBinding returns null for blank/unknown names", () => {
  assert.equal(findDefaultBinding(RESOURCES, "", "vector_index"), null);
  assert.equal(findDefaultBinding(RESOURCES, "   ", "vector_index"), null);
  assert.equal(findDefaultBinding(RESOURCES, "nope", "vector_index"), null);
});

test("findDefaultBinding accepts live rows ({ name } only)", () => {
  const live = [{ name: "live-index", resource_type: "vector_index", provider_key: "cloudflare", is_active: 1 }];
  assert.equal(findDefaultBinding(live, "live-index", "vector_index")?.name, "live-index");
});

test("evaluateDefaultBindings: both defaults resolve → no warnings", () => {
  const out = evaluateDefaultBindings({
    resources: RESOURCES,
    vectorDefault: "qdrant-neoco-kb-vectors",
    storageDefault: "neoco-doc-storage",
  });
  assert.equal(out.vector.needed, true);
  assert.equal(out.vector.resolved, true);
  assert.equal(out.storage.resolved, true);
  assert.equal(out.vector.reason, "");
});

test("evaluateDefaultBindings: unresolved vector → actionable reason", () => {
  const out = evaluateDefaultBindings({
    resources: RESOURCES,
    vectorDefault: "missing-index",
    storageDefault: "neoco-doc-storage",
  });
  assert.equal(out.vector.resolved, false);
  assert.match(out.vector.reason, /missing-index/);
  assert.match(out.vector.reason, /until the KB is bound explicitly/);
  assert.equal(out.storage.resolved, true);
});

test("evaluateDefaultBindings: storage-only vector default → unresolved (capability)", () => {
  const out = evaluateDefaultBindings({
    resources: RESOURCES,
    vectorDefault: "test-index",
    storageDefault: "",
  });
  assert.equal(out.vector.resolved, false);
  assert.equal(out.storage.needed, false); // no storage default configured
});

test("evaluateDefaultBindings: explicit binding present → step skipped", () => {
  const out = evaluateDefaultBindings({
    resources: RESOURCES,
    vectorDefault: "missing-index",
    storageDefault: "missing-bucket",
    hasVectorBinding: true,
    hasStorageBinding: true,
  });
  assert.equal(out.vector.needed, false);
  assert.equal(out.storage.needed, false);
  assert.equal(out.vector.reason, "");
});

test("evaluateDefaultBindings: blank config → nothing needed", () => {
  const out = evaluateDefaultBindings({ resources: RESOURCES, vectorDefault: "", storageDefault: "" });
  assert.equal(out.vector.needed, false);
  assert.equal(out.storage.needed, false);
});
