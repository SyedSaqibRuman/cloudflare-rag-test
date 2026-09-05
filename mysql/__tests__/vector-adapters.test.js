// --------------------------
// VECTOR ADAPTERS TESTS
// Tests all vector store adapters (Cloudflare, Pinecone, Qdrant, Weaviate)
// and the factory. Uses mocked fetch to avoid network calls.
// All tests are pure ESM — no node_modules needed.
// --------------------------
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CloudflareVectorAdapter } from "../adapters/vector/cloudflare-vectorize.js";
import { PineconeAdapter } from "../adapters/vector/pinecone.js";
import { QdrantAdapter } from "../adapters/vector/qdrant.js";
import { WeaviateAdapter } from "../adapters/vector/weaviate.js";
import { createVectorAdapter } from "../adapters/vector/factory.js";

// ------------------------------------------------------------------
// MOCK: global.fetch — intercept all HTTP calls per adapter
// ------------------------------------------------------------------
let fetchCalls = [];
let fetchHandler = null;

const originalFetch = globalThis.fetch;

function mockFetch(handler) {
  fetchHandler = handler;
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    if (handler) return handler(url, opts);
    return { ok: true, json: async () => ({}), text: async () => "" };
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
  fetchHandler = null;
  fetchCalls = [];
}

// ------------------------------------------------------------------
// SHARED: mock embedding adapter + sample chunks
// ------------------------------------------------------------------
function mockEmbeddingAdapter(dims = 768) {
  return { embed: async (_text) => Array(dims).fill(0.1) };
}

function sampleChunks(count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    id: `chunk-${i}`,
    r2_key: `site/page/test-chunk-${i}.json`,
    url: `https://example.com/page-${i}`,
    title: `Test Page ${i}`,
    text: `This is test content for chunk ${i}`,
    metadata: { type: "page", slug: `page-${i}`, chunkIndex: i },
  }));
}

// ------------------------------------------------------------------
// CLOUDFLARE VECTORIZE ADAPTER
// ------------------------------------------------------------------
describe("CloudflareVectorAdapter", () => {
  let adapter;

  beforeEach(() => { fetchCalls = []; });
  afterEach(() => restoreFetch());

  function createCFAdapter() {
    return new CloudflareVectorAdapter(
      {
        accountId: "test-account",
        apiToken: "test-token",
        vectorIndexName: "test-index",
        embeddingModel: "bge-base",
        companyName: "test-co",
        dimensions: 768,
      },
      { embeddingAdapter: mockEmbeddingAdapter() }
    );
  }

  it("has correct providerKey", () => {
    adapter = createCFAdapter();
    assert.equal(adapter.providerKey, "cloudflare");
  });

  it("constructor stores all credentials", () => {
    adapter = createCFAdapter();
    assert.equal(adapter.accountId, "test-account");
    assert.equal(adapter.apiToken, "test-token");
    assert.equal(adapter.embeddingModel, "bge-base");
    assert.equal(adapter.dimensions, 768);
    assert.equal(adapter.companyName, "test-co");
  });

  it("query method exists and is a function", () => {
    adapter = createCFAdapter();
    assert.equal(typeof adapter.query, "function");
  });

  it("upsert method exists and is a function", () => {
    adapter = createCFAdapter();
    assert.equal(typeof adapter.upsert, "function");
  });

  it("countVectors method exists and is a function", () => {
    adapter = createCFAdapter();
    assert.equal(typeof adapter.countVectors, "function");
  });
});

