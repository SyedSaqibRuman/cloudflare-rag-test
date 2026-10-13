// --------------------------
// KB-DRIVEN QUERY RETRIEVAL TESTS (ADR-012 Phase 2) — pure-ESM, no node_modules,
// no MySQL, no network. Locks the gate logic: which providers route through the
// KB adapters, the null-guards, and the always-fall-back contract.
// --------------------------

// Scrub MySQL env BEFORE anything can import env.js/pool.js: dotenv never
// overrides already-set vars, so the lazy repositories below see "MySQL not
// configured" and getPool() throws immediately — no real sockets opened, no
// keepalive keeping the test process alive after the run.
process.env.MYSQL_HOST = "";
process.env.MYSQL_USER = "";
process.env.MYSQL_DATABASE = "";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isNonCfVectorProvider, retrieveNonCfContext } from "../kb-retrieval.js";

describe("isNonCfVectorProvider", () => {
  it("classifies the non-CF vector providers", () => {
    assert.equal(isNonCfVectorProvider("pinecone"), true);
    assert.equal(isNonCfVectorProvider("qdrant"), true);
    assert.equal(isNonCfVectorProvider("weaviate"), true);
  });

  it("classifies CF-family providers as CF-routed", () => {
    assert.equal(isNonCfVectorProvider("cloudflare"), false);
    assert.equal(isNonCfVectorProvider("cloudflare_vectorize"), false);
    assert.equal(isNonCfVectorProvider(""), false);
    assert.equal(isNonCfVectorProvider(null), false);
    assert.equal(isNonCfVectorProvider(undefined), false);
  });
});

describe("retrieveNonCfContext", () => {
  it("returns null (CF fallback) when the index name is missing or non-string", async () => {
    assert.equal(await retrieveNonCfContext("q", "co", null), null);
    assert.equal(await retrieveNonCfContext("q", "co", ""), null);
    assert.equal(await retrieveNonCfContext("q", "co", 42), null);
  });

  it("returns null (CF fallback) when the company is missing", async () => {
    assert.equal(await retrieveNonCfContext("q", "", "some-index"), null);
    assert.equal(await retrieveNonCfContext("q", null, "some-index"), null);
  });

  it("returns null — never throws — when MySQL is unavailable (no binding resolvable)", async () => {
    // With no MySQL configured the lazy repository imports fail or return no
    // company; the function must swallow everything and yield null so the CF
    // fast-path runs (retrieval must never throw, ADR-012 graceful degradation).
    const result = await retrieveNonCfContext("q", "no-such-company", "some-index");
    assert.equal(result, null);
  });
});

describe("embedQuestion", () => {
  it("uses the KB embedding adapter when present", async () => {
    const { embedQuestion } = await import("../kb-retrieval.js");
    const fake = { embed: async () => [0.1, 0.2, 0.3] };
    assert.deepEqual(await embedQuestion(fake, "q", "co"), [0.1, 0.2, 0.3]);
  });

  it("returns null (CF fallback) when the KB adapter is absent and company CF creds are unavailable", async () => {
    // With MYSQL scrubbed there is no config store → generateEmbeddings fails
    // or returns null; embedQuestion must swallow and yield null, never throw.
    const { embedQuestion } = await import("../kb-retrieval.js");
    assert.equal(await embedQuestion(null, "q", "no-such-company"), null);
  });
});

describe("vectorIndexMatchesKb", () => {
  it("prefers the bound resource's external id (wizard binding path)", async () => {
    const { vectorIndexMatchesKb } = await import("../kb-retrieval.js");
    const kb = { vector_external_id: "legacy-name" };
    const resource = { external_resource_id: "acme-wp-qdrant-e2e", provider_key: "qdrant" };
    assert.equal(vectorIndexMatchesKb(kb, resource, "acme-wp-qdrant-e2e"), "resource");
    assert.equal(vectorIndexMatchesKb(kb, resource, "legacy-name"), "kb");
    assert.equal(vectorIndexMatchesKb(kb, resource, "unrelated"), null);
    assert.equal(vectorIndexMatchesKb(kb, null, "legacy-name"), "kb");
    assert.equal(vectorIndexMatchesKb(kb, null, "acme-wp-qdrant-e2e"), null);
    assert.equal(vectorIndexMatchesKb(kb, resource, ""), null);
    assert.equal(vectorIndexMatchesKb(kb, resource, null), null);
  });

  it("matches register-existing resources by their config-stored index name (migration 027 path)", async () => {
    const { vectorIndexMatchesKb } = await import("../kb-retrieval.js");
    // Qdrant template: config.collection_name; Weaviate: class_name; Pinecone: index_name.
    const qdrant = { external_resource_id: null, config: { collection_name: "java-textbook", distance: "Cosine" } };
    const weaviate = { external_resource_id: null, config: { class_name: "MyKbVectors" } };
    const pinecone = { external_resource_id: null, config: { index_name: "acme-index" } };
    assert.equal(vectorIndexMatchesKb({}, qdrant, "java-textbook"), "config");
    assert.equal(vectorIndexMatchesKb({}, weaviate, "MyKbVectors"), "config");
    assert.equal(vectorIndexMatchesKb({}, pinecone, "acme-index"), "config");
    assert.equal(vectorIndexMatchesKb({}, qdrant, "other"), null);
    // external id still wins over config name
    const both = { external_resource_id: "ext-id", config: { collection_name: "cfg-name" } };
    assert.equal(vectorIndexMatchesKb({}, both, "ext-id"), "resource");
    assert.equal(vectorIndexMatchesKb({}, both, "cfg-name"), "config");
    // non-object config is ignored safely
    assert.equal(vectorIndexMatchesKb({}, { config: "oops" }, "oops"), null);
  });

  it("kbVectorIndexName mirrors the ingest resolver's name resolution order", async () => {
    const { kbVectorIndexName } = await import("../kb-retrieval.js");
    assert.equal(kbVectorIndexName({ vector_external_id: "direct" }, null), "direct");
    assert.equal(
      kbVectorIndexName({ vector_external_id: null }, { config: { collection_name: "java-textbook" } }),
      "java-textbook"
    );
    assert.equal(kbVectorIndexName({}, { config: { class_name: "MyKbVectors" } }), "MyKbVectors");
    assert.equal(kbVectorIndexName({}, null), null);
    assert.equal(kbVectorIndexName({}, { config: null }), null);
  });
});
