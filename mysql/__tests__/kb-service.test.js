// --------------------------
// KB SERVICE TESTS — pure validation + stubbed writers, no MySQL.
// Mirrors assistant-service.test.js: validation is DB-free; the writer tests
// stub repository methods directly (try/finally) since the service imports the
// mutable repository objects.
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateKbInput,
  KB_KEY_RE,
  HttpError,
  saveKb,
  updateKb,
  removeKb,
} from "../services/kb-service.js";
import { resolveGatewayCompany } from "../services/company-scope.js";
import {
  CompanyRepository,
  KbRepository,
  ResourceRepository,
  ModelRepository,
  AuditRepository,
} from "../repositories.js";

const VALID_KB = {
  kbKey: "my-kb-1",
  kbName: "My KB",
};

test("validateKbInput rejects missing kbKey / kbName", () => {
  const result = validateKbInput({});
  assert.equal(result.ok, false);
  assert.ok(result.errors.kbKey);
  assert.ok(result.errors.kbName);
});

test("rejects kbKey with uppercase/spaces/underscore (KB_KEY_RE)", () => {
  for (const bad of ["MyKb", "my kb", "my_kb", "my.kb"]) {
    const result = validateKbInput({ ...VALID_KB, kbKey: bad });
    assert.equal(result.ok, false, `should reject '${bad}'`);
    assert.ok(result.errors.kbKey);
  }
});

test("rejects kbKey < 3 or > 63 chars", () => {
  for (const bad of ["ab", "a".repeat(64)]) {
    const result = validateKbInput({ ...VALID_KB, kbKey: bad });
    assert.equal(result.ok, false, `should reject length ${bad.length}`);
    assert.ok(result.errors.kbKey);
  }
});

test("rejects bad chunkSize (non-int, <1, >10000); accepts default 512", () => {
  for (const bad of [1.5, "abc", 0, -5, 10001]) {
    const result = validateKbInput({ ...VALID_KB, chunkSize: bad });
    assert.equal(result.ok, false, `should reject chunkSize ${JSON.stringify(bad)}`);
    assert.ok(result.errors.chunkSize);
  }
  const good = validateKbInput(VALID_KB);
  assert.equal(good.ok, true);
  assert.equal(good.value.chunkSize, 512);
});

test("rejects chunkOverlap >= chunkSize", () => {
  for (const bad of [512, 600]) {
    const result = validateKbInput({ ...VALID_KB, chunkSize: 512, chunkOverlap: bad });
    assert.equal(result.ok, false, `should reject overlap ${bad}`);
    assert.ok(result.errors.chunkOverlap);
  }
  const good = validateKbInput({ ...VALID_KB, chunkSize: 512, chunkOverlap: 50 });
  assert.equal(good.ok, true);
});

test("rejects retrievalTopK outside 1-100", () => {
  for (const bad of [0, -3, 101, 2.5, "abc"]) {
    const result = validateKbInput({ ...VALID_KB, retrievalTopK: bad });
    assert.equal(result.ok, false, `should reject topK ${JSON.stringify(bad)}`);
    assert.ok(result.errors.retrievalTopK);
  }
});

test("rejects retrievalScoreThreshold outside 0-1 and non-numeric", () => {
  for (const bad of [-0.1, 1.1, "abc", NaN, Infinity]) {
    const result = validateKbInput({ ...VALID_KB, retrievalScoreThreshold: bad });
    assert.equal(result.ok, false, `should reject threshold ${String(bad)}`);
    assert.ok(result.errors.retrievalScoreThreshold);
  }
});

test("rejects non-integer resource/model ids", () => {
  for (const field of ["vectorResourceId", "storageResourceId", "graphResourceId", "embeddingModelId"]) {
    for (const bad of [1.5, -1, 0, "abc"]) {
      const result = validateKbInput({ ...VALID_KB, [field]: bad });
      assert.equal(result.ok, false, `should reject ${field}=${JSON.stringify(bad)}`);
      assert.ok(result.errors[field]);
    }
  }
});