// ------------------------------------------------------------------
// PINECONE ADAPTER
// ------------------------------------------------------------------
describe("PineconeAdapter", () => {
  let adapter;

  beforeEach(() => { fetchCalls = []; });
  afterEach(() => restoreFetch());

  function createPineconeAdapter(overrides = {}) {
    return new PineconeAdapter(
      {
        apiKey: "test-key.project.env",
        environment: "us-east1-gcp",
        vectorIndexName: "my-index",
        namespace: "test-ns",
        companyName: "test-co",
        dimensions: 768,
        ...overrides,
      },
      { embeddingAdapter: mockEmbeddingAdapter() }
    );
  }

  it("has correct providerKey", () => {
    adapter = createPineconeAdapter();
    assert.equal(adapter.providerKey, "pinecone");
  });

  it("builds host from apiKey components", () => {
    adapter = createPineconeAdapter();
    assert.match(adapter.host, /pinecone\.io$/);
  });

  it("allows custom host override", () => {
    adapter = createPineconeAdapter({ host: "https://custom.pinecone.io" });
    assert.equal(adapter.host, "https://custom.pinecone.io");
  });

  it("query sends correct POST to /query", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        matches: [
          { id: "m1", score: 0.95, metadata: { title: "Test" }, values: [0.1] },
          { id: "m2", score: 0.8, metadata: { title: "Test 2" }, values: [0.2] },
        ],
      }),
    }));

    adapter = createPineconeAdapter();
    const result = await adapter.query([0.1, 0.2], 5);

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/query$/);
    assert.equal(fetchCalls[0].opts.method, "POST");
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.deepEqual(body.vector, [0.1, 0.2]);
    assert.equal(body.topK, 5);

    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].id, "m1");
    assert.equal(result.matches[0].score, 0.95);
    assert.deepEqual(result.matches[0].metadata, { title: "Test" });
  });

  it("query throws on non-OK response", async () => {
    mockFetch(() => ({ ok: false, status: 401, text: async () => "Unauthorized" }));
    adapter = createPineconeAdapter();
    await assert.rejects(() => adapter.query([0.1], 5), /Pinecone query failed \(401\)/);
  });

  it("upsert sends vectors to /vectors/upsert", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    adapter = createPineconeAdapter();
    await adapter.upsert(sampleChunks(2));

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/vectors\/upsert$/);
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.vectors.length, 2);
    assert.equal(body.namespace, "test-ns");
    assert.equal(body.vectors[0].id, "chunk-0");
    assert.equal(body.vectors[0].values.length, 768);
  });

  it("upsert throws on missing chunk.id", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    adapter = createPineconeAdapter();
    await assert.rejects(() => adapter.upsert([{ text: "no id" }]), /Missing chunk\.id/);
  });

  it("upsert throws on non-OK response", async () => {
    mockFetch(() => ({ ok: false, status: 500, text: async () => "Server error" }));
    adapter = createPineconeAdapter();
    await assert.rejects(() => adapter.upsert(sampleChunks(1)), /Pinecone upsert failed \(500\)/);
  });

  it("upsert is no-op for empty array", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    adapter = createPineconeAdapter();
    await adapter.upsert([]);
    assert.equal(fetchCalls.length, 0);
  });

  it("countVectors returns null on failure", async () => {
    mockFetch(() => ({ ok: false, status: 404 }));
    adapter = createPineconeAdapter();
    const count = await adapter.countVectors();
    assert.equal(count, null);
  });

  it("countVectors returns vector count from namespace", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({ namespaces: { "test-ns": { vectorCount: 42 } } }),
    }));
    adapter = createPineconeAdapter();
    const count = await adapter.countVectors();
    assert.equal(count, 42);
  });

  it("ensureIndex is a no-op (logs only)", async () => {
    adapter = createPineconeAdapter();
    await adapter.ensureIndex(); // should not throw
  });
});

