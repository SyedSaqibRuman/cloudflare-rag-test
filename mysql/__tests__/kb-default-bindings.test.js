// --------------------------
// DEFAULT-BINDING AUTO-BIND TESTS — pure-ESM, no MySQL.
// Locks applyDefaultResourceBindings: when a KB is saved without explicit
// vector/storage bindings ("Company default (config)"), the company config's
// VECTOR_INDEX / R2_BUCKET_NAME are resolved against provisioned resources.
// Matching accepts resource_key OR external_resource_id; storage-only
// providers never auto-bind as vector stores; explicit inputs always win.
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyDefaultResourceBindings, validateKbInput, saveKb } from "../services/kb-service.js";
import { ResourceRepository, KbRepository, AuditRepository, ModelRepository, CredentialRepository } from "../repositories.js";
import { runtimeConfig } from "../../config/index.js";

const RESOURCES = [
  {
    id: 22,
    resource_type: "vector_index",
    resource_key: "qdrant-neoco-kb-vectors",
    external_resource_id: "neoco-kb-vectors",
    provider_key: "qdrant",
    is_active: 1,
  },
  {
    id: 24,
    resource_type: "object_bucket",
    resource_key: "neoco-doc-storage",
    external_resource_id: "neoco-doc-storage",
    provider_key: "cloudflare_r2",
    is_active: 1,
  },
  // A storage-only provider row registered as vector_index (the testing-kb
  // papercut) — must NEVER be auto-bound as a vector store.
  {
    id: 15,
    resource_type: "vector_index",
    resource_key: "test-index",
    external_resource_id: "test-index",
    provider_key: "cloudflare_r2",
    is_active: 1,
  },
  // Inactive row — skipped.
  {
    id: 30,
    resource_type: "vector_index",
    resource_key: "old-index",
    external_resource_id: "old-index",
    provider_key: "qdrant",
    is_active: 0,
  },
];

const resourceRepo = { listByCompany: async () => RESOURCES };
const config = { VECTOR_INDEX: "qdrant-neoco-kb-vectors", R2_BUCKET_NAME: "neoco-doc-storage" };

test("binds both defaults by resource_key when the KB has no bindings", async () => {
  const value = validateKbInput({ kbKey: "kb-1", kbName: "KB" }).value;
  const out = await applyDefaultResourceBindings(1, "neoco", value, { resourceRepo, getConfig: () => config });
  assert.deepEqual(out, { vectorBound: true, storageBound: true });
  assert.equal(value.vectorResourceId, 22);
  assert.equal(value.storageResourceId, 24);
});

test("matches external_resource_id when the config holds the raw name", async () => {
  const value = validateKbInput({ kbKey: "kb-1", kbName: "KB" }).value;
  await applyDefaultResourceBindings(1, "neoco", value, {
    resourceRepo,
    getConfig: () => ({ VECTOR_INDEX: "neoco-kb-vectors", R2_BUCKET_NAME: "neoco-doc-storage" }),
  });
  assert.equal(value.vectorResourceId, 22); // external id neoco-kb-vectors matched
  assert.equal(value.storageResourceId, 24);
});

test("leaves fields null when the config has no defaults", async () => {
  const value = validateKbInput({ kbKey: "kb-1", kbName: "KB" }).value;
  const out = await applyDefaultResourceBindings(1, "neoco", value, {
    resourceRepo,
    getConfig: () => ({}),
  });
  assert.deepEqual(out, { vectorBound: false, storageBound: false });
  assert.equal(value.vectorResourceId, null);
  assert.equal(value.storageResourceId, null);
});

test("never auto-binds a storage-only provider as the vector store", async () => {
  const value = validateKbInput({ kbKey: "kb-1", kbName: "KB" }).value;
  await applyDefaultResourceBindings(1, "neoco", value, {
    resourceRepo,
    getConfig: () => ({ VECTOR_INDEX: "test-index", R2_BUCKET_NAME: "neoco-doc-storage" }),
  });
  assert.equal(value.vectorResourceId, null); // cloudflare_r2 vector row skipped
  assert.equal(value.storageResourceId, 24); // storage still bound
});

