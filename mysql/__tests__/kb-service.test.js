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
import { SitemapError } from "../../ingest/sources/sitemap/index.js";
import { resolveGatewayCompany } from "../services/company-scope.js";
import {
  KB_SOURCE_TYPES,
  KB_ENABLED_SOURCE_TYPES,
  KB_DISABLED_SOURCE_TYPES,
  KB_DEFAULT_SOURCE_TYPE,
  isSourceTypeEnabled,
} from "../../shared/catalog-enums.js";
import {
  CompanyRepository,
  KbRepository,
  ResourceRepository,
  ModelRepository,
  AuditRepository,
  CredentialRepository,
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

test("url source without a website, urls or sitemap fails at SAVE time (not at ingest)", () => {
  // Regression: the portal saved sourceType "url" with { urls: [] } and no
  // sitemapUrl; the KB only failed when an ingest ran createSourceAdapter.
  // A websiteUrl now also satisfies this — its sitemap is discovered at ingest.
  const empty = validateKbInput({ kbKey: "u-1", kbName: "U", sourceType: "url", sourceConfig: { urls: [] } });
  assert.equal(empty.ok, false);
  assert.match(empty.errors.sourceConfig, /requires a websiteUrl/);

  const missing = validateKbInput({ kbKey: "u-2", kbName: "U", sourceType: "url" });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.sourceConfig);
});

test("url source with sitemapUrl or urls passes validation", () => {
  const sitemap = validateKbInput({
    kbKey: "u-3",
    kbName: "U",
    sourceType: "url",
    sourceConfig: { urls: [], sitemapUrl: "https://example.com/wp-sitemap.xml", maxUrls: 30, scope: "limit", docLimit: 30 },
  });
  assert.equal(sitemap.ok, true);
  assert.equal(sitemap.value.sourceType, "url");

  const withUrls = validateKbInput({
    kbKey: "u-4",
    kbName: "U",
    sourceType: "url",
    sourceConfig: { urls: ["https://example.com/a", "https://example.com/b"] },
  });
  assert.equal(withUrls.ok, true);
});

test("a websiteUrl ALONE is a valid url source (sitemap is discovered at ingest)", () => {
  // The whole point of automatic discovery: the user never types a sitemap.
  const r = validateKbInput({
    kbKey: "w-1",
    kbName: "W",
    sourceType: "url",
    sourceConfig: { websiteUrl: "https://maxicert.com" },
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.sourceType, "url");
  assert.equal(r.value.sourceConfig.websiteUrl, "https://maxicert.com");
});

test("url source maxDepth must be a positive integer when present", () => {
  for (const bad of [0, -1, "abc", 1.5]) {
    const r = validateKbInput({
      kbKey: "w-2",
      kbName: "W",
      sourceType: "url",
      sourceConfig: { websiteUrl: "https://example.com", maxDepth: bad },
    });
    assert.equal(r.ok, false, `maxDepth=${bad} must be rejected`);
    assert.match(r.errors.sourceConfig, /maxDepth/);
  }
});

test("url source maxUrls must be a positive integer when present", () => {
  for (const bad of [0, -5, "abc"]) {
    const r = validateKbInput({
      kbKey: "u-5",
      kbName: "U",
      sourceType: "url",
      sourceConfig: { sitemapUrl: "https://example.com/s.xml", maxUrls: bad },
    });
    assert.equal(r.ok, false, `maxUrls=${bad} must be rejected`);
    assert.match(r.errors.sourceConfig, /maxUrls/);
  }
});

test("url source with string sourceConfig (legacy shape) skips url checks", () => {
  const legacy = validateKbInput({
    kbKey: "u-6",
    kbName: "U",
    sourceType: "url",
    sourceConfig: "{\"urls\":[]}"
  });
  assert.equal(legacy.ok, true);
});

// "wordpress" is a WITHDRAWN source type (shared/catalog-enums.js). A KB that
// already uses it may still be re-saved unchanged (currentSourceType tolerance),
// but a NEW KB can no longer select it. See the cases below.
test("withdrawn source types are rejected for a NEW kb", () => {
  for (const sourceType of KB_DISABLED_SOURCE_TYPES) {
    const r = validateKbInput({ kbKey: "d-1", kbName: "D", sourceType });
    assert.equal(r.ok, false, `${sourceType} must not be selectable`);
    assert.match(r.errors.sourceType, /no longer available/);
  }
});

test("a kb already using a withdrawn source type can still be re-saved unchanged", () => {
  // Legacy row: editing its name must not be blocked, and its source_type must
  // survive the save untouched.
  const r = validateKbInput(
    { kbKey: "d-2", kbName: "D", sourceType: "wordpress", sourceConfig: { scope: "limit", docLimit: 30 } },
    { currentSourceType: "wordpress" }
  );
  assert.equal(r.ok, true);
  assert.equal(r.value.sourceType, "wordpress");

  // …but switching a healthy KB ONTO it is still refused.
  const switched = validateKbInput(
    { kbKey: "d-3", kbName: "D", sourceType: "wordpress" },
    { currentSourceType: "url" }
  );
  assert.equal(switched.ok, false);
  assert.match(switched.errors.sourceType, /no longer available/);
});

test("omitting sourceType inherits the stored value, then falls back to an offered default", () => {
  // Update that doesn't mention sourceType must NOT migrate the row.
  const inherited = validateKbInput({ kbKey: "d-4", kbName: "D" }, { currentSourceType: "wordpress" });
  assert.equal(inherited.ok, true);
  assert.equal(inherited.value.sourceType, "wordpress");

  // Create with no sourceType → the default is always an OFFERED type.
  const fresh = validateKbInput({ kbKey: "d-5", kbName: "D" });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.value.sourceType, KB_DEFAULT_SOURCE_TYPE);
  assert.ok(isSourceTypeEnabled(fresh.value.sourceType));
});