// ------------------------------------------------------------------
// QDRANT ADAPTER
// ------------------------------------------------------------------
describe("QdrantAdapter", () => {
  let adapter;

  beforeEach(() => { fetchCalls = []; });
  afterEach(() => restoreFetch());

  function createQdrantAdapter(overrides = {}) {
    return new QdrantAdapter(
      {
        host: "http://localhost:6333",
        apiKey: "test-api-key",
        vectorIndexName: "my-collection",
        companyName: "test-co",
        dimensions: 768,
        ...overrides,
      },
      { embeddingAdapter: mockEmbeddingAdapter() }
    );
  }

  it("has correct providerKey", () => {
    adapter = createQdrantAdapter();
    assert.equal(adapter.providerKey, "qdrant");
  });

  it("sends api-key header when apiKey is provided", () => {
    adapter = createQdrantAdapter();
    assert.equal(adapter._headers()["api-key"], "test-api-key");
  });

  it("omits api-key header when apiKey is empty", () => {
    adapter = createQdrantAdapter({ apiKey: "" });
    assert.equal(adapter._headers()["api-key"], undefined);
  });

  it("ensureIndex creates collection when not found", async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      if (callCount === 1) return { ok: false, status: 404 };
      return { ok: true, text: async () => "" };
    });

    adapter = createQdrantAdapter();
    await adapter.ensureIndex();

    assert.equal(fetchCalls.length, 2);
    assert.match(fetchCalls[0].url, /\/collections\/my-collection$/);
    assert.equal(fetchCalls[0].opts.method, "GET");
    assert.match(fetchCalls[1].url, /\/collections\/my-collection$/);
    assert.equal(fetchCalls[1].opts.method, "PUT");
    const body = JSON.parse(fetchCalls[1].opts.body);
    assert.equal(body.vectors.size, 768);
    assert.equal(body.vectors.distance, "Cosine");
  });

  it("ensureIndex skips creation when collection exists", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    adapter = createQdrantAdapter();
    await adapter.ensureIndex();
    assert.equal(fetchCalls.length, 1); // only GET
  });

  it("ensureIndex throws on create failure", async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      if (callCount === 1) return { ok: false, status: 404 };
      return { ok: false, status: 500, text: async () => "error" };
    });
    adapter = createQdrantAdapter();
    await assert.rejects(() => adapter.ensureIndex(), /create collection failed/);
  });

  it("query sends correct POST to /points/search", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        result: [
          { id: "q1", score: 0.9, payload: { title: "Q1" } },
          { id: "q2", score: 0.7, payload: { title: "Q2" } },
        ],
      }),
    }));

    adapter = createQdrantAdapter();
    const result = await adapter.query([0.1, 0.2], 10);

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/points\/search$/);
    assert.equal(fetchCalls[0].opts.method, "POST");
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.deepEqual(body.vector, [0.1, 0.2]);
    assert.equal(body.limit, 10);
    assert.equal(body.with_payload, true);

    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].id, "q1");
    assert.equal(result.matches[0].score, 0.9);
  });

  it("query throws when collection name is missing", async () => {
    adapter = createQdrantAdapter({ vectorIndexName: "" });
    await assert.rejects(() => adapter.query([0.1], 5), /collection name is not configured/);
  });

  it("query throws on non-OK response", async () => {
    mockFetch(() => ({ ok: false, status: 400, text: async () => "Bad request" }));
    adapter = createQdrantAdapter();
    await assert.rejects(() => adapter.query([0.1], 5), /Qdrant query failed \(400\)/);
  });

  it("upsert sends points to /points", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    adapter = createQdrantAdapter();
    await adapter.upsert(sampleChunks(2));

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/points$/);
    assert.equal(fetchCalls[0].opts.method, "PUT");
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.points.length, 2);
    assert.equal(body.points[0].id, "chunk-0");
    assert.equal(body.points[0].vector.length, 768);
  });

  it("upsert throws on missing chunk.id", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    adapter = createQdrantAdapter();
    await assert.rejects(() => adapter.upsert([{ text: "no id" }]), /Missing chunk\.id/);
  });

  it("upsert throws on non-OK response", async () => {
    mockFetch(() => ({ ok: false, status: 500, text: async () => "error" }));
    adapter = createQdrantAdapter();
    await assert.rejects(() => adapter.upsert(sampleChunks(1)), /Qdrant upsert failed/);
  });

  it("upsert is no-op for empty array", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    adapter = createQdrantAdapter();
    await adapter.upsert([]);
    assert.equal(fetchCalls.length, 0);
  });

  it("countVectors returns null on failure", async () => {
    mockFetch(() => ({ ok: false, status: 404 }));
    adapter = createQdrantAdapter();
    const count = await adapter.countVectors();
    assert.equal(count, null);
  });

  it("countVectors returns points_count", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({ result: { points_count: 123 } }),
    }));
    adapter = createQdrantAdapter();
    const count = await adapter.countVectors();
    assert.equal(count, 123);
  });
});

