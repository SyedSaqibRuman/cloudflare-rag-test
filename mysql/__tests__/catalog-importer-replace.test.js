// --------------------------
// CATALOG IMPORTER — replaceChildren (edit-wizard) semantics.
// Verifies that importProviderDefinition({ replaceChildren: true }) turns the
// provided authFields/endpoints/resources sections into the full set:
// rows not in the definition are DELETEd, capabilities/models/pricing are
// never touched, and the default (no flag) import leaves rows untouched.
//
// No MySQL needed: the importer's `getPool` test seam (opts.getPool) supplies
// a swappable fake connection, and the upsert repository methods are stubbed
// per test (t.mock.method) so the real delete*NotIn methods run against the
// fake connection and record every query. No experimental flags required.
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { importProviderDefinition } from "../services/catalog-importer.js";
import { CatalogImportRepository } from "../repositories.js";

// Fake mysql2 connection — records every query and spies on the transaction
// lifecycle so tests can assert SQL text, parameter binding, and ordering.
function makeFakeConn() {
  const queries = [];
  const calls = { begin: 0, commit: 0, rollback: 0, released: 0 };
  return {
    queries,
    calls,
    query: async (sql, params) => {
      queries.push({ sql, params });
      return [];
    },
    beginTransaction: async () => {
      calls.begin += 1;
    },
    commit: async () => {
      calls.commit += 1;
    },
    rollback: async () => {
      calls.rollback += 1;
    },
    release: () => {
      calls.released += 1;
    },
  };
}

// The importer's `getPool()` must resolve to OUR fake connection. The importer
// reads the pool through its opts.getPool seam, so we pass this provider on
// every call; each test swaps `currentConn` before invoking.
let currentConn = null;
const FAKE_GET_POOL = async () => ({ getConnection: async () => currentConn });

// Stub every upsert path the importer uses so no real INSERT runs against the
// fake conn — only the delete*NotIn methods stay real (unless spyDeletes is
// set, in which case they're wrapped to log the call AND run through to the
// real implementation). Returns a spy log that records each repository call
// in order.
function stubUpserts(t, repo, { spyDeletes = false } = {}) {
  const log = [];
  const stub = (name, ret) => {
    t.mock.method(repo, name, async () => {
      log.push(name);
      return ret;
    });
  };
  stub("upsertProvider", { id: 42, created: false });
  stub("upsertAuthField");
  stub("upsertEndpoint");
  stub("upsertCapability");
  stub("upsertResourceType");
  stub("upsertModel");
  stub("modelIdByKey", 9);
  stub("closeOpenPricing");
  stub("insertPricing");
  if (spyDeletes) {
    for (const name of ["deleteAuthFieldsNotIn", "deleteEndpointsNotIn", "deleteResourceTypesNotIn"]) {
      const original = repo[name];
      t.mock.method(repo, name, async (...args) => {
        log.push(name);
        return original.apply(repo, args);
      });
    }
  }
  return log;
}

const DEF = {
  providerKey: "edit_co",
  providerName: "Edit Co",
  category: "ai",
  authFields: [{ name: "api_key", label: "API Key" }],
  endpoints: [{ key: "chat", name: "Chat", url: "https://api.edit.co/v1/chat" }],
  resources: [{ type: "vector_index", displayName: "Vector Index" }],
  capabilities: ["text_generation"],
  models: [
    {
      key: "edit-1",
      name: "Edit One",
      category: "chat",
      pricing: [{ inputPricePerMillion: 1, outputPricePerMillion: 2 }],
    },
  ],
};

test("replaceChildren: deletes rows NOT in the definition, using NOT IN keep-lists", async (t) => {
  const conn = makeFakeConn();
  currentConn = conn;
  stubUpserts(t, CatalogImportRepository);

  await importProviderDefinition(DEF, { replaceChildren: true, getPool: FAKE_GET_POOL });

  const deletes = conn.queries.filter((q) => q.sql.startsWith("DELETE"));
  assert.equal(deletes.length, 3, "exactly the three child tables are deleted");

  // provider_auth_schemas — keep list is the normalized field names.
  assert.match(deletes[0].sql, /DELETE FROM provider_auth_schemas/);
  assert.match(deletes[0].sql, /field_name NOT IN \(\?\)/);
  assert.deepEqual(deletes[0].params, [42, "api_key"]);

  // provider_endpoints — keep list is the endpoint keys.
  assert.match(deletes[1].sql, /DELETE FROM provider_endpoints/);
  assert.match(deletes[1].sql, /endpoint_key NOT IN \(\?\)/);
  assert.deepEqual(deletes[1].params, [42, "chat"]);

  // provider_resource_types — keep list is the resource types.
  assert.match(deletes[2].sql, /DELETE FROM provider_resource_types/);
  assert.match(deletes[2].sql, /resource_type NOT IN \(\?\)/);
  assert.deepEqual(deletes[2].params, [42, "vector_index"]);
});

