// --------------------------
// ASSISTANT SERVICE TESTS — pure validation + stubbed writers, no MySQL.
// Mirrors kb-service.test.js: validation is DB-free; the writer tests stub
// repository methods directly (try/finally) since the service imports the
// mutable repository objects.
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ASSISTANT_KEY_RE,
  HttpError,
  validateAssistantInput,
  saveAssistant,
  updateAssistant,
  removeAssistant,
} from "../services/assistant-service.js";
import {
  AssistantRepository,
  CredentialRepository,
  ModelRepository,
  KbRepository,
  ResourceRepository,
  AuditRepository,
} from "../repositories.js";

const VALID_INPUT = {
  assistantKey: "sales-bot",
  assistantName: "Sales Bot",
  credentialId: 3,
  modelId: 9,
};

const COMPANY = { id: 2, company_key: "popularcert", max_assistants: 5 };

/** Stub a repository method, returning a restore function. */
function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

/** Stub the happy-path repository reads used by save/update. */
function stubHappyOwnership() {
  const restores = [
    stub(CredentialRepository, "findById", async () => ({
      id: 3,
      company_id: 2,
      provider_id: 7,
      credential_key: "cf-main",
    })),
    stub(ModelRepository, "findById", async () => ({
      id: 9,
      provider_id: 7,
      model_key: "gpt-4o",
    })),
    stub(KbRepository, "findById", async (kbId) =>
      [4, 5].includes(Number(kbId)) ? { id: Number(kbId), company_id: 2 } : null
    ),
  ];
  return () => restores.forEach((r) => r());
}

// ------------------------------------------------------------------
// VALIDATION (pure, no DB)
// ------------------------------------------------------------------

test("validateAssistantInput rejects missing assistantKey/assistantName/credentialId", () => {
  const result = validateAssistantInput({});
  assert.equal(result.ok, false);
  assert.ok(result.errors.assistantKey);
  assert.ok(result.errors.assistantName);
  assert.ok(result.errors.credentialId);
});

test("rejects assistantKey with uppercase/spaces/underscore (ASSISTANT_KEY_RE)", () => {
  for (const bad of ["SalesBot", "sales bot", "sales_bot", "sales.bot"]) {
    const result = validateAssistantInput({ ...VALID_INPUT, assistantKey: bad });
    assert.equal(result.ok, false, `should reject '${bad}'`);
    assert.ok(result.errors.assistantKey);
  }
  assert.equal(ASSISTANT_KEY_RE.test("sales-bot"), true);
});

test("rejects assistantKey < 3 or > 63 chars", () => {
  for (const bad of ["ab", "a".repeat(64)]) {
    const result = validateAssistantInput({ ...VALID_INPUT, assistantKey: bad });
    assert.equal(result.ok, false, `should reject length ${bad.length}`);
    assert.ok(result.errors.assistantKey);
  }
});

test("rejects assistantName > 200 chars", () => {
  const result = validateAssistantInput({ ...VALID_INPUT, assistantName: "a".repeat(201) });
  assert.equal(result.ok, false);
  assert.ok(result.errors.assistantName);
});

test("rejects missing/non-positive credentialId", () => {
  for (const bad of [undefined, null, 0, -3, 1.5, "abc"]) {
    const result = validateAssistantInput({ ...VALID_INPUT, credentialId: bad });
    assert.equal(result.ok, false, `should reject credentialId ${JSON.stringify(bad)}`);
    assert.ok(result.errors.credentialId);
  }
});

test("rejects non-positive modelId/primaryKbId/graphResourceId when set", () => {
  for (const field of ["modelId", "primaryKbId", "graphResourceId"]) {
    for (const bad of [0, -1, 1.5, "abc"]) {
      const result = validateAssistantInput({ ...VALID_INPUT, [field]: bad });
      assert.equal(result.ok, false, `should reject ${field}=${JSON.stringify(bad)}`);
      assert.ok(result.errors[field]);
    }
  }
});

