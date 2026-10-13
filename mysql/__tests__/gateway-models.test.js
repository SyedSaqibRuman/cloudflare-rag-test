// --------------------------
// GATEWAY MODEL ROUTE TESTS — POST /gateway/providers/:key/models (upsert a
// single provider model with optional pricing), exercised through a real
// express mount with stubbed repositories (no MySQL, no network). The router
// imports `* as Registry` (a frozen ESM namespace), so the registry cache is
// seeded through the mutable repository objects + invalidateRegistry()/
// refreshRegistry(), exactly like gateway-resources.test.js.
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

// The router's `gate` middleware reads env.MYSQL_* at import time (env.js
// freezes them), so set dummies BEFORE any gateway module is imported. All
// repository methods are stubbed below, so the lazy pool is never touched.
process.env.MYSQL_HOST = "127.0.0.1";
process.env.MYSQL_DATABASE = "gateway_test";
process.env.MYSQL_USER = "test";
process.env.MYSQL_PASSWORD = "test";

const {
  ProviderRepository,
  ModelRepository,
  EndpointRepository,
  PricingRepository,
  AuditRepository,
} = await import("../repositories.js");
const Registry = await import("../services/provider-registry.js");
const { _usePoolForTests, closePool } = await import("../pool.js");
const gatewayRouter = (await import("../gateway-router.js")).default;

const PROVIDER = { id: 1, provider_key: "openai", provider_name: "OpenAI" };

const VALID_BODY = {
  key: "gpt-4o",
  name: "GPT-4o",
  category: "chat",
  streaming: true,
  functionCalling: true,
  vision: false,
  maxContextWindow: 128000,
};

/** Stub a repository method, returning a restore function. */
function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

/** Seed the registry cache with a provider (see gateway-resources tests). */
async function seedRegistry({ provider = PROVIDER } = {}) {
  const restores = [
    stub(ProviderRepository, "list", async () => [provider]),
    stub(ProviderRepository, "capabilitiesByProviderIds", async () => []),
    stub(ProviderRepository, "authFormsByProviderIds", async () => []),
    stub(ProviderRepository, "resourceTemplatesByProviderIds", async () => []),
    stub(ModelRepository, "listByProviderIds", async () => []),
    stub(EndpointRepository, "listByProviderIds", async () => []),
  ];
  Registry.invalidateRegistry();
  await Registry.refreshRegistry();
  return () => {
    restores.forEach((r) => r());
    Registry.invalidateRegistry();
  };
}

/** Happy path: registry seeded, model upsert succeeds, audit captured. */
async function stubHappy() {
  const auditLog = [];
  const calls = { upsertArgs: null, pricingArgs: [] };
  const registryRestore = await seedRegistry();
  const restores = [
    registryRestore,
    stub(ModelRepository, "upsert", async (providerId, m) => {
      calls.upsertArgs = { providerId, m };
      return 42;
    }),
    // The route closes any open-ended price row before inserting (D3 invariant).
    stub(PricingRepository, "closeCurrent", async () => {}),
    stub(PricingRepository, "create", async (modelId, input) => {
      calls.pricingArgs.push({ modelId, input });
      return 7;
    }),
    stub(AuditRepository, "log", async (entry) => {
      auditLog.push(entry);
    }),
  ];
  return { restores, auditLog, calls };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/gateway", gatewayRouter);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function req(server, method, urlPath, body) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { res, json };
}

// ------------------------------------------------------------------
// POST /gateway/providers/:key/models — validation
// ------------------------------------------------------------------

test("POST model returns 404 for an unknown provider", async () => {
  const restores = [
    stub(ProviderRepository, "list", async () => []),
    stub(ProviderRepository, "capabilitiesByProviderIds", async () => []),
    stub(ProviderRepository, "authFormsByProviderIds", async () => []),
    stub(ProviderRepository, "resourceTemplatesByProviderIds", async () => []),
    stub(ModelRepository, "listByProviderIds", async () => []),
    stub(EndpointRepository, "listByProviderIds", async () => []),
  ];
  Registry.invalidateRegistry();
  await Registry.refreshRegistry();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/providers/ghost/models", VALID_BODY);
    assert.equal(res.status, 404);
    assert.match(json.error, /Unknown provider 'ghost'/);
  } finally {
    restores.forEach((r) => r());
    Registry.invalidateRegistry();
    server.close();
  }
});