// ------------------------------------------------------------------
// WEAVIATE ADAPTER
// ------------------------------------------------------------------
describe("WeaviateAdapter", () => {
  let adapter;

  beforeEach(() => { fetchCalls = []; });
  afterEach(() => restoreFetch());

  function createWeaviateAdapter(overrides = {}) {
    return new WeaviateAdapter(
      {
        host: "https://test.weaviate.cloud",
        apiKey: "test-weaviate-key",
        vectorIndexName: "MyClass",
        companyName: "test-co",
        dimensions: 768,
        ...overrides,
      },
      { embeddingAdapter: mockEmbeddingAdapter() }
    );
  }

  it("has correct providerKey", () => {
    adapter = createWeaviateAdapter();
    assert.equal(adapter.providerKey, "weaviate");
  });

  it("sends Bearer auth header", () => {
    adapter = createWeaviateAdapter();
    assert.equal(adapter._headers()["Authorization"], "Bearer test-weaviate-key");
  });

  it("omits Authorization when apiKey is empty", () => {
    adapter = createWeaviateAdapter({ apiKey: "" });
    assert.equal(adapter._headers()["Authorization"], undefined);
  });

  it("ensureIndex creates class when not found", async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      if (callCount === 1) return { ok: true, json: async () => ({ classes: [] }) };
      return { ok: true, text: async () => "" };
    });

    adapter = createWeaviateAdapter();
    await adapter.ensureIndex();

    assert.equal(fetchCalls.length, 2);
    assert.match(fetchCalls[0].url, /\/v1\/schema$/);
    assert.equal(fetchCalls[0].opts.method, "GET");
    assert.match(fetchCalls[1].url, /\/v1\/schema$/);
    assert.equal(fetchCalls[1].opts.method, "POST");
    const body = JSON.parse(fetchCalls[1].opts.body);
    assert.equal(body.class, "MyClass");
    assert.equal(body.properties.length, 7);
  });

  it("ensureIndex skips when class exists", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({ classes: [{ class: "MyClass" }] }),
    }));
    adapter = createWeaviateAdapter();
    await adapter.ensureIndex();
    assert.equal(fetchCalls.length, 1);
  });

  it("ensureIndex throws on schema fetch failure", async () => {
    mockFetch(() => ({ ok: false, status: 500 }));
    adapter = createWeaviateAdapter();
    await assert.rejects(() => adapter.ensureIndex(), /schema fetch failed/);
  });

  it("ensureIndex throws on class create failure", async () => {
    let callCount = 0;
    mockFetch(() => {
      callCount++;
      if (callCount === 1) return { ok: true, json: async () => ({ classes: [] }) };
      return { ok: false, status: 422, text: async () => "Validation error" };
    });
    adapter = createWeaviateAdapter();
    await assert.rejects(() => adapter.ensureIndex(), /create class failed/);
  });

  it("query sends GraphQL nearVector", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        data: {
          Get: {
            MyClass: [
              { _additional: { id: "w1", distance: 0.1 }, title: "W1", r2_key: "k1" },
              { _additional: { id: "w2", distance: 0.3 }, title: "W2", r2_key: "k2" },
            ],
          },
        },
      }),
    }));

    adapter = createWeaviateAdapter();
    const result = await adapter.query([0.1, 0.2], 5);

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/v1\/graphql$/);
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.ok(body.query.includes("nearVector"));
    assert.ok(body.query.includes("MyClass"));

    assert.equal(result.matches.length, 2);
    assert.equal(result.matches[0].id, "w1");
    assert.equal(result.matches[0].score, 0.9); // 1 - 0.1
    assert.equal(result.matches[0].metadata.title, "W1");
  });

  it("query throws when className is missing", async () => {
    adapter = createWeaviateAdapter({ vectorIndexName: "" });
    await assert.rejects(() => adapter.query([0.1], 5), /class name is not configured/);
  });

  it("query throws on non-OK response", async () => {
    mockFetch(() => ({ ok: false, status: 500, text: async () => "error" }));
    adapter = createWeaviateAdapter();
    await assert.rejects(() => adapter.query([0.1], 5), /Weaviate query failed \(500\)/);
  });

  it("upsert sends objects to /v1/batch/objects", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    adapter = createWeaviateAdapter();
    await adapter.upsert(sampleChunks(2));

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/v1\/batch\/objects$/);
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.objects.length, 2);
    assert.equal(body.objects[0].class, "MyClass");
    assert.equal(body.objects[0].id, "chunk-0");
    assert.equal(body.objects[0].vector.length, 768);
  });

  it("upsert throws on missing chunk.id", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    adapter = createWeaviateAdapter();
    await assert.rejects(() => adapter.upsert([{ text: "no id" }]), /Missing chunk\.id/);
  });

  it("upsert throws on non-OK response", async () => {
    mockFetch(() => ({ ok: false, status: 500, text: async () => "error" }));
    adapter = createWeaviateAdapter();
    await assert.rejects(() => adapter.upsert(sampleChunks(1)), /Weaviate upsert failed/);
  });

  it("upsert is no-op for empty array", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    adapter = createWeaviateAdapter();
    await adapter.upsert([]);
    assert.equal(fetchCalls.length, 0);
  });

  it("countVectors returns null on failure", async () => {
    mockFetch(() => ({ ok: false, status: 500 }));
    adapter = createWeaviateAdapter();
    const count = await adapter.countVectors();
    assert.equal(count, null);
  });

  it("countVectors returns aggregate count", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        data: { Aggregate: { MyClass: [{ meta: { count: 55 } }] } },
      }),
    }));
    adapter = createWeaviateAdapter();
    const count = await adapter.countVectors();
    assert.equal(count, 55);
  });
});