test("rejects kbIds that are not an array of positive integers; accepts null", () => {
  for (const bad of ["1,2", 3, {}, [1, -2], [1.5], ["a"]]) {
    const result = validateAssistantInput({ ...VALID_INPUT, kbIds: bad });
    assert.equal(result.ok, false, `should reject kbIds ${JSON.stringify(bad)}`);
    assert.ok(result.errors.kbIds);
  }
  const ok = validateAssistantInput({ ...VALID_INPUT, kbIds: null });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.kbIds, null);
});

test("rejects systemPrompt > 65535 chars", () => {
  const result = validateAssistantInput({ ...VALID_INPUT, systemPrompt: "a".repeat(65536) });
  assert.equal(result.ok, false);
  assert.ok(result.errors.systemPrompt);
});

test("rejects temperature outside 0-2 and non-numeric", () => {
  for (const bad of [-0.1, 2.1, "abc", NaN, Infinity]) {
    const result = validateAssistantInput({ ...VALID_INPUT, temperature: bad });
    assert.equal(result.ok, false, `should reject temperature ${String(bad)}`);
    assert.ok(result.errors.temperature);
  }
});

test("rejects maxTokens outside 1-1000000 and non-integer", () => {
  for (const bad of [0, -5, 1000001, 1.5, "abc"]) {
    const result = validateAssistantInput({ ...VALID_INPUT, maxTokens: bad });
    assert.equal(result.ok, false, `should reject maxTokens ${JSON.stringify(bad)}`);
    assert.ok(result.errors.maxTokens);
  }
});

test("applies defaults (temperature 0.7, maxTokens 4096, streaming/calling true, active true, public false)", () => {
  const result = validateAssistantInput(VALID_INPUT);
  assert.equal(result.ok, true);
  assert.equal(result.value.temperature, 0.7);
  assert.equal(result.value.maxTokens, 4096);
  assert.equal(result.value.enableFunctionCalling, true);
  assert.equal(result.value.enableStreaming, true);
  assert.equal(result.value.isActive, true);
  assert.equal(result.value.isPublic, false);
  assert.equal(result.value.enableGraphContext, false);
  assert.equal(result.value.modelId, 9);
  assert.equal(result.value.kbIds, null);
  assert.equal(result.value.primaryKbId, null);
  assert.equal(result.value.graphResourceId, null);
  assert.equal(result.value.tools, null);
});

test("accepts a fully valid input and returns the normalized value", () => {
  const result = validateAssistantInput({
    assistantKey: "sales-bot",
    assistantName: "  Sales Bot  ",
    description: "  Bound to CF  ",
    credentialId: "3",
    modelId: "9",
    systemPrompt: "  You are helpful  ",
    temperature: 1.2,
    maxTokens: 2048,
    enableFunctionCalling: false,
    enableStreaming: false,
    tools: [{ type: "web_search" }],
    primaryKbId: "4",
    kbIds: ["4", "5"],
    enableGraphContext: true,
    graphResourceId: 6,
    isActive: false,
    isPublic: true,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    assistantKey: "sales-bot",
    assistantName: "Sales Bot",
    description: "Bound to CF",
    credentialId: 3,
    modelId: 9,
    systemPrompt: "You are helpful",
    temperature: 1.2,
    maxTokens: 2048,
    enableFunctionCalling: false,
    enableStreaming: false,
    tools: [{ type: "web_search" }],
    primaryKbId: 4,
    kbIds: [4, 5],
    enableGraphContext: true,
    graphResourceId: 6,
    isActive: false,
    isPublic: true,
  });
});

test("rejects a key with surrounding whitespace (regex runs on the raw input)", () => {
  const result = validateAssistantInput({ ...VALID_INPUT, assistantKey: "  sales-bot  " });
  assert.equal(result.ok, false);
  assert.ok(result.errors.assistantKey);
});

// ------------------------------------------------------------------
// WRITERS (stubbed repositories)
// ------------------------------------------------------------------

test("saveAssistant throws 400 on invalid input before touching the DB", async () => {
  await assert.rejects(
    saveAssistant(COMPANY, { assistantKey: "x" }, {}),
    (err) => err instanceof HttpError && err.status === 400 && /Validation failed/.test(err.message)
  );
});

