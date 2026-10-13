// --------------------------
// ASSISTANT RESOLUTION TESTS — pure logic + override mapping.
// getSelectedAssistantKey / isRunnableModel are pure; resolveAssistantOverrides
// is stubbed at the repository boundary (no MySQL, no network) so we can pin
// the assistant → pipeline-override mapping. The config store is isolated in a
// temp dir (same pattern as graph-modules.test.js).
// --------------------------
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TEST_DIR = mkdtempSync(path.join(tmpdir(), "assistant-modules-"));
process.chdir(TEST_DIR);
process.env.CONFIG_STORE = "sqlite";

const { createCompany, updateCompany } = await import("../../config/index.js");
const { getSelectedAssistantKey, isRunnableModel, resolveAssistantOverrides } = await import("../assistant.js");
await createCompany("asstco");

// ------------------------------------------------------------------
// Stub the mysql repository objects used by resolveAssistantOverrides.
// The module lazy-imports ../mysql/repositories.js, which re-exports the
// same singleton objects these tests can monkey-patch before the import
// resolves — no pool, no network.
// ------------------------------------------------------------------
const repos = await import("../../mysql/repositories.js");

const COMPANY = { id: 7, company_key: "asstco" };
const ASSISTANT = {
  assistant_key: "support-bot",
  assistant_name: "Support Bot",
  is_active: true,
  system_prompt: "You are Support Bot.",
  model_key: "@cf/meta/llama-3.1-8b-instruct-fp8",
  temperature: 0.2,
  max_tokens: 900,
  enable_graph_context: true,
  primary_kb_id: 11,
  graph_resource_id: 22,
  enable_function_calling: false,
  tools: null,
  assistant_variables: [],
};
const KB = { id: 11, vector_external_id: "kb-vector-index", storage_external_id: "kb-storage-bucket" };
const GRAPH_RESOURCE = { id: 22, config: { database_name: "29de2844" } };

function stubRepos(overrides = {}) {
  const originals = {};
  const entries = {
    CompanyRepository: { findByKey: async (key) => (key === COMPANY.company_key ? COMPANY : null) },
    AssistantRepository: { findByKey: async (companyId, key) => (key === ASSISTANT.assistant_key ? ASSISTANT : null) },
    KbRepository: { findById: async (id) => (id === KB.id ? KB : null) },
    ResourceRepository: { findById: async (id) => (id === GRAPH_RESOURCE.id ? GRAPH_RESOURCE : null) },
  };
  for (const [modName, mod] of Object.entries(entries)) {
    originals[modName] = {};
    for (const [fn, fnImpl] of Object.entries(mod)) {
      originals[modName][fn] = repos[modName][fn];
      repos[modName][fn] = overrides[`${modName}.${fn}`] ?? fnImpl;
    }
  }
  return () => {
    for (const [modName, mod] of Object.entries(originals)) {
      for (const [fn, fnImpl] of Object.entries(mod)) {
        repos[modName][fn] = fnImpl;
      }
    }
  };
}

// ------------------------------------------------------------------
// Pure helpers
// ------------------------------------------------------------------

test("getSelectedAssistantKey reads ASSISTANT_KEY from the config store", async () => {
  assert.equal(getSelectedAssistantKey("asstco"), null);
  await updateCompany("asstco", { ASSISTANT_KEY: "support-bot" });
  assert.equal(getSelectedAssistantKey("asstco"), "support-bot");
});

test("isRunnableModel only accepts @cf/ and @cloudflare/ prefixes", () => {
  assert.equal(isRunnableModel("@cf/meta/llama-3.1-8b-instruct-fp8"), true);
  assert.equal(isRunnableModel("@cloudflare/coding-gemma"), true);
  assert.equal(isRunnableModel("gpt-4o"), false);
  assert.equal(isRunnableModel("text-embedding-3-small"), false);
  assert.equal(isRunnableModel(null), false);
  assert.equal(isRunnableModel(""), false);
});

// ------------------------------------------------------------------
// resolveAssistantOverrides — mapping + best-effort failures
// ------------------------------------------------------------------

test("resolveAssistantOverrides returns null when no assistant is selected", async () => {
  const restore = stubRepos();
  try {
    await updateCompany("asstco", { ASSISTANT_KEY: "" });
    assert.equal(await resolveAssistantOverrides("asstco"), null);
  } finally {
    restore();
  }
});

test("resolveAssistantOverrides maps the assistant into pipeline overrides", async () => {
  const restore = stubRepos();
  try {
    await updateCompany("asstco", { ASSISTANT_KEY: "support-bot" });
    const overrides = await resolveAssistantOverrides("asstco");
    assert.deepEqual(overrides, {
      assistantKey: "support-bot",
      assistantName: "Support Bot",
      systemPrompt: "You are Support Bot.",
      guardrailPrompt: null,
      blockedTopics: null,
    blockedPatterns: null,
      variables: [],
      model: "@cf/meta/llama-3.1-8b-instruct-fp8",
      temperature: 0.2,
      maxTokens: 900,
      vectorIndex: "kb-vector-index",
      storageBucket: "kb-storage-bucket",
      graphDatabase: "29de2844",
      enableGraph: true,
      enableFunctionCalling: false,
      tools: null,
    });
  } finally {
    restore();
  }
});

test("resolveAssistantOverrides resolves the graph DB from the assistant's graph resource", async () => {
  const restore = stubRepos({
    "ResourceRepository.findById": async () => ({ id: 22, config: { database_name: "custom-db" } }),
  });
  try {
    await updateCompany("asstco", { ASSISTANT_KEY: "support-bot" });
    const overrides = await resolveAssistantOverrides("asstco");
    assert.equal(overrides.graphDatabase, "custom-db");
  } finally {
    restore();
  }
});

test("resolveAssistantOverrides tolerates a missing graph resource / KB", async () => {
  const restore = stubRepos({
    "KbRepository.findById": async () => null,
    "ResourceRepository.findById": async () => null,
  });
  try {
    await updateCompany("asstco", { ASSISTANT_KEY: "support-bot" });
    const overrides = await resolveAssistantOverrides("asstco");
    assert.equal(overrides.vectorIndex, null);
    assert.equal(overrides.graphDatabase, null);
  } finally {
    restore();
  }
});

test("resolveAssistantOverrides returns null for an inactive or unknown assistant", async () => {
  const restore = stubRepos({
    "AssistantRepository.findByKey": async () => ({ ...ASSISTANT, is_active: false }),
  });
  try {
    await updateCompany("asstco", { ASSISTANT_KEY: "support-bot" });
    assert.equal(await resolveAssistantOverrides("asstco"), null);
  } finally {
    restore();
  }
});

test("resolveAssistantOverrides returns null when a repository throws", async () => {
  const restore = stubRepos({
    "CompanyRepository.findByKey": async () => {
      throw new Error("pool down");
    },
  });
  try {
    await updateCompany("asstco", { ASSISTANT_KEY: "support-bot" });
    assert.equal(await resolveAssistantOverrides("asstco"), null);
  } finally {
    restore();
  }
});

after(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});