test("applies defaults (chunkSize 512, overlap 50, topK 10, threshold 0.7, hybrid true, graph false, isActive true)", () => {
  const result = validateKbInput(VALID_KB);
  assert.equal(result.ok, true);
  assert.equal(result.value.chunkSize, 512);
  assert.equal(result.value.chunkOverlap, 50);
  assert.equal(result.value.retrievalTopK, 10);
  assert.equal(result.value.retrievalScoreThreshold, 0.7);
  assert.equal(result.value.enableHybridSearch, true);
  assert.equal(result.value.enableGraphRag, false);
  assert.equal(result.value.isActive, true);
  assert.equal(result.value.graphResourceId, null); // graph deferred in M2 (D11)
});

test("accepts a fully valid input and returns the normalized value", () => {
  const result = validateKbInput({
    ...VALID_KB,
    description: "  Compliance docs  ",
    vectorResourceId: "3",
    storageResourceId: "7",
    embeddingModelId: 4,
    chunkSize: 256,
    chunkOverlap: 25,
    retrievalTopK: 5,
    retrievalScoreThreshold: 0.65,
    enableHybridSearch: false,
    enableGraphRag: true,
    isActive: false,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    kbKey: "my-kb-1",
    kbName: "My KB",
    description: "Compliance docs",
    vectorResourceId: 3,
    graphResourceId: null,
    storageResourceId: 7,
    embeddingModelId: 4,
    chunkSize: 256,
    chunkOverlap: 25,
    retrievalTopK: 5,
    retrievalScoreThreshold: 0.65,
    enableGraphRag: true,
    enableHybridSearch: false,
    sourceType: "wordpress",
    sourceConfig: null,
    webhookUrl: null,
    webhookSecret: null,
    webhookEvents: null,
    isActive: false,
  });
});

test("KB_KEY_RE rejects empty and non-key characters; validator rejects null", () => {
  assert.equal(KB_KEY_RE.test(""), false);
  assert.equal(KB_KEY_RE.test("my_kb"), false);
  assert.equal(KB_KEY_RE.test("my-kb-1"), true);
  assert.equal(KB_KEY_RE.test("popularcert-kb"), true);

  // null/undefined are caught by the required check before the regex runs.
  const noKey = validateKbInput({ kbName: "X", kbKey: null });
  assert.equal(noKey.ok, false);
  assert.ok(noKey.errors.kbKey);
});

test("resolveGatewayCompany resolves known/unknown keys via injected repo fake", async () => {
  const real = CompanyRepository.findByKey;
  try {
    CompanyRepository.findByKey = async (key) =>
      key === "popularcert" ? { id: 2, company_key: "popularcert", max_knowledge_bases: 5 } : null;

    const unknown = await resolveGatewayCompany("ghost-co");
    assert.equal(unknown.error, "Company 'ghost-co' not found.");
    assert.equal(unknown.status, 404);

    const known = await resolveGatewayCompany("popularcert");
    assert.equal(known.company.id, 2);

    const missing = await resolveGatewayCompany("   ");
    assert.equal(missing.status, 400);
  } finally {
    CompanyRepository.findByKey = real;
  }
});

// ------------------------------------------------------------------
// WRITERS (stubbed repositories)
// ------------------------------------------------------------------

const COMPANY = { id: 2, company_key: "popularcert", max_knowledge_bases: 5 };

const WRITER_INPUT = {
  kbKey: "docs-kb",
  kbName: "Docs KB",
  vectorResourceId: 3,
  storageResourceId: 7,
  embeddingModelId: 4,
};

/** Stub a repository method, returning a restore function. */
function stub(obj, method, impl) {
  const original = obj[method];
  obj[method] = impl;
  return () => {
    obj[method] = original;
  };
}

/** Happy-path ownership stubs: resources 3/7 owned by company 2, model resolves. */
function stubHappyKb() {
  const restores = [
    stub(ResourceRepository, "findById", async (id) =>
      [3, 7].includes(Number(id)) ? { id: Number(id), company_id: 2 } : null
    ),
    stub(ModelRepository, "findById", async () => ({ id: 4, provider_key: "openai" })),
  ];
  return () => restores.forEach((r) => r());
}