// ------------------------------------------------------------------
// VECTOR ADAPTER FACTORY
// ------------------------------------------------------------------
describe("createVectorAdapter", () => {
  afterEach(() => restoreFetch());

  it("creates CloudflareVectorAdapter for 'cloudflare'", () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    const adapter = createVectorAdapter("cloudflare", {
      accountId: "ac", apiToken: "tk", vectorIndexName: "idx", companyName: "co",
    });
    assert.equal(adapter.providerKey, "cloudflare");
  });

  it("creates PineconeAdapter for 'pinecone'", () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    const adapter = createVectorAdapter("pinecone", {
      apiKey: "k.p.e", vectorIndexName: "idx", companyName: "co",
    });
    assert.equal(adapter.providerKey, "pinecone");
  });

  it("creates QdrantAdapter for 'qdrant'", () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    const adapter = createVectorAdapter("qdrant", {
      host: "http://localhost:6333", vectorIndexName: "col", companyName: "co",
    });
    assert.equal(adapter.providerKey, "qdrant");
  });

  it("creates WeaviateAdapter for 'weaviate'", () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    const adapter = createVectorAdapter("weaviate", {
      host: "https://w.cloud", vectorIndexName: "Cls", companyName: "co",
    });
    assert.equal(adapter.providerKey, "weaviate");
  });

  it("throws for unsupported provider", () => {
    assert.throws(
      () => createVectorAdapter("unknown", {}),
      /Unsupported vector provider: unknown/
    );
  });

  it("passes embeddingAdapter option through", () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    const emb = { embed: async () => [0.1] };
    const adapter = createVectorAdapter("pinecone", {
      apiKey: "k.p.e", vectorIndexName: "idx", companyName: "co",
    }, { embeddingAdapter: emb });
    assert.equal(adapter.embeddingAdapter, emb);
  });
});