test("offered source types still validate and the enabled list is a subset of the vocabulary", () => {
  for (const sourceType of KB_ENABLED_SOURCE_TYPES) {
    assert.ok(KB_SOURCE_TYPES.includes(sourceType));
    assert.equal(isSourceTypeEnabled(sourceType), true);
  }
  for (const sourceType of KB_DISABLED_SOURCE_TYPES) {
    assert.equal(isSourceTypeEnabled(sourceType), false);
  }
  // No overlap — a type is offered or withdrawn, never both.
  const overlap = KB_ENABLED_SOURCE_TYPES.filter((t) => KB_DISABLED_SOURCE_TYPES.includes(t));
  assert.deepEqual(overlap, []);
});

test("a nonsense sourceType is rejected with the offered list", () => {
  const r = validateKbInput({ kbKey: "d-6", kbName: "D", sourceType: "ftp" });
  assert.equal(r.ok, false);
  assert.match(r.errors.sourceType, /must be one of/);
  assert.ok(!r.errors.sourceType.includes("ftp,"), "must not echo the bad value as valid");
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
    vectorExternalId: null,
    graphResourceId: null,
    storageResourceId: 7,
    storageExternalId: null,
    embeddingModelId: 4,
    chunkSize: 256,
    chunkOverlap: 25,
    retrievalTopK: 5,
    retrievalScoreThreshold: 0.65,
    enableGraphRag: true,
    graphExtractMaxChunks: null,
    graphExtractConcurrency: null,
    enableHybridSearch: false,
    // No sourceType given → the default, which is now the first OFFERED type
    // ("file"), not the withdrawn "wordpress" this used to assert.
    sourceType: KB_DEFAULT_SOURCE_TYPE,
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


/** Happy-path ownership stubs: resources 3/7 owned by company 2, model resolves.
 * Rows carry provider_key like the real findById JOIN (vector 3 → qdrant,
 * storage 7 → cloudflare_r2) so the vector-capability guard passes. */
function stubHappyKb() {
  const restores = [
    stub(ResourceRepository, "findById", async (id) =>
      [3, 7].includes(Number(id))
        ? { id: Number(id), company_id: 2, provider_key: Number(id) === 3 ? "qdrant" : "cloudflare_r2" }
        : null
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
      Number(id) === 3 ? { id: 3, company_id: 2, provider_key: "qdrant" } : null
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
      Number(id) === 3
        ? { id: 3, company_id: 2, provider_key: "qdrant" }
        : { id: 7, company_id: 99, provider_key: "cloudflare_r2" }
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

test("saveKb rejects a vectorResourceId from a storage-only provider (capability guard)", async () => {
  const restores = [
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    stub(ResourceRepository, "findById", async () => ({
      id: 3,
      company_id: 2,
      provider_key: "cloudflare_r2", // storage-only — has no vector adapter
    })),
  ];
  try {
    await assert.rejects(
      saveKb(COMPANY, WRITER_INPUT, {}),
      (err) =>
        err instanceof HttpError &&
        err.status === 400 &&
        /vectorResourceId '3' points to provider 'cloudflare_r2', which cannot store vectors/.test(err.message)
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
      [3, 7].includes(Number(id))
        ? { id: Number(id), company_id: 2, provider_key: Number(id) === 3 ? "qdrant" : "cloudflare_r2" }
        : null
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
  let probeArgs = null;
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
  // opts.probe: the real probe does a live network embed — tests never run it.
  const probeOpts = {
    probe: (args) => {
      probeArgs = args;
      return { ok: true, providerKey: "openai", modelKey: "text-embedding-3-small", dims: 1536, ms: 12 };
    },
  };
  try {
    const result = await saveKb(COMPANY, WRITER_INPUT, { actorType: "admin", actorId: "u1" }, probeOpts);
    assert.deepEqual(result, { kbId: 42, kbKey: "docs-kb" });
    assert.equal(probeArgs.embeddingModelId, 4); // bind-time probe ran
    assert.equal(probeArgs.companyId, 2);
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

// ---- Save-time sitemap resolution (websiteUrl-only configs) ----

const WEBSITE_INPUT = {
  kbKey: "site-kb",
  kbName: "Site KB",
  vectorResourceId: 3,
  storageResourceId: 7,
  embeddingModelId: 4,
  sourceType: "url",
  sourceConfig: { websiteUrl: "https://example.com", scope: "all" },
};

function stubSaveKbPath() {
  const restoreOwnership = stubHappyKb();
  return [
    restoreOwnership,
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
  ];
}

test("saveKb resolves the sitemap from a websiteUrl at save time and stores it", async () => {
  let created = null;
  const discovered = [];
  const restores = [
    ...stubSaveKbPath(),
    stub(KbRepository, "create", async (_c, input) => {
      created = input;
      return 42;
    }),
    stub(AuditRepository, "log", async () => {}),
  ];
  const opts = {
    probe: async () => ({ ok: true }),
    discoverSitemaps: async (url, o) => {
      discovered.push({ url, maxUrls: o?.limits?.maxUrls });
      return { discoveredSitemaps: ["https://example.com/sitemap_index.xml"], stats: { sitemapCount: 1, urlCount: 20 } };
    },
  };
  try {
    await saveKb(COMPANY, WEBSITE_INPUT, {}, opts);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].url, "https://example.com");
    assert.equal(discovered[0].maxUrls, 20); // shallow crawl — enough to pin the root sitemap
    assert.equal(created.sourceConfig.sitemapUrl, "https://example.com/sitemap_index.xml");
    assert.ok(created.sourceConfig.sitemapResolvedAt); // diagnostics timestamp
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb rejects a website KB whose site exposes no sitemap (definitive)", async () => {
  const restores = [
    ...stubSaveKbPath(),
    // The save must fail at discovery — create would hit the real configured
    // MySQL if reached, so make any leak loud instead of silent.
    stub(KbRepository, "create", async () => {
      throw new Error("TEST LEAK: KbRepository.create must not run when discovery rejects");
    }),
  ];
  const opts = {
    probe: async () => ({ ok: true }),
    discoverSitemaps: async () => {
      // Real class — the service rejects on `instanceof SitemapError`.
      throw new SitemapError("We couldn't find a sitemap for example.com.", "NO_SITEMAP_FOUND", 404);
    },
  };
  try {
    await assert.rejects(
      saveKb(COMPANY, WEBSITE_INPUT, {}, opts),
      (err) => err instanceof HttpError && err.status === 502 && /couldn't find a sitemap/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb fails OPEN on unexpected discovery errors (ingest re-checks)", async () => {
  let created = null;
  const restores = [
    ...stubSaveKbPath(),
    stub(KbRepository, "create", async (_c, input) => {
      created = input;
      return 42;
    }),
    stub(AuditRepository, "log", async () => {}),
  ];
  const opts = {
    probe: async () => ({ ok: true }),
    discoverSitemaps: async () => {
      throw new Error("ECONNRESET");
    },
  };
  try {
    await saveKb(COMPANY, WEBSITE_INPUT, {}, opts);
    // Saved without a resolved sitemap — ingest re-runs discovery (fail-open).
    assert.equal(created.sourceConfig.sitemapUrl, undefined);
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb keeps an explicit sitemapUrl and skips discovery entirely", async () => {
  let created = null;
  let discoveryRan = false;
  const restores = [
    ...stubSaveKbPath(),
    stub(KbRepository, "create", async (_c, input) => {
      created = input;
      return 42;
    }),
    stub(AuditRepository, "log", async () => {}),
  ];
  const opts = {
    probe: async () => ({ ok: true }),
    discoverSitemaps: async () => {
      discoveryRan = true;
      return { discoveredSitemaps: ["https://should-not-be-used.xml"] };
    },
  };
  try {
    await saveKb(
      COMPANY,
      { ...WEBSITE_INPUT, sourceConfig: { websiteUrl: "https://example.com", sitemapUrl: "https://example.com/wp-sitemap.xml", scope: "all" } },
      {},
      opts
    );
    assert.equal(discoveryRan, false);
    assert.equal(created.sourceConfig.sitemapUrl, "https://example.com/wp-sitemap.xml");
    assert.equal(created.sourceConfig.sitemapResolvedAt, undefined);
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb rejects the binding when the embedding probe fails definitively", async () => {
  const restoreOwnership = stubHappyKb();
  const restores = [
    restoreOwnership,
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
  ];
  const probeOpts = {
    probe: async () => ({ ok: false, reason: "http-404", providerKey: "nvidia", modelKey: "nemotron-3-embed-1b", detail: "model not found" }),
  };
  try {
    let caught = null;
    try {
      await saveKb(COMPANY, WRITER_INPUT, {}, probeOpts);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof HttpError && caught.status === 400);
    assert.match(caught.message, /Embedding model probe failed \(nvidia\/nemotron-3-embed-1b: http-404\)/);
    // Structured verdict rides on the error → routes helpers expose it → the
    // portal decodes it into the probe-failure banner.
    assert.deepEqual(caught.probe, { ok: false, reason: "http-404", providerKey: "nvidia", modelKey: "nemotron-3-embed-1b", detail: "model not found" });
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb allows the binding when the embedding probe hits a transient outage", async () => {
  const warn = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(msg);
  const restores = [
    stubHappyKb(),
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    stub(KbRepository, "create", async () => 43),
    stub(AuditRepository, "log", async () => {}),
  ];
  const probeOpts = {
    probe: async () => ({ ok: true, skipped: true, reason: "provider-outage", providerKey: "nvidia", modelKey: "nemotron-3-embed-1b", detail: "(503) overloaded" }),
  };
  try {
    const result = await saveKb(COMPANY, WRITER_INPUT, {}, probeOpts);
    assert.equal(result.kbId, 43); // fail-open on 5xx
    assert.ok(warnings.some((m) => /probe inconclusive.*provider-outage/.test(m)));
  } finally {
    console.warn = warn;
    restores.forEach((r) => r());
  }
});

test("updateKb skips the embedding probe when the binding is unchanged", async () => {
  let probeCalls = 0;
  const restores = [
    stub(KbRepository, "findByKey", async () => EXISTING_KB),
    stub(ResourceRepository, "findById", async (id) => {
      const n = Number(id);
      if (n === 3) return { id: 3, company_id: 2, provider_key: "qdrant" };
      if (n === 7) return { id: 7, company_id: 2, provider_key: "cloudflare_r2" };
      return null;
    }),
    stub(ModelRepository, "findById", async () => ({ id: 4, provider_key: "openai" })),
    stub(KbRepository, "update", async () => true),
    stub(AuditRepository, "log", async () => {}),
  ];
  const probeOpts = {
    probe: async () => {
      probeCalls += 1;
      return { ok: true, dims: 1536, ms: 5 };
    },
  };
  try {
    await updateKb(COMPANY, "docs-kb", { kbName: "Renamed" }, {}, probeOpts); // merged embeddingModelId = existing (4) — unchanged
    assert.equal(probeCalls, 0);
  } finally {
    restores.forEach((r) => r());
  }
});

test("updateKb probes when the binding changes", async () => {
  let probeArgs = null;
  const restores = [
    stub(KbRepository, "findByKey", async () => EXISTING_KB),
    stub(ResourceRepository, "findById", async (id) => {
      const n = Number(id);
      if (n === 3) return { id: 3, company_id: 2, provider_key: "qdrant" };
      if (n === 7) return { id: 7, company_id: 2, provider_key: "cloudflare_r2" };
      return null;
    }),
    stub(ModelRepository, "findById", async (id) => (Number(id) === 9 ? { id: 9, provider_key: "qdrant" } : null)),
    stub(KbRepository, "update", async () => true),
    stub(AuditRepository, "log", async () => {}),
  ];
  const probeOpts = {
    probe: async (args) => {
      probeArgs = args;
      return { ok: true, providerKey: "qdrant", modelKey: "text-embed", dims: 768, ms: 9 };
    },
  };
  try {
    await updateKb(COMPANY, "docs-kb", { embeddingModelId: 9 }, {}, probeOpts);
    assert.equal(probeArgs.embeddingModelId, 9); // changed binding → probed
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

// ------------------------------------------------------------------
// LIVE RESOURCE BINDING (issue-001: vectorExternalId / storageExternalId)
// ------------------------------------------------------------------

test("validateKbInput accepts valid vectorExternalId and storageExternalId", () => {
  const result = validateKbInput({
    ...VALID_KB,
    vectorExternalId: "my-vector-index",
    storageExternalId: "my-r2-bucket",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.vectorExternalId, "my-vector-index");
  assert.equal(result.value.storageExternalId, "my-r2-bucket");
});

test("validateKbInput rejects invalid vectorExternalId (uppercase, short, special chars)", () => {
  for (const bad of ["MyIndex", "ab", "my index", "my.index"]) {
    const result = validateKbInput({ ...VALID_KB, vectorExternalId: bad });
    assert.equal(result.ok, false, `should reject '${bad}'`);
    assert.ok(result.errors.vectorExternalId);
  }
});

test("validateKbInput rejects invalid storageExternalId", () => {
  const result = validateKbInput({ ...VALID_KB, storageExternalId: "BUCKET" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.storageExternalId);
});

test("saveKb resolves vectorExternalId to an existing provider_resources row", async () => {
  let createdArgs = null;
  const restores = [
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    // findByExternalId finds the existing row
    stub(ResourceRepository, "findByExternalId", async (_companyId, name, type) => {
      if (type === "vector_index" && name === "live-idx") return { id: 10, company_id: 2 };
      return null;
    }),
    stub(ResourceRepository, "findById", async (id) =>
      Number(id) === 10 ? { id: 10, company_id: 2, provider_key: "qdrant" } : null
    ),
    stub(ModelRepository, "findById", async () => ({ id: 4, provider_key: "openai" })),
    stub(KbRepository, "create", async (_companyId, input) => {
      createdArgs = input;
      return 50;
    }),
    stub(AuditRepository, "log", async () => {}),
  ];
  try {
    const result = await saveKb(
      COMPANY,
      { kbKey: "live-kb", kbName: "Live KB", vectorExternalId: "live-idx" },
      {}
    );
    assert.equal(result.kbId, 50);
    assert.equal(createdArgs.vectorResourceId, 10); // resolved to the existing row
    assert.equal(createdArgs.vectorExternalId, "live-idx");
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb auto-provisions a provider_resources row when vectorExternalId has no match", async () => {
  let createdArgs = null;
  let resourceCreated = null;
  const restores = [
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    stub(ResourceRepository, "findByExternalId", async () => null), // no existing row
    stub(ResourceRepository, "findById", async (id) =>
      Number(id) === 88 ? { id: 88, company_id: 2, provider_key: "cloudflare" } : null
    ),
    stub(CredentialRepository, "listByCompany", async () => [
      { id: 5, provider_id: 10, provider_key: "cloudflare", is_active: true },
    ]),
    stub(ResourceRepository, "create", async (_companyId, input) => {
      resourceCreated = input;
      return 88;
    }),
    stub(ModelRepository, "findById", async () => ({ id: 4, provider_key: "openai" })),
    stub(KbRepository, "create", async (_companyId, input) => {
      createdArgs = input;
      return 51;
    }),
    stub(AuditRepository, "log", async () => {}),
  ];
  try {
    const result = await saveKb(
      COMPANY,
      { kbKey: "auto-kb", kbName: "Auto KB", vectorExternalId: "brand-new-index" },
      {}
    );
    assert.equal(result.kbId, 51);
    assert.equal(resourceCreated.resourceType, "vector_index");
    assert.equal(resourceCreated.externalResourceId, "brand-new-index");
    assert.equal(resourceCreated.resourceKey, "brand-new-index");
    assert.equal(createdArgs.vectorResourceId, 88);
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb errors when no Cloudflare connection exists for auto-provisioning", async () => {
  const restores = [
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    stub(ResourceRepository, "findByExternalId", async () => null),
    stub(CredentialRepository, "listByCompany", async () => []), // no CF credentials
  ];
  try {
    await assert.rejects(
      saveKb(
        COMPANY,
        { kbKey: "no-conn-kb", kbName: "No Conn KB", vectorExternalId: "some-index" },
        {}
      ),
      (err) =>
        err instanceof HttpError &&
        err.status === 400 &&
        /No active Cloudflare connection/.test(err.message)
    );
  } finally {
    restores.forEach((r) => r());
  }
});

test("saveKb: explicit vectorResourceId alone bypasses external resolution", async () => {
  let createdArgs = null;
  const restores = [
    stub(KbRepository, "findByKey", async () => null),
    stub(KbRepository, "listByCompany", async () => []),
    // findByExternalId should NOT be called when no external id is sent
    stub(ResourceRepository, "findByExternalId", async () => {
      throw new Error("should not be called");
    }),
    stub(ResourceRepository, "findById", async (id) =>
      Number(id) === 3 ? { id: 3, company_id: 2, provider_key: "qdrant" } : null
    ),
    stub(ModelRepository, "findById", async () => ({ id: 4, provider_key: "openai" })),
    stub(KbRepository, "create", async (_companyId, input) => {
      createdArgs = input;
      return 52;
    }),
    stub(AuditRepository, "log", async () => {}),
  ];
  try {
    const result = await saveKb(
      COMPANY,
      {
        kbKey: "explicit-kb",
        kbName: "Explicit KB",
        vectorResourceId: 3,
      },
      {}
    );
    assert.equal(result.kbId, 52);
    assert.equal(createdArgs.vectorResourceId, 3); // id passed through directly
    assert.equal(createdArgs.vectorExternalId, null); // no external id sent
  } finally {
    restores.forEach((r) => r());
  }
});

test("updateKb resolves storageExternalId to an existing row", async () => {
  let updatedArgs = null;
  const restores = [
    stub(KbRepository, "findByKey", async () => EXISTING_KB),
    stub(ResourceRepository, "findByExternalId", async (_companyId, name, type) => {
      if (type === "object_bucket" && name === "live-bucket") return { id: 20, company_id: 2 };
      return null;
    }),
    stub(ResourceRepository, "findById", async (id) => {
      const n = Number(id);
      if (n === 3) return { id: 3, company_id: 2, provider_key: "qdrant" }; // existing vector_resource_id
      if (n === 7) return { id: 7, company_id: 2, provider_key: "cloudflare_r2" }; // existing storage_resource_id
      if (n === 20) return { id: 20, company_id: 2, provider_key: "cloudflare_r2" }; // resolved from external id
      return null;
    }),
    stub(ModelRepository, "findById", async () => ({ id: 4, provider_key: "openai" })),
    stub(KbRepository, "update", async (id, input) => {
      updatedArgs = { id, input };
      return true;
    }),
    stub(AuditRepository, "log", async () => {}),
  ];
  try {
    const result = await updateKb(
      COMPANY,
      "docs-kb",
      { storageExternalId: "live-bucket" },
      {}
    );
    assert.equal(result.kbId, 42);
    assert.equal(updatedArgs.input.storageResourceId, 20); // resolved
  } finally {
    restores.forEach((r) => r());
  }
});

// ------------------------------------------------------------------
// Per-KB graph extraction tuning (migration 023)
// ------------------------------------------------------------------

test("validateKbInput accepts valid graphExtract tuning and normalizes to numbers", () => {
  const result = validateKbInput({ ...VALID_KB, graphExtractMaxChunks: "25", graphExtractConcurrency: 6 });
  assert.equal(result.ok, true);
  assert.equal(result.value.graphExtractMaxChunks, 25);
  assert.equal(result.value.graphExtractConcurrency, 6);
});

test("validateKbInput defaults graphExtract tuning to null (use global defaults)", () => {
  const result = validateKbInput({ ...VALID_KB });
  assert.equal(result.ok, true);
  assert.equal(result.value.graphExtractMaxChunks, null);
  assert.equal(result.value.graphExtractConcurrency, null);
});

test("validateKbInput rejects out-of-range graphExtract tuning", () => {
  for (const [field, bad] of [
    ["graphExtractMaxChunks", 0],
    ["graphExtractMaxChunks", 51],
    ["graphExtractMaxChunks", 1.5],
    ["graphExtractConcurrency", 0],
    ["graphExtractConcurrency", 11],
    ["graphExtractConcurrency", "abc"],
  ]) {
    const result = validateKbInput({ ...VALID_KB, [field]: bad });
    assert.equal(result.ok, false, `should reject ${field}=${JSON.stringify(bad)}`);
    assert.ok(result.errors[field]);
  }
});

test("updateKb carries forward graphExtract tuning from the existing row", async () => {
  let updatedArgs = null;
  const existing = {
    ...EXISTING_KB,
    graph_extract_max_chunks: 8,
    graph_extract_concurrency: 2,
  };
  const restores = [
    stub(KbRepository, "findByKey", async () => existing),
    stub(ResourceRepository, "findById", async (id) => {
      const n = Number(id);
      if (n === 3) return { id: 3, company_id: 2, provider_key: "qdrant" }; // existing vector_resource_id
      if (n === 7) return { id: 7, company_id: 2, provider_key: "cloudflare_r2" }; // existing storage_resource_id
      return null;
    }),
    stub(ModelRepository, "findById", async () => ({ id: 4, provider_key: "openai" })),
    stub(KbRepository, "update", async (id, input) => {
      updatedArgs = { id, input };
      return true;
    }),
    stub(AuditRepository, "log", async () => {}),
  ];
  try {
    await updateKb(COMPANY, "docs-kb", {}, {});
    assert.equal(updatedArgs.input.graphExtractMaxChunks, 8);
    assert.equal(updatedArgs.input.graphExtractConcurrency, 2);
  } finally {
    restores.forEach((r) => r());
  }
});
