import assert from "node:assert/strict";
import { describe, it } from "node:test";

// --------------------------
// KB ADAPTER RESOLVER TESTS
// Tests that resolveKbAdapters correctly resolves KB resource bindings into
// concrete adapter instances, and that resolveLegacyAdapters creates default
// Cloudflare adapters for the no-KB path.
// --------------------------

describe("resolveKbAdapters", () => {
  it("is exported and is a function", async () => {
    const mod = await import("../resolve.js");
    assert.equal(typeof mod.resolveKbAdapters, "function");
  });

  it("is exported and is a function", async () => {
    const mod = await import("../resolve.js");
    assert.equal(typeof mod.resolveLegacyAdapters, "function");
  });
});

describe("resolveLegacyAdapters", () => {
  it("returns store, embedding, and vector adapters for Cloudflare defaults", async () => {
    const { resolveLegacyAdapters } = await import("../resolve.js");
    const config = {
      CLOUDFLARE_ACCOUNT_ID: "cf-acct-123",
      CLOUDFLARE_API_TOKEN: "cf-tok-456",
      R2_BUCKET_NAME: "my-bucket",
      VECTOR_INDEX: "my-index",
      EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
      EMBEDDING_DIMENSIONS: 768,
    };

    const { store, embedding, vector } = resolveLegacyAdapters("test-co", config);

    assert.ok(store, "store adapter should be created");
    assert.ok(embedding, "embedding adapter should be created");
    assert.ok(vector, "vector adapter should be created");

    // Store should be a CloudflareR2Adapter
    assert.equal(store.constructor.name, "CloudflareR2Adapter");
    assert.equal(store.bucketName, "my-bucket");
    assert.equal(store.companyName, "test-co");

    // Embedding should be a CloudflareAIEmbeddingAdapter
    assert.equal(embedding.constructor.name, "CloudflareAIEmbeddingAdapter");

    // Vector should be a CloudflareVectorAdapter
    assert.equal(vector.constructor.name, "CloudflareVectorAdapter");
    assert.equal(vector.vectorIndexName, "my-index");
    assert.equal(vector.companyName, "test-co");
    // Embedding adapter should be injected into vector adapter
    assert.equal(vector.embeddingAdapter, embedding);
  });

  it("passes embedding adapter through to vector adapter", async () => {
    const { resolveLegacyAdapters } = await import("../resolve.js");
    const config = {
      CLOUDFLARE_ACCOUNT_ID: "cf-acct",
      CLOUDFLARE_API_TOKEN: "cf-tok",
      R2_BUCKET_NAME: "bucket",
      VECTOR_INDEX: "index",
      EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
      EMBEDDING_DIMENSIONS: 768,
    };

    const { embedding, vector } = resolveLegacyAdapters("co", config);
    assert.equal(vector.embeddingAdapter, embedding, "vector adapter should reference the embedding adapter");
  });
});

describe("adapter factory integration", () => {
  it("createVectorAdapter passes opts through to CloudflareVectorAdapter", async () => {
    const { createVectorAdapter } = await import("../../mysql/adapters/vector/factory.js");
    const fakeEmbedding = { embed: async () => [0.1, 0.2] };

    const adapter = createVectorAdapter(
      "cloudflare",
      {
        accountId: "cf-1",
        apiToken: "tok",
        vectorIndexName: "my-index",
        embeddingModel: "@cf/model",
        companyName: "co",
      },
      { embeddingAdapter: fakeEmbedding }
    );

    assert.equal(adapter.embeddingAdapter, fakeEmbedding, "embedding adapter should be injected");
    assert.equal(adapter.vectorIndexName, "my-index");
  });

  it("createVectorAdapter works without opts (backward compat)", async () => {
    const { createVectorAdapter } = await import("../../mysql/adapters/vector/factory.js");

    const adapter = createVectorAdapter("cloudflare", {
      accountId: "cf-1",
      apiToken: "tok",
      vectorIndexName: "idx",
      embeddingModel: "@cf/model",
      companyName: "co",
    });

    assert.equal(adapter.embeddingAdapter, null, "no embedding adapter when not provided");
  });
});
