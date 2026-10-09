// --------------------------
// PROBE UNIT TESTS — probes.js classification, error-body parsing, and the
// schema-driven generic probe. Pure functions, no MySQL, no network (global
// fetch is stubbed wherever a probe would actually run).
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyStatus,
  parseProviderErrorMessage,
  pickKeyField,
  genericModelsUrl,
  buildGenericProbe,
  getProbe,
  probeNeo4j,
  PROBES,
} from "../routes/probes.js";

// ---- classifyStatus (9Router-style) ----

test("classifyStatus: 2xx is ok", () => {
  assert.deepEqual(classifyStatus(200), { ok: true });
  assert.deepEqual(classifyStatus(204), { ok: true });
});

test("classifyStatus: 401/403/other map to readable errors", () => {
  assert.deepEqual(classifyStatus(401), { ok: false, error: "Token invalid or revoked." });
  assert.deepEqual(classifyStatus(403), { ok: false, error: "Access denied." });
  assert.deepEqual(classifyStatus(500), { ok: false, error: "API returned HTTP 500." });
});

test("classifyStatus: acceptStatuses prove auth on non-2xx", () => {
  assert.deepEqual(classifyStatus(400, { acceptStatuses: [400] }), { ok: true });
  assert.deepEqual(classifyStatus(429, { acceptStatuses: [400, 429] }), { ok: true });
  assert.deepEqual(classifyStatus(402, { acceptStatuses: [400] }), {
    ok: false,
    error: "API returned HTTP 402.",
  });
});

test("classifyStatus: softFailMessages surface a warning on an accepted status", () => {
  assert.deepEqual(
    classifyStatus(402, { acceptStatuses: [402], softFailMessages: { 402: "Quota exhausted." } }),
    { ok: true, warning: "Quota exhausted." }
  );
});

// ---- parseProviderErrorMessage ----

test("parseProviderErrorMessage: extracts nested error.message from provider bodies", () => {
  assert.equal(parseProviderErrorMessage(JSON.stringify({ error: { message: "Invalid API key" } }), "fallback"), "Invalid API key");
  assert.equal(parseProviderErrorMessage(JSON.stringify({ message: "plain message" }), "fallback"), "plain message");
  assert.equal(parseProviderErrorMessage(JSON.stringify({ errors: [{ message: "boom" }] }), "fallback"), "boom");
});

test("parseProviderErrorMessage: falls back for empty / non-JSON bodies", () => {
  assert.equal(parseProviderErrorMessage("", "fallback"), "fallback");
  assert.equal(parseProviderErrorMessage("  ", "fallback"), "fallback");
  assert.equal(parseProviderErrorMessage("not json at all", "fallback"), "not json at all");
});

// ---- generic probe helpers ----

test("pickKeyField: prefers key/token-named secrets over other secret fields", () => {
  const form = [
    { field_name: "account_id", is_encrypted: 1, field_type: "text" },
    { field_name: "api_token", is_encrypted: 1, field_type: "password" },
  ];
  assert.equal(pickKeyField(form).field_name, "api_token");
  assert.equal(pickKeyField([{ field_name: "secret", is_encrypted: 0, field_type: "password" }]).field_name, "secret");
  assert.equal(pickKeyField([{ field_name: "region", is_encrypted: 0, field_type: "text" }]), null);
});