test("POST model rejects an invalid model key with 400", async () => {
  const { restores } = await stubHappy();
  const server = await listen(makeApp());
  try {
    // Spaces and ! are not in the charset; 101 chars is over the limit.
    for (const key of ["bad key", "UPPER CASE", "slash/name!", "a".repeat(101)]) {
      const { res, json } = await req(server, "POST", "/gateway/providers/openai/models", {
        ...VALID_BODY,
        key,
      });
      assert.equal(res.status, 400, `should reject key '${key}'`);
      assert.match(json.error, /Model key must be/);
    }
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("POST model accepts vendor-prefixed model keys (@cf/..., xai/...) with 201", async () => {
  const { restores, calls } = await stubHappy();
  const server = await listen(makeApp());
  try {
    for (const key of [
      "@cf/baai/bge-base-en-v1.5",
      "@cf/moondream/moondream3.1-9B-A2B",
      "xai/grok-4.6",
    ]) {
      const { res, json } = await req(server, "POST", "/gateway/providers/openai/models", {
        ...VALID_BODY,
        key,
        name: key,
      });
      assert.equal(res.status, 201, `should accept key '${key}'`);
      assert.equal(json.success, true);
      assert.equal(calls.upsertArgs.m.modelKey, key);
    }
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("POST model rejects a missing name with 400", async () => {
  const { restores } = await stubHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/providers/openai/models", {
      ...VALID_BODY,
      name: "",
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Model name is required/);
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("POST model rejects a category outside the schema ENUM with 400", async () => {
  const { restores } = await stubHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/providers/openai/models", {
      ...VALID_BODY,
      category: "hologram",
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Category must be one of/);
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

// ------------------------------------------------------------------
// POST /gateway/providers/:key/models — success
// ------------------------------------------------------------------

test("POST model upserts the model row, invalidates the registry, and audits", async () => {
  const { restores, auditLog, calls } = await stubHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/providers/openai/models", VALID_BODY);
    assert.equal(res.status, 201);
    assert.equal(json.success, true);
    assert.equal(json.modelId, 42);
    assert.match(json.message, /upserted/);
    assert.equal(calls.upsertArgs.providerId, 1);
    assert.deepEqual(calls.upsertArgs.m, {
      modelKey: "gpt-4o",
      modelName: "GPT-4o",
      modelFamily: null,
      category: "chat",
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsVision: false,
      maxContextWindow: 128000,
      maxOutputTokens: null,
      thinkingMode: "auto",
    });
    assert.equal(calls.pricingArgs.length, 0);
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "provider.model.upserted");
    assert.equal(auditLog[0].entityType, "provider_model");
    assert.equal(auditLog[0].entityId, 42);
    assert.deepEqual(auditLog[0].afterState, {
      provider_key: "openai",
      model_key: "gpt-4o",
      category: "chat",
    });
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("POST model adds pricing rows when provided", async () => {
  const { restores, calls } = await stubHappy();
  // The route wraps the close+insert batch in one transaction via getPool().
  // ESM namespaces are frozen, so inject a fake pool through the test seam
  // and assert the transaction lifecycle actually runs.
  const tx = { begin: 0, commit: 0, rollback: 0 };
  const fakeConn = {
    beginTransaction: async () => { tx.begin += 1; },
    commit: async () => { tx.commit += 1; },
    rollback: async () => { tx.rollback += 1; },
    release: () => {},
    end: async () => {},
  };
  _usePoolForTests({ getConnection: async () => fakeConn, end: async () => {} });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/gateway/providers/openai/models", {
      ...VALID_BODY,
      pricing: [{ inputPricePerMillion: 2.5, outputPricePerMillion: 10 }],
    });
    assert.equal(res.status, 201);
    assert.match(json.message, /1 price row/);
    assert.equal(calls.pricingArgs.length, 1);
    assert.equal(calls.pricingArgs[0].modelId, 42);
    assert.equal(calls.pricingArgs[0].input.inputPricePerMillion, 2.5);
    assert.equal(calls.pricingArgs[0].input.outputPricePerMillion, 10);
    // effectiveFrom defaults to today (YYYY-MM-DD).
    assert.match(calls.pricingArgs[0].input.effectiveFrom, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(calls.pricingArgs[0].input.priceCurrency, "USD");
    // One open/commit cycle — no rollback on the happy path.
    assert.equal(tx.begin, 1);
    assert.equal(tx.commit, 1);
    assert.equal(tx.rollback, 0);
  } finally {
    restores.forEach((r) => r());
    server.close();
    await closePool(); // clears the injected fake pool
  }
});

// ------------------------------------------------------------------
// PUT /gateway/providers/:key/models/:id
// ------------------------------------------------------------------

// Existing model row as ModelRepository.findById returns it (snake_case).
const MODEL = {
  id: 9,
  provider_id: 1,
  provider_key: "openai",
  model_key: "gpt-4o",
  model_name: "GPT-4o",
  model_family: "gpt-4",
  category: "chat",
  supports_streaming: 1,
  supports_function_calling: 1,
  supports_vision: 0,
  max_context_window: 128000,
  max_output_tokens: 4096,
  is_deprecated: 0,
};

/** Happy-path stubs for PUT/DELETE: registry seeded, model resolves + owned. */
async function stubModelHappy() {
  const auditLog = [];
  const calls = { updateArgs: null, removedId: null };
  const registryRestore = await seedRegistry();
  const restores = [
    registryRestore,
    stub(ModelRepository, "findById", async (id) =>
      Number(id) === MODEL.id ? MODEL : null
    ),
    stub(ModelRepository, "update", async (id, input) => {
      calls.updateArgs = { id, input };
      return true;
    }),
    stub(ModelRepository, "remove", async (id) => {
      calls.removedId = id;
      return true;
    }),
    stub(AuditRepository, "log", async (entry) => {
      auditLog.push(entry);
    }),
  ];
  return { restores, auditLog, calls };
}

test("PUT model returns 404 for an unknown model id", async () => {
  const { restores } = await stubModelHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/providers/openai/models/999", {
      name: "GPT-4o v2",
    });
    assert.equal(res.status, 404);
    assert.match(json.error, /Model '999' not found/);
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("PUT model returns 404 for a model owned by a different provider", async () => {
  const { restores } = await stubModelHappy();
  const restoreFind = stub(ModelRepository, "findById", async () => ({ ...MODEL, provider_id: 42 }));
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/providers/openai/models/9", {
      name: "GPT-4o v2",
    });
    assert.equal(res.status, 404);
    assert.match(json.error, /not found for provider/);
  } finally {
    restoreFind();
    restores.forEach((r) => r());
    server.close();
  }
});

test("PUT model renames the key, passes it to the repository, and audits before/after", async () => {
  const { restores, auditLog, calls } = await stubModelHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/providers/openai/models/9", {
      key: "gpt-4o-renamed",
      name: "GPT-4o v2",
    });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.modelId, 9);
    assert.match(json.message, /renamed and updated/);
    assert.equal(calls.updateArgs.input.modelKey, "gpt-4o-renamed");
    assert.deepEqual(auditLog[0].beforeState, { provider_key: "openai", model_key: "gpt-4o" });
    assert.deepEqual(auditLog[0].afterState, { provider_key: "openai", model_key: "gpt-4o-renamed", category: "chat" });
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("PUT model rejects a rename onto an existing key with 409 (ER_DUP_ENTRY)", async () => {
  const { restores } = await stubModelHappy();
  const restoreUpdate = stub(ModelRepository, "update", async () => {
    throw { code: "ER_DUP_ENTRY" };
  });
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/providers/openai/models/9", {
      key: "gpt-4o", // collides with another model on the same provider
    });
    assert.equal(res.status, 409);
    assert.match(json.error, /already exists/);
  } finally {
    restoreUpdate();
    restores.forEach((r) => r());
    server.close();
  }
});