test("skips inactive resources", async () => {
  const value = validateKbInput({ kbKey: "kb-1", kbName: "KB" }).value;
  await applyDefaultResourceBindings(1, "neoco", value, {
    resourceRepo,
    getConfig: () => ({ VECTOR_INDEX: "old-index", R2_BUCKET_NAME: "" }),
  });
  assert.equal(value.vectorResourceId, null);
});

test("no-ops when the KB carries explicit bindings", async () => {
  const value = validateKbInput({
    kbKey: "kb-1",
    kbName: "KB",
    vectorResourceId: 3,
    storageResourceId: 7,
  }).value;
  let listed = false;
  const out = await applyDefaultResourceBindings(1, "neoco", value, {
    resourceRepo: { listByCompany: async () => { listed = true; return RESOURCES; } },
    getConfig: () => config,
  });
  assert.equal(listed, false, "should not even query resources");
  assert.deepEqual(out, { vectorBound: false, storageBound: false });
  assert.equal(value.vectorResourceId, 3); // untouched
  assert.equal(value.storageResourceId, 7);
});

test("fills only the missing side (explicit storage, default vector)", async () => {
  const value = validateKbInput({ kbKey: "kb-1", kbName: "KB", storageResourceId: 7 }).value;
  await applyDefaultResourceBindings(1, "neoco", value, { resourceRepo, getConfig: () => config });
  assert.equal(value.vectorResourceId, 22);
  assert.equal(value.storageResourceId, 7); // preserved
});

test("a config name with no matching resource is silently skipped", async () => {
  const value = validateKbInput({ kbKey: "kb-1", kbName: "KB" }).value;
  const out = await applyDefaultResourceBindings(1, "neoco", value, {
    resourceRepo,
    getConfig: () => ({ VECTOR_INDEX: "not-provisioned", R2_BUCKET_NAME: "also-missing" }),
  });
  assert.deepEqual(out, { vectorBound: false, storageBound: false });
});

test("resource listing failure degrades to no bindings (best-effort)", async () => {
  const value = validateKbInput({ kbKey: "kb-1", kbName: "KB" }).value;
  const out = await applyDefaultResourceBindings(1, "neoco", value, {
    resourceRepo: { listByCompany: async () => { throw new Error("db down"); } },
    getConfig: () => config,
  });
  assert.deepEqual(out, { vectorBound: false, storageBound: false });
});

// ------------------------------------------------------------------
// saveKb wiring — a "Company default (config)" create comes out bound.
// ------------------------------------------------------------------

const COMPANY = { id: 2, company_key: "neoco", max_knowledge_bases: 5 };

function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

test("saveKb auto-binds company defaults when the wizard sends none", async () => {
  // Seed the runtime config singleton (applyDefaultResourceBindings reads it
  // via getCompanyConfig → runtimeConfig.COMPANIES[companyKey]).
  runtimeConfig.COMPANIES["neoco"] = { ...config };
  let createdArgs = null;
  const restores = [
    stub(ResourceRepository, "listByCompany", async () => RESOURCES),
    stub(ResourceRepository, "findById", async (id) => {
      const row = RESOURCES.find((r) => Number(r.id) === Number(id));
      return row ? { ...row, company_id: 2 } : { id: Number(id), company_id: 2, provider_key: "qdrant" };
    }),
    stub(ModelRepository, "findById", async () => ({ id: 4, provider_key: "openai" })),
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    stub(KbRepository, "create", async (_companyId, input) => {
      createdArgs = input;
      return 42;
    }),
    stub(AuditRepository, "log", async () => {}),
    stub(CredentialRepository, "listByCompany", async () => []),
  ];
  try {
    await saveKb(COMPANY, { kbKey: "docs-kb", kbName: "Docs KB" }, {});
    assert.equal(createdArgs.vectorResourceId, 22, "vector bound from config default");
    assert.equal(createdArgs.storageResourceId, 24, "storage bound from config default");
  } finally {
    restores.forEach((r) => r());
  }
});