test("saveKb throws 400 on invalid input before touching the DB", async () => {
  await assert.rejects(
    saveKb(COMPANY, { kbKey: "x" }, {}),
    (err) => err instanceof HttpError && err.status === 400 && /Validation failed/.test(err.message)
  );
});

test("saveKb throws 409 when the KB key already exists", async () => {
  const restore = stub(KbRepository, "findByKey", async () => ({ id: 99 }));
  try {
    await assert.rejects(
      saveKb(COMPANY, WRITER_INPUT, {}),
      (err) => err instanceof HttpError && err.status === 409 && /already exists/.test(err.message)
    );
  } finally {
    restore();
  }
});

test("saveKb throws 409 when the company KB limit is reached", async () => {
  const restores = [
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => new Array(5)),
  ];
  try {
    await assert.rejects(
      saveKb(COMPANY, WRITER_INPUT, {}),
      (err) => err instanceof HttpError && err.status === 409 && /limit reached/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb throws 400 for an unknown vectorResourceId", async () => {
  const restores = [
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    stub(ResourceRepository, "findById", async () => null),
  ];
  try {
    await assert.rejects(
      saveKb(COMPANY, WRITER_INPUT, {}),
      (err) =>
        err instanceof HttpError &&
        err.status === 400 &&
        /Unknown vectorResourceId '3'/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb throws 400 for a vectorResourceId owned by another company", async () => {
  const restores = [
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    stub(ResourceRepository, "findById", async () => ({ id: 3, company_id: 99 })),
  ];
  try {
    await assert.rejects(
      saveKb(COMPANY, WRITER_INPUT, {}),
      (err) => err instanceof HttpError && err.status === 400 && /does not belong/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb throws 400 for an unknown storageResourceId", async () => {
  const restores = [
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    stub(ResourceRepository, "findById", async (id) =>
      Number(id) === 3 ? { id: 3, company_id: 2 } : null
    ),
  ];
  try {
    await assert.rejects(
      saveKb(COMPANY, WRITER_INPUT, {}),
      (err) =>
        err instanceof HttpError &&
        err.status === 400 &&
        /Unknown storageResourceId '7'/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb throws 400 for a storageResourceId owned by another company", async () => {
  const restores = [
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    stub(ResourceRepository, "findById", async (id) =>
      Number(id) === 3 ? { id: 3, company_id: 2 } : { id: 7, company_id: 99 }
    ),
  ];
  try {
    await assert.rejects(
      saveKb(COMPANY, WRITER_INPUT, {}),
      (err) => err instanceof HttpError && err.status === 400 && /does not belong/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb throws 404 for an unknown embeddingModelId", async () => {
  const restores = [
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    stub(ResourceRepository, "findById", async (id) =>
      [3, 7].includes(Number(id)) ? { id: Number(id), company_id: 2 } : null
    ),
    stub(ModelRepository, "findById", async () => null),
  ];
  try {
    await assert.rejects(
      saveKb(COMPANY, WRITER_INPUT, {}),
      (err) =>
        err instanceof HttpError &&
        err.status === 404 &&
        /Unknown embeddingModelId '4'/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb persists with the embedding provider snapshot and audits kb.created", async () => {
  let createdArgs = null;
  let auditEntry = null;
  const restoreOwnership = stubHappyKb();
  const restores = [
    restoreOwnership,
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    stub(KbRepository, "create", async (_companyId, input) => {
      createdArgs = input;
      return 42;
    }),
    stub(AuditRepository, "log", async (entry) => {
      auditEntry = entry;
    }),
  ];
  try {
    const result = await saveKb(COMPANY, WRITER_INPUT, { actorType: "admin", actorId: "u1" });
    assert.deepEqual(result, { kbId: 42, kbKey: "docs-kb" });
    assert.equal(createdArgs.kbKey, "docs-kb");
    assert.equal(createdArgs.vectorResourceId, 3);
    assert.equal(createdArgs.storageResourceId, 7);
    assert.equal(createdArgs.embeddingModelId, 4);
    assert.equal(createdArgs.embeddingModelProvider, "openai"); // denormalized snapshot
    assert.equal(createdArgs.graphResourceId, null); // graph deferred (D11)
    assert.equal(auditEntry.action, "kb.created");
    assert.equal(auditEntry.companyId, 2);
    assert.equal(auditEntry.entityType, "kb");
    assert.equal(auditEntry.entityId, 42);
    assert.deepEqual(auditEntry.afterState, { kb_key: "docs-kb" });
  } finally {
    restores.forEach((r) => r());
  }
});

const EXISTING_KB = {
  id: 42,
  kb_key: "docs-kb",
  kb_name: "Old Name",
  description: null,
  vector_resource_id: 3,
  graph_resource_id: null,
  storage_resource_id: 7,
  embedding_model_id: 4,
  chunk_size: 512,
  chunk_overlap: 50,
  retrieval_top_k: 10,
  retrieval_score_threshold: 0.7,
  enable_graph_rag: 0,
  enable_hybrid_search: 1,
  is_active: 1,
  status: "active",
};

test("updateKb throws 404 when the KB does not exist", async () => {
  const restore = stub(KbRepository, "findByKey", async () => null);
  try {
    await assert.rejects(
      updateKb(COMPANY, "ghost", { kbName: "X" }, {}),
      (err) => err instanceof HttpError && err.status === 404
    );
  } finally {
    restore();
  }
});

test("updateKb rejects invalid merged input with 400", async () => {
  const restore = stub(KbRepository, "findByKey", async () => EXISTING_KB);
  try {
    await assert.rejects(
      updateKb(COMPANY, "docs-kb", { chunkSize: 0 }, {}),
      (err) => err instanceof HttpError && err.status === 400 && /Validation failed/.test(err.message)
    );
  } finally {
    restore();
  }
});

test("updateKb merges partial input, keeps the key immutable, and audits kb.updated", async () => {
  let updatedArgs = null;
  let auditEntry = null;
  const restores = [
    stubHappyKb(),
    stub(KbRepository, "findByKey", async () => EXISTING_KB),
    stub(KbRepository, "update", async (id, input) => {
      updatedArgs = { id, input };
      return true;
    }),
    stub(AuditRepository, "log", async (entry) => {
      auditEntry = entry;
    }),
  ];
  try {
    const result = await updateKb(COMPANY, "docs-kb", { kbName: "Renamed KB", chunkSize: 256 }, {});
    assert.deepEqual(result, { kbId: 42, kbKey: "docs-kb" });
    assert.equal(updatedArgs.input.kbName, "Renamed KB");
    assert.equal(updatedArgs.input.kbKey, "docs-kb"); // key survives the merge
    assert.equal(updatedArgs.input.chunkSize, 256);
    assert.equal(updatedArgs.input.embeddingModelProvider, "openai");
    assert.equal(auditEntry.action, "kb.updated");
    assert.equal(auditEntry.entityId, 42);
    assert.deepEqual(auditEntry.beforeState, { kb_key: "docs-kb", status: "active" });
    assert.equal(auditEntry.afterState.kb_key, "docs-kb");
  } finally {
    restores.forEach((r) => r());
  }
});

test("removeKb throws 404 for a missing KB", async () => {
  const restore = stub(KbRepository, "findByKey", async () => null);
  try {
    await assert.rejects(
      removeKb(COMPANY, "ghost", {}),
      (err) => err instanceof HttpError && err.status === 404
    );
  } finally {
    restore();
  }
});

test("removeKb hard-deletes and audits kb.deleted", async () => {
  let removedId = null;
  let auditEntry = null;
  const restores = [
    stub(KbRepository, "findByKey", async () => ({ id: 42, kb_key: "docs-kb" })),
    stub(KbRepository, "remove", async (id) => {
      removedId = id;
      return true;
    }),
    stub(AuditRepository, "log", async (entry) => {
      auditEntry = entry;
    }),
  ];
  try {
    await removeKb(COMPANY, "docs-kb", {});
    assert.equal(removedId, 42);
    assert.equal(auditEntry.action, "kb.deleted");
    assert.deepEqual(auditEntry.afterState, { kb_key: "docs-kb" });
  } finally {
    restores.forEach((r) => r());
  }
});