test("PUT model rejects an invalid renamed key with 400", async () => {
  const { restores } = await stubModelHappy();
  const server = await listen(makeApp());
  try {
    for (const key of ["bad key", "UPPER CASE", "a".repeat(101)]) {
      const { res, json } = await req(server, "PUT", "/gateway/providers/openai/models/9", {
        key,
      });
      assert.equal(res.status, 400, `should reject renamed key '${key}'`);
      assert.match(json.error, /Model key must be/);
    }
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("PUT model rejects a category outside the ENUM with 400", async () => {
  const { restores } = await stubModelHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/providers/openai/models/9", {
      category: "hologram",
    });
    assert.equal(res.status, 400);
    assert.match(json.error, /Category must be one of/);
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("PUT model merges a partial update, keeps the key, and audits", async () => {
  const { restores, auditLog, calls } = await stubModelHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "PUT", "/gateway/providers/openai/models/9", {
      name: "GPT-4o v2",
      streaming: false,
      maxContextWindow: 200000,
    });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.modelId, 9);
    assert.match(json.message, /updated/);
    assert.equal(calls.updateArgs.id, 9);
    assert.deepEqual(calls.updateArgs.input, {
      modelKey: "gpt-4o", // key is editable now, so it's always passed through
      modelName: "GPT-4o v2",
      modelFamily: "gpt-4",
      category: "chat",
      supportsStreaming: false,
      supportsFunctionCalling: true,
      supportsVision: false,
      maxContextWindow: 200000,
      maxOutputTokens: 4096,
      thinkingMode: "auto",
    });
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "provider.model.updated");
    assert.equal(auditLog[0].entityId, 9);
    assert.deepEqual(auditLog[0].beforeState, { provider_key: "openai", model_key: "gpt-4o" });
    assert.deepEqual(auditLog[0].afterState, { provider_key: "openai", model_key: "gpt-4o", category: "chat" });
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

// ------------------------------------------------------------------
// DELETE /gateway/providers/:key/models/:id
// ------------------------------------------------------------------

test("DELETE model returns 404 for an unknown model id", async () => {
  const { restores } = await stubModelHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/providers/openai/models/999");
    assert.equal(res.status, 404);
    assert.match(json.error, /Model '999' not found/);
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});

test("DELETE model hard-deletes (pricing + model access CASCADE) and audits", async () => {
  const { restores, auditLog, calls } = await stubModelHappy();
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "DELETE", "/gateway/providers/openai/models/9");
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.match(json.message, /deleted/);
    assert.equal(calls.removedId, 9);
    assert.equal(auditLog.length, 1);
    assert.equal(auditLog[0].action, "provider.model.deleted");
    assert.equal(auditLog[0].entityId, 9);
    assert.deepEqual(auditLog[0].afterState, { provider_key: "openai", model_key: "gpt-4o" });
  } finally {
    restores.forEach((r) => r());
    server.close();
  }
});