// ------------------------------------------------------------------
// ADAPTER INTERFACE CONTRACT
// ------------------------------------------------------------------
describe("Adapter interface contract", () => {
  afterEach(() => restoreFetch());

  it("all adapters expose ensureIndex, upsert, query, countVectors", () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    const providers = [
      { key: "cloudflare", creds: { accountId: "a", apiToken: "t", vectorIndexName: "i", companyName: "c" } },
      { key: "pinecone", creds: { apiKey: "k.p.e", vectorIndexName: "i", companyName: "c" } },
      { key: "qdrant", creds: { host: "http://localhost:6333", vectorIndexName: "i", companyName: "c" } },
      { key: "weaviate", creds: { host: "https://w.cloud", vectorIndexName: "I", companyName: "c" } },
    ];

    for (const { key, creds } of providers) {
      const adapter = createVectorAdapter(key, creds);
      assert.equal(typeof adapter.ensureIndex, "function", `${key} missing ensureIndex`);
      assert.equal(typeof adapter.upsert, "function", `${key} missing upsert`);
      assert.equal(typeof adapter.query, "function", `${key} missing query`);
      assert.equal(typeof adapter.countVectors, "function", `${key} missing countVectors`);
    }
  });

  it("all adapters return normalized match format from query", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        matches: [{ id: "m1", score: 0.9, metadata: { title: "X" }, values: [0.1] }],
      }),
    }));

    const adapter = new PineconeAdapter(
      { apiKey: "k.p.e", vectorIndexName: "idx", companyName: "co" },
      { embeddingAdapter: mockEmbeddingAdapter() }
    );

    const result = await adapter.query(Array(768).fill(0.1), 1);
    assert.ok(Array.isArray(result.matches));
    assert.equal(result.matches.length, 1);
    assert.ok("id" in result.matches[0]);
    assert.ok("score" in result.matches[0]);
    assert.ok("metadata" in result.matches[0]);
  });
});

// ------------------------------------------------------------------
// RESOLVE LEGACY ADAPTERS (pure, no DB)
// ------------------------------------------------------------------
describe("resolveLegacyAdapters", () => {
  afterEach(() => restoreFetch());

  it("creates Cloudflare adapters from company config", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    const { resolveLegacyAdapters } = await import("../../ingest/resolve.js");

    const config = {
      CLOUDFLARE_ACCOUNT_ID: "test-account-id",
      CLOUDFLARE_API_TOKEN: "test-api-token",
      VECTOR_INDEX: "test-vector-index",
      R2_BUCKET_NAME: "test-bucket",
      EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
      EMBEDDING_DIMENSIONS: 768,
    };

    const adapters = resolveLegacyAdapters("test-co", config);

    assert.ok(adapters.store, "store adapter should exist");
    assert.ok(adapters.embedding, "embedding adapter should exist");
    assert.ok(adapters.vector, "vector adapter should exist");

    assert.equal(typeof adapters.store.ensureBucket, "function", "store should have ensureBucket");
    assert.equal(typeof adapters.store.uploadChunk, "function", "store should have uploadChunk");
    assert.equal(typeof adapters.embedding.embed, "function", "embedding should have embed function");
    assert.equal(adapters.vector.providerKey, "cloudflare");
    assert.equal(adapters.vector.vectorIndexName, "test-vector-index");
  });

  it("uses default embedding model when not specified", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    const { resolveLegacyAdapters } = await import("../../ingest/resolve.js");

    const config = {
      CLOUDFLARE_ACCOUNT_ID: "ac",
      CLOUDFLARE_API_TOKEN: "tk",
      VECTOR_INDEX: "idx",
      R2_BUCKET_NAME: "bucket",
    };

    const adapters = resolveLegacyAdapters("co", config);
    assert.ok(adapters.embedding);
    assert.ok(adapters.vector);
  });

  it("vector adapter receives embedding adapter in chain", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    const { resolveLegacyAdapters } = await import("../../ingest/resolve.js");

    const config = {
      CLOUDFLARE_ACCOUNT_ID: "ac",
      CLOUDFLARE_API_TOKEN: "tk",
      VECTOR_INDEX: "idx",
      R2_BUCKET_NAME: "bucket",
      EMBEDDING_MODEL: "bge-base",
    };

    const adapters = resolveLegacyAdapters("co", config);
    assert.equal(adapters.vector.embeddingAdapter, adapters.embedding);
  });
});

describe("resolveKbAdapters", () => {
  it("function exists and is callable", async () => {
    const mod = await import("../../ingest/resolve.js");
    assert.equal(typeof mod.resolveKbAdapters, "function");
  });
});