test("saveAssistant throws 409 when the assistant key already exists", async () => {
  const restore = stub(AssistantRepository, "findByKey", async () => ({ id: 99 }));
  try {
    await assert.rejects(
      saveAssistant(COMPANY, VALID_INPUT, {}),
      (err) => err instanceof HttpError && err.status === 409 && /already exists/.test(err.message)
    );
  } finally {
    restore();
  }
});

test("saveAssistant throws 409 when the company assistant limit is reached", async () => {
  const restores = [
    stub(AssistantRepository, "findByKey", async () => null),
    stub(AssistantRepository, "listByCompany", async () => new Array(5)),
  ];
  try {
    await assert.rejects(
      saveAssistant(COMPANY, VALID_INPUT, {}),
      (err) => err instanceof HttpError && err.status === 409 && /limit reached/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveAssistant throws 400 when the credential belongs to another company", async () => {
  const restores = [
    stub(AssistantRepository, "findByKey", async () => null),
    stub(AssistantRepository, "listByCompany", async () => []),
    stub(CredentialRepository, "findById", async () => ({ id: 3, company_id: 99, provider_id: 7 })),
  ];
  try {
    await assert.rejects(
      saveAssistant(COMPANY, VALID_INPUT, {}),
      (err) => err instanceof HttpError && err.status === 400 && /does not belong/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveAssistant throws 400 when the model belongs to a different provider than the credential", async () => {
  const restores = [
    stub(AssistantRepository, "findByKey", async () => null),
    stub(AssistantRepository, "listByCompany", async () => []),
    stub(CredentialRepository, "findById", async () => ({ id: 3, company_id: 2, provider_id: 7 })),
    stub(ModelRepository, "findById", async () => ({ id: 9, provider_id: 999, model_key: "other" })),
  ];
  try {
    await assert.rejects(
      saveAssistant(COMPANY, VALID_INPUT, {}),
      (err) =>
        err instanceof HttpError &&
        err.status === 400 &&
        /does not belong to the credential's provider/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveAssistant throws 400 for a kbId that is not owned by the company", async () => {
  const restores = [
    stub(AssistantRepository, "findByKey", async () => null),
    stub(AssistantRepository, "listByCompany", async () => []),
    stub(CredentialRepository, "findById", async () => ({ id: 3, company_id: 2, provider_id: 7 })),
    stub(ModelRepository, "findById", async () => ({ id: 9, provider_id: 7, model_key: "gpt-4o" })),
    stub(KbRepository, "findById", async () => ({ id: 4, company_id: 99 })),
  ];
  try {
    await assert.rejects(
      saveAssistant(COMPANY, { ...VALID_INPUT, kbIds: [4] }, {}),
      (err) => err instanceof HttpError && err.status === 400 && /does not belong/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveAssistant throws 400 for a graphResourceId not owned by the company", async () => {
  const restores = [
    stub(AssistantRepository, "findByKey", async () => null),
    stub(AssistantRepository, "listByCompany", async () => []),
    stub(CredentialRepository, "findById", async () => ({ id: 3, company_id: 2, provider_id: 7 })),
    stub(ModelRepository, "findById", async () => ({ id: 9, provider_id: 7, model_key: "gpt-4o" })),
    stub(ResourceRepository, "findById", async () => ({ id: 6, company_id: 99 })),
  ];
  try {
    await assert.rejects(
      saveAssistant(COMPANY, { ...VALID_INPUT, graphResourceId: 6 }, {}),
      (err) => err instanceof HttpError && err.status === 400 && /does not belong/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveAssistant persists with the resolved model_key and audits assistant.created", async () => {
  let createdArgs = null;
  let auditEntry = null;
  const restoreOwnership = stubHappyOwnership();
  const restores = [
    restoreOwnership,
    stub(AssistantRepository, "findByKey", async () => null),
    stub(AssistantRepository, "listByCompany", async () => []),
    stub(AssistantRepository, "create", async (_companyId, input) => {
      createdArgs = input;
      return 42;
    }),
    stub(AuditRepository, "log", async (entry) => {
      auditEntry = entry;
    }),
  ];
  try {
    const result = await saveAssistant(COMPANY, VALID_INPUT, { actorType: "admin", actorId: "u1" });
    assert.deepEqual(result, { assistantId: 42, assistantKey: "sales-bot" });
    assert.equal(createdArgs.modelKey, "gpt-4o"); // denormalized snapshot
    assert.equal(createdArgs.credentialId, 3);
    assert.equal(auditEntry.action, "assistant.created");
    assert.equal(auditEntry.companyId, 2);
    assert.equal(auditEntry.entityType, "assistant");
    assert.equal(auditEntry.entityId, 42);
    assert.deepEqual(auditEntry.afterState, { assistant_key: "sales-bot" });
  } finally {
    restores.forEach((r) => r());
  }
});

test("updateAssistant throws 404 when the assistant does not exist", async () => {
  const restore = stub(AssistantRepository, "findByKey", async () => null);
  try {
    await assert.rejects(
      updateAssistant(COMPANY, "ghost", { assistantName: "X" }, {}),
      (err) => err instanceof HttpError && err.status === 404
    );
  } finally {
    restore();
  }
});

test("updateAssistant merges partial input, keeps the key immutable, and audits assistant.updated", async () => {
  const existing = {
    id: 42,
    assistant_key: "sales-bot",
    assistant_name: "Old Name",
    description: null,
    credential_id: 3,
    model_id: 9,
    system_prompt: null,
    temperature: 0.7,
    max_tokens: 4096,
    enable_function_calling: 1,
    enable_streaming: 1,
    tools: null,
    primary_kb_id: null,
    kb_ids: null,
    enable_graph_context: 0,
    graph_resource_id: null,
    is_active: 1,
    is_public: 0,
  };
  let updatedArgs = null;
  let auditEntry = null;
  const restores = [
    stubHappyOwnership(),
    stub(AssistantRepository, "findByKey", async () => existing),
    stub(AssistantRepository, "update", async (id, input) => {
      updatedArgs = { id, input };
      return true;
    }),
    stub(AuditRepository, "log", async (entry) => {
      auditEntry = entry;
    }),
  ];
  try {
    const result = await updateAssistant(COMPANY, "sales-bot", { assistantName: "Renamed Bot" }, {});
    assert.deepEqual(result, { assistantId: 42, assistantKey: "sales-bot" });
    assert.equal(updatedArgs.input.assistantName, "Renamed Bot");
    assert.equal(updatedArgs.input.assistantKey, "sales-bot"); // key survives the merge
    assert.equal(updatedArgs.input.modelKey, "gpt-4o");
    assert.equal(auditEntry.action, "assistant.updated");
  } finally {
    restores.forEach((r) => r());
  }
});

test("removeAssistant throws 404 for a missing assistant", async () => {
  const restore = stub(AssistantRepository, "findByKey", async () => null);
  try {
    await assert.rejects(
      removeAssistant(COMPANY, "ghost", {}),
      (err) => err instanceof HttpError && err.status === 404
    );
  } finally {
    restore();
  }
});

test("removeAssistant soft-deletes and audits assistant.deleted", async () => {
  let removedId = null;
  let auditEntry = null;
  const restores = [
    stub(AssistantRepository, "findByKey", async () => ({ id: 42, assistant_key: "sales-bot" })),
    stub(AssistantRepository, "remove", async (id) => {
      removedId = id;
      return true;
    }),
    stub(AuditRepository, "log", async (entry) => {
      auditEntry = entry;
    }),
  ];
  try {
    await removeAssistant(COMPANY, "sales-bot", {});
    assert.equal(removedId, 42);
    assert.equal(auditEntry.action, "assistant.deleted");
    assert.deepEqual(auditEntry.afterState, { assistant_key: "sales-bot" });
  } finally {
    restores.forEach((r) => r());
  }
});
