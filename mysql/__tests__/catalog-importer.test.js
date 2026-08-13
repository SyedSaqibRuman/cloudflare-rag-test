// --------------------------
// CATALOG IMPORTER TESTS — pure validation, no MySQL needed.
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateProviderDefinition,
  HTTP_METHODS,
  MODEL_CATEGORIES,
} from "../services/catalog-importer.js";

const OPENAI_DEF = {
  provider: {
    key: "openai",
    name: "OpenAI",
    category: "ai",
    website: "https://openai.com",
    documentation: "https://platform.openai.com/docs",
  },
  authentication: {
    fields: [
      { name: "api_key", label: "API Key", type: "password", required: true, encrypted: true },
    ],
  },
  endpoints: [],
  capabilities: ["text_generation", "embeddings"],
  models: [],
  resources: [],
};

test("accepts a fully valid provider definition (wrapped shape)", () => {
  const result = validateProviderDefinition(OPENAI_DEF);
  assert.equal(result.ok, true);
  assert.equal(result.value.providerKey, "openai");
  assert.equal(result.value.category, "ai");
  assert.equal(result.value.authFields.length, 1);
  assert.equal(result.value.authFields[0].fieldName, "api_key");
  assert.equal(result.value.authFields[0].isEncrypted, true);
  assert.deepEqual(result.value.capabilities, [
    { capabilityKey: "text_generation" },
    { capabilityKey: "embeddings" },
  ]);
});

test("accepts the flat shape (providerKey/providerName/authFields)", () => {
  const result = validateProviderDefinition({
    providerKey: "neo4j",
    providerName: "Neo4j",
    category: "graph",
    authType: "basic_auth",
    authFields: [{ name: "uri", label: "Bolt URI", type: "url" }],
    capabilities: [],
    endpoints: [],
    models: [],
    resources: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.providerKey, "neo4j");
  assert.equal(result.value.authType, "basic_auth");
});

test("rejects missing/invalid provider key, name, and category", () => {
  const bad = validateProviderDefinition({ provider: {} });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.providerKey, "providerKey error expected");
  assert.ok(bad.errors.providerName, "providerName error expected");
  assert.ok(bad.errors.category, "category error expected");

  const badKey = validateProviderDefinition({
    ...OPENAI_DEF,
    provider: { ...OPENAI_DEF.provider, key: "Open AI!" },
  });
  assert.equal(badKey.ok, false);
  assert.ok(badKey.errors.providerKey);

  const badCat = validateProviderDefinition({
    ...OPENAI_DEF,
    provider: { ...OPENAI_DEF.provider, category: "quantum" },
  });
  assert.equal(badCat.ok, false);
  assert.ok(badCat.errors.category);
});

test("rejects unknown auth field types and bad select options", () => {
  const result = validateProviderDefinition({
    ...OPENAI_DEF,
    authentication: {
      fields: [
        { name: "api_key", label: "API Key", type: "spooky" },
        { name: "region", label: "Region", type: "select", selectOptions: "not-json" },
      ],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors["authFields[0].type"]);
  assert.ok(result.errors["authFields[1].selectOptions"]);
});

test("rejects malformed endpoints and unknown http methods", () => {
  const result = validateProviderDefinition({
    ...OPENAI_DEF,
    endpoints: [
      { key: "Chat Completions", name: "Chat", url: "https://api.openai.com/v1" },
      { key: "chat", name: "Chat", url: "not a url", method: "TRACE" },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors["endpoints[0].key"]);
  assert.ok(result.errors["endpoints[1].url"]);
  assert.ok(result.errors["endpoints[1].method"]);
  assert.ok(HTTP_METHODS.includes("POST"));
});

test("rejects models with bad category or bad pricing dates, accepts pricing", () => {
  const withPricing = validateProviderDefinition({
    ...OPENAI_DEF,
    models: [
      {
        key: "gpt-4o",
        name: "GPT-4o",
        category: "chat",
        streaming: true,
        pricing: [{ inputPricePerMillion: 2.5, outputPricePerMillion: 10 }],
      },
    ],
  });
  assert.equal(withPricing.ok, true);
  assert.equal(withPricing.value.models[0].pricing.length, 1);
  assert.match(withPricing.value.models[0].pricing[0].effectiveFrom, /^\d{4}-\d{2}-\d{2}$/);

  const bad = validateProviderDefinition({
    ...OPENAI_DEF,
    models: [
      { key: "gpt-4o", name: "GPT-4o", category: "chatbot", pricing: [{ effectiveFrom: "yesterday" }] },
    ],
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors["models[0].category"]);
  assert.ok(bad.errors["models[0].pricing[0].effectiveFrom"]);
  assert.ok(MODEL_CATEGORIES.includes("chat"));
});

test("rejects unknown resource types", () => {
  const result = validateProviderDefinition({
    ...OPENAI_DEF,
    resources: [{ type: "black_hole", displayName: "Black Hole" }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors["resources[0].type"]);
});

test("rejects non-array sections", () => {
  const result = validateProviderDefinition({
    ...OPENAI_DEF,
    endpoints: "none",
    models: 42,
    capabilities: {},
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.endpoints);
  assert.ok(result.errors.models);
  assert.ok(result.errors.capabilities);
});

test("rejects bad URLs on the provider", () => {
  const result = validateProviderDefinition({
    ...OPENAI_DEF,
    provider: { ...OPENAI_DEF.provider, website: "nope" },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.website);
});