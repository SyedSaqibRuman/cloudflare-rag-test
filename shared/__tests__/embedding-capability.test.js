// --------------------------
// EMBEDDING CAPABILITY TESTS — pure-ESM tests for shared/embedding-capability.js.
// No I/O, no node_modules. Locks two independent gates that decide whether a
// catalog embedding model can actually serve a KB:
//   1. the provider has an embedding adapter in the factory, and
//   2. the company holds an ACTIVE credential for that provider.
// A model failing either gate cannot be called at ingest time, so the KB
// wizard must not offer it.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMBEDDING_CAPABLE_PROVIDER_KEYS,
  isEmbeddingCapableProvider,
  partitionEmbeddingModels,
} from "../embedding-capability.js";

describe("EMBEDDING_CAPABLE_PROVIDER_KEYS", () => {
  it("mirrors the embedding adapter factory's supported providers", () => {
    assert.deepEqual([...EMBEDDING_CAPABLE_PROVIDER_KEYS].sort(), [
      "anthropic",
      "cloudflare",
      "nvidia",
      "openai",
      "openrouter",
    ]);
  });

  it("excludes providers with no embedding adapter", () => {
    for (const key of ["jina", "voyage", "cohere", "venice", "cloudflare_r2", "qdrant", "pinecone"]) {
      assert.ok(
        !isEmbeddingCapableProvider(key),
        `${key} must not be embedding-capable (no adapter)`
      );
    }
  });

  it("tolerates nullish / empty input", () => {
    assert.equal(isEmbeddingCapableProvider(null), false);
    assert.equal(isEmbeddingCapableProvider(""), false);
    assert.equal(isEmbeddingCapableProvider("Cloudflare"), false, "keys are lowercase");
    assert.equal(isEmbeddingCapableProvider("cloudflare"), true);
  });
});

describe("partitionEmbeddingModels", () => {
  const models = [
    { id: 1, provider_key: "cloudflare", model_name: "bge-base" },
    { id: 2, provider_key: "nvidia", model_name: "nemotron" },
    { id: 3, provider_key: "jina", model_name: "jina-embed" },
    { id: 4, provider_key: "voyage", model_name: "voyage-3" },
  ];

  it("keeps only adapter-backed models whose provider the company has a credential for", () => {
    const { available, unavailable } = partitionEmbeddingModels(models, {
      credentialProviderKeys: ["cloudflare", "nvidia"],
    });
    assert.deepEqual(available.map((m) => m.id), [1, 2]);
    assert.deepEqual(unavailable.map((m) => m.id), [3, 4]);
  });

  it("marks an adapter-backed model unavailable when the company has no credential", () => {
    const { available, unavailable } = partitionEmbeddingModels(models, {
      credentialProviderKeys: ["cloudflare"],
    });
    assert.deepEqual(available.map((m) => m.id), [1]);
    // nvidia has an adapter but no credential here; jina/voyage have neither.
    assert.deepEqual(unavailable.map((m) => m.id), [2, 3, 4]);
  });

  it("excludes every model when the company has no credentials at all", () => {
    const { available, unavailable } = partitionEmbeddingModels(models, {
      credentialProviderKeys: [],
    });
    assert.deepEqual(available, []);
    assert.equal(unavailable.length, 4);
  });

  it("tolerates missing / malformed inputs", () => {
    assert.deepEqual(partitionEmbeddingModels(null, { credentialProviderKeys: ["cloudflare"] }), {
      available: [],
      unavailable: [],
    });
    assert.deepEqual(partitionEmbeddingModels(models, {}), { available: [], unavailable: models });
    assert.deepEqual(partitionEmbeddingModels(models), { available: [], unavailable: models });
  });

  it("accepts a Set or array of credential provider keys", () => {
    const asSet = partitionEmbeddingModels(models, { credentialProviderKeys: new Set(["cloudflare"]) });
    assert.deepEqual(asSet.available.map((m) => m.id), [1]);
  });

  it("keeps rows without a provider_key out of both lists", () => {
    const { available, unavailable } = partitionEmbeddingModels([{ id: 9, model_name: "orphan" }], {
      credentialProviderKeys: ["cloudflare"],
    });
    assert.deepEqual(available, []);
    assert.deepEqual(unavailable, []);
  });
});
