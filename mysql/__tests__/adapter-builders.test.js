import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("Adapter builders", () => {
  it("createStoreAdapter throws for unsupported provider", async () => {
    const { createStoreAdapter } = await import("../adapters/storage/factory.js");
    assert.throws(() => createStoreAdapter("unknown", {}), /Unsupported storage provider/);
  });

  it("createEmbeddingAdapter throws for unsupported provider", async () => {
    const { createEmbeddingAdapter } = await import("../adapters/embedding/factory.js");
    assert.throws(() => createEmbeddingAdapter("unknown", {}, "m"), /Unsupported embedding provider/);
  });

  it("createVectorAdapter throws for unsupported provider", async () => {
    const { createVectorAdapter } = await import("../adapters/vector/factory.js");
    assert.throws(() => createVectorAdapter("unknown", {}), /Unsupported vector provider/);
  });
});