test("genericModelsUrl: derives the OpenAI-style /models URL from a base URL", () => {
  assert.equal(genericModelsUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/models");
  assert.equal(genericModelsUrl("https://api.groq.com/openai/v1/"), "https://api.groq.com/openai/v1/models");
  assert.equal(genericModelsUrl("https://api.mistral.ai"), "https://api.mistral.ai/v1/models");
  assert.equal(genericModelsUrl("https://example.com/v1beta"), "https://example.com/v1beta/models");
  assert.equal(genericModelsUrl("https://example.com/models"), "https://example.com/models");
});

// ---- buildGenericProbe ----

function provider(overrides = {}) {
  return {
    provider_key: "acme-ai",
    provider_name: "Acme AI",
    primary_service_category: "ai",
    default_api_base_url: "https://api.acme.example/v1",
    auth_type: "bearer_token",
    auth_header_name: "Authorization",
    authForm: [{ field_name: "api_key", field_label: "API Key", field_type: "password", is_encrypted: 1 }],
    ...overrides,
  };
}

test("buildGenericProbe: returns null when metadata is missing or unsuitable", () => {
  assert.equal(buildGenericProbe(null), null);
  assert.equal(buildGenericProbe(provider({ default_api_base_url: null })), null);
  assert.equal(buildGenericProbe(provider({ auth_header_name: null })), null);
  assert.equal(buildGenericProbe(provider({ authForm: [] })), null);
  assert.equal(buildGenericProbe(provider({ auth_type: "oauth" })), null);
  assert.equal(buildGenericProbe(provider({ auth_type: "basic_auth" })), null);
  assert.equal(buildGenericProbe(provider({ auth_type: "custom" })), null);
  assert.equal(buildGenericProbe(provider({ auth_header_name: "key" })), null); // query-param auth
  assert.equal(buildGenericProbe(provider({ primary_service_category: "vector" })), null);
});

test("buildGenericProbe: probes GET {base}/models with Authorization: Bearer", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => "" };
  };
  try {
    const probe = buildGenericProbe(provider());
    assert.ok(probe, "generic probe should be built");
    const result = await probe({ api_key: "sk-abc" });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.acme.example/v1/models");
    assert.equal(calls[0].opts.headers.Authorization, "Bearer sk-abc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildGenericProbe: uses the configured header name verbatim (x-api-key)", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => "" };
  };
  try {
    const probe = buildGenericProbe(provider({ auth_header_name: "x-api-key", auth_type: "api_key" }));
    await probe({ api_key: "sk-abc" });
    assert.equal(calls[0].opts.headers["x-api-key"], "sk-abc");
    assert.equal(calls[0].opts.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildGenericProbe: propagates 401 as a readable error and parses the provider body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: "Invalid authentication credentials" } }),
  });
  try {
    const probe = buildGenericProbe(provider());
    const result = await probe({ api_key: "sk-bad" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "Invalid authentication credentials");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildGenericProbe: missing key value fails fast without a network call", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  try {
    const probe = buildGenericProbe(provider());
    const result = await probe({});
    assert.equal(result.ok, false);
    assert.match(result.error, /API Key is required/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getProbe: hand-written probe wins over the generic one", () => {
  const p = provider();
  assert.equal(getProbe("openai", p), PROBES.openai);
  assert.equal(getProbe("anthropic", p), PROBES.anthropic);
  assert.notEqual(getProbe("acme-ai", p), PROBES.openai);
});

// ---- declarative per-provider probes (9Router testUtils-style) ----

test("declarative probes: deepseek GET /models with Bearer", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => "" };
  };
  try {
    const result = await PROBES.deepseek({ api_key: "sk-abc" });
    assert.equal(result.ok, true);
    assert.equal(calls[0].url, "https://api.deepseek.com/models");
    assert.equal(calls[0].opts.headers.Authorization, "Bearer sk-abc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("declarative probes: openrouter uses its dedicated auth/key endpoint", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => "" };
  };
  try {
    await PROBES.openrouter({ api_key: "sk-or-v1-abc" });
    assert.equal(calls[0].url, "https://openrouter.ai/api/v1/auth/key");
    assert.equal(calls[0].opts.headers.Authorization, "Bearer sk-or-v1-abc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("declarative probes: deepgram uses the Token prefix", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => "" };
  };
  try {
    await PROBES.deepgram({ api_key: "dk-abc" });
    assert.equal(calls[0].url, "https://api.deepgram.com/v1/projects");
    assert.equal(calls[0].opts.headers.Authorization, "Token dk-abc");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("declarative probes: gemini passes the key as a ?key= query param", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => "" };
  };
  try {
    await PROBES.gemini({ api_key: "AIza123" });
    assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models?key=AIza123");
    assert.equal(calls[0].opts.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("declarative probes: anthropic-style providers accept 400/429 as auth-proven", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { message: "Unknown model" } }),
  });
  try {
    const result = await PROBES.minimax({ api_key: "mk-abc" });
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("declarative probes: missing key fails fast", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  try {
    const result = await PROBES.groq({});
    assert.equal(result.ok, false);
    assert.match(result.error, /API key missing/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---- neo4j probe (system-database fallback + resource DB verification) ----
// probeNeo4j accepts an injected driver factory (test seam) — no network, no
// dependency install. The fake records which database each session targeted
// and simulates SHOW DATABASES.
function fakeDriverFactory({ sessions, databases = ["system"] } = {}) {
  return async () => ({
    session: ({ database }) => {
      sessions.push(database);
      return {
        run: async (q) =>
          q === "SHOW DATABASES"
            ? { records: databases.map((name) => ({ get: () => name })) }
            : { records: [] },
        close: async () => {},
      };
    },
    close: async () => {},
  });
}

test("neo4j probe: connectivity runs against the system database when no database is given", async () => {
  const sessions = [];
  const result = await probeNeo4j(
    { uri: "neo4j+s://x.databases.neo4j.io", username: "u", password: "p" },
    fakeDriverFactory({ sessions })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(sessions, ["system"]);
});

test("neo4j probe: missing fields fail fast without connecting", async () => {
  const result = await probeNeo4j(
    { uri: "neo4j+s://x.databases.neo4j.io" },
    async () => {
      throw new Error("driver should not be created");
    }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /required/);
});

test("neo4j probe: verifies the named database exists via SHOW DATABASES", async () => {
  const sessions = [];
  const result = await probeNeo4j(
    { uri: "neo4j+s://x.databases.neo4j.io", username: "u", password: "p", database: "b9b3f090" },
    fakeDriverFactory({ sessions, databases: ["b9b3f090", "system"] })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(sessions, ["system"]);
});

test("neo4j probe: reports a clear error when the named database does not exist", async () => {
  const sessions = [];
  const result = await probeNeo4j(
    { uri: "neo4j+s://x.databases.neo4j.io", username: "u", password: "p", database: "ghost-db" },
    fakeDriverFactory({ sessions, databases: ["system"] })
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /database 'ghost-db' does not exist/);
  assert.match(result.error, /available: system/);
});

test("neo4j probe: connection failures surface the driver error", async () => {
  const result = await probeNeo4j(
    { uri: "neo4j+s://x.databases.neo4j.io", username: "u", password: "p" },
    async () => {
      throw new Error("No routing servers available");
    }
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Neo4j connection failed: No routing servers available/);
  assert.equal(typeof result.latencyMs, "number");
});

// ---- pinecone probe ----

test("pinecone probe: GETs control-plane /indexes with Api-Key + version headers", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => "" };
  };
  try {
    const result = await PROBES.pinecone({ api_key: "pc-test-key" });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.pinecone.io/indexes");
    assert.equal(calls[0].opts.headers["Api-Key"], "pc-test-key");
    assert.equal(calls[0].opts.headers["X-Pinecone-API-Version"], "2025-01");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pinecone probe: 401 becomes a readable auth error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: "Invalid API key" } }),
  });
  try {
    const result = await PROBES.pinecone({ api_key: "pc-bad" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "Invalid API key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pinecone probe: missing key fails fast without a network call", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  try {
    const result = await PROBES.pinecone({});
    assert.equal(result.ok, false);
    assert.match(result.error, /Pinecone API key missing/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getProbe: pinecone resolves to the hand-written probe", () => {
  const p = provider({ provider_key: "pinecone" });
  assert.equal(getProbe("pinecone", p), PROBES.pinecone);
});

// ---- qdrant + weaviate probes ----

test("qdrant probe: GETs {host}/collections and sends api-key only when provided", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => "" };
  };
  try {
    const withKey = await PROBES.qdrant({ host: "https://xyz.cloud.qdrant.io:6333", api_key: "qd-key" });
    assert.equal(withKey.ok, true);
    assert.equal(calls[0].url, "https://xyz.cloud.qdrant.io:6333/collections");
    assert.equal(calls[0].opts.headers["api-key"], "qd-key");

    const noKey = await PROBES.qdrant({ host: "http://localhost:6333/" });
    assert.equal(noKey.ok, true);
    assert.equal(calls[1].url, "http://localhost:6333/collections");
    assert.equal(calls[1].opts.headers["api-key"], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("qdrant probe: missing host fails fast without a network call", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  try {
    const result = await PROBES.qdrant({});
    assert.equal(result.ok, false);
    assert.match(result.error, /Qdrant host missing/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("weaviate probe: GETs {host}/v1/schema with Bearer auth only when provided", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, text: async () => "" };
  };
  try {
    const withKey = await PROBES.weaviate({ host: "https://xyz.weaviate.cloud", api_key: "wv-key" });
    assert.equal(withKey.ok, true);
    assert.equal(calls[0].url, "https://xyz.weaviate.cloud/v1/schema");
    assert.equal(calls[0].opts.headers.Authorization, "Bearer wv-key");

    const noKey = await PROBES.weaviate({ host: "http://localhost:8080" });
    assert.equal(noKey.ok, true);
    assert.equal(calls[1].opts.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("weaviate probe: missing host fails fast without a network call", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  try {
    const result = await PROBES.weaviate({});
    assert.equal(result.ok, false);
    assert.match(result.error, /Weaviate host missing/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getProbe: qdrant and weaviate resolve to hand-written probes", () => {
  const p = provider({ provider_key: "qdrant" });
  assert.equal(getProbe("qdrant", p), PROBES.qdrant);
  assert.equal(getProbe("weaviate", p), PROBES.weaviate);
});