test("replaceChildren: empty section becomes a delete-all (no NOT IN)", async (t) => {
  const conn = makeFakeConn();
  currentConn = conn;
  stubUpserts(t, CatalogImportRepository);

  // Edit wiped every endpoint + resource type — the sections become the full
  // set, so ALL existing rows for this provider must be deleted.
  await importProviderDefinition(
    { ...DEF, endpoints: [], resources: [] },
    { replaceChildren: true, getPool: FAKE_GET_POOL }
  );

  const deletes = conn.queries.filter((q) => q.sql.startsWith("DELETE"));
  assert.equal(deletes.length, 3);

  assert.match(deletes[0].sql, /DELETE FROM provider_auth_schemas/);
  assert.match(deletes[0].sql, /field_name NOT IN \(\?\)/);
  assert.doesNotMatch(deletes[0].sql, /field_name NOT IN \(\)/, "non-empty section keeps NOT IN");

  // Empty keep-lists must not produce an invalid NOT IN () — the repository
  // guards them into a plain DELETE by provider_id (and the params hold only
  // the provider id, no NOT IN list).
  for (const d of deletes.slice(1)) {
    assert.match(d.sql, /DELETE FROM provider_/);
    assert.doesNotMatch(d.sql, /NOT IN/);
  }
  assert.deepEqual(deletes[1].params, [42]);
  assert.deepEqual(deletes[2].params, [42]);
});

test("default import (no replaceChildren) issues NO deletes", async (t) => {
  const conn = makeFakeConn();
  currentConn = conn;
  stubUpserts(t, CatalogImportRepository);

  await importProviderDefinition(DEF, { getPool: FAKE_GET_POOL });

  assert.equal(
    conn.queries.filter((q) => q.sql.startsWith("DELETE")).length,
    0,
    "pure upsert leaves rows outside the definition untouched"
  );
});

test("deletes run after the upserts, inside one transaction that commits", async (t) => {
  const conn = makeFakeConn();
  currentConn = conn;
  const upsertLog = stubUpserts(t, CatalogImportRepository, { spyDeletes: true });

  await importProviderDefinition(DEF, { replaceChildren: true, getPool: FAKE_GET_POOL });

  const deleteIndex = upsertLog.findIndex((name) => name.startsWith("delete"));
  assert.ok(deleteIndex !== -1, "delete methods are called");
  assert.ok(
    upsertLog.slice(0, deleteIndex).length >= 9,
    "upserts (provider, field, endpoint, capability, resource, model, pricing) precede deletes"
  );

  assert.equal(conn.calls.begin, 1, "transaction started");
  assert.equal(conn.calls.commit, 1, "transaction committed");
  assert.equal(conn.calls.rollback, 0, "no rollback on success");
  assert.equal(conn.calls.released, 1, "connection released");
});

test("capabilities, models, and pricing are never deleted (only the three child tables)", async (t) => {
  const conn = makeFakeConn();
  currentConn = conn;
  const upsertLog = stubUpserts(t, CatalogImportRepository);

  await importProviderDefinition(DEF, { replaceChildren: true, getPool: FAKE_GET_POOL });

  const deletes = conn.queries.filter((q) => q.sql.startsWith("DELETE"));
  for (const d of deletes) {
    assert.match(d.sql, /provider_auth_schemas|provider_endpoints|provider_resource_types/);
    assert.doesNotMatch(
      d.sql,
      /provider_capabilities|provider_models|pricing/,
      "capabilities/models/pricing are preserved across edit-wizard saves"
    );
  }
  // The upsert paths for those sections still ran (spy log proves it).
  assert.ok(upsertLog.includes("upsertCapability"));
  assert.ok(upsertLog.includes("upsertModel"));
  assert.ok(upsertLog.includes("insertPricing"));
});

test("a failing delete rolls the whole transaction back", async (t) => {
  const conn = makeFakeConn();
  conn.query = async (sql) => {
    if (sql.startsWith("DELETE")) throw new Error("FK constraint violated");
    return [];
  };
  currentConn = conn;
  stubUpserts(t, CatalogImportRepository);

  await assert.rejects(
    importProviderDefinition(DEF, { replaceChildren: true, getPool: FAKE_GET_POOL }),
    /FK constraint violated/
  );
  assert.equal(conn.calls.rollback, 1, "transaction rolled back on error");
  assert.equal(conn.calls.commit, 0);
  assert.equal(conn.calls.released, 1, "connection released even on error");
});

test("invalid definitions are rejected with 400 before any DB work", async () => {
  const conn = makeFakeConn();
  currentConn = conn;

  await assert.rejects(
    importProviderDefinition(
      { providerKey: "x", providerName: "", category: "nope" },
      { replaceChildren: true, getPool: FAKE_GET_POOL }
    ),
    (err) => err.status === 400 && /Validation failed/.test(err.message)
  );
  assert.equal(conn.queries.length, 0, "no queries touched the connection");
  assert.equal(conn.calls.begin, 0);
});
