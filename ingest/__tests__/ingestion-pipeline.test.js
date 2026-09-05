// --------------------------
// QUICKINGEST TEST - INGESTION PIPELINE v5
// Adapter factories + pipeline transforms + registry fingerprints
// ---------------------------

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ==========================
// 1. ADAPTER FACTORIES
// ==========================

describe("adapter factories", () => {
  it("storage adapter factory creates Cloudflare R2 adapter", async () => {
    const { createStoreAdapter } = await import("../../mysql/adapters/storage/factory.js");
    const adapter = createStoreAdapter("cloudflare", {
      accountId: "cf-123",
      apiToken: "tok",
      bucketName: "my-bucket",
      companyName: "acme",
    });
    assert.ok(adapter);
    assert.equal(adapter.constructor.name, "CloudflareR2Adapter");
    assert.equal(adapter.bucketName, "my-bucket");
    assert.equal(adapter.companyName, "acme");
  });

  it("storage adapter factory creates S3 adapter", async () => {
    const { createStoreAdapter } = await import("../../mysql/adapters/storage/factory.js");
    const adapter = createStoreAdapter("aws", {
      bucketName: "s3-bucket",
      companyName: "co",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
      region: "us-west-2",
    });
    assert.ok(adapter);
    assert.equal(adapter.constructor.name, "S3Adapter");
    assert.equal(adapter.region, "us-west-2");
  });

  it("storage adapter factory throws for unsupported provider", async () => {
    const { createStoreAdapter } = await import("../../mysql/adapters/storage/factory.js");
    assert.throws(() => createStoreAdapter("unknown", {}), /Unsupported storage provider: unknown/);
  });

  it("embedding adapter factory creates Cloudflare AI adapter", async () => {
    const { createEmbeddingAdapter } = await import("../../mysql/adapters/embedding/factory.js");
    const adapter = createEmbeddingAdapter("cloudflare", {
      accountId: "cf-1",
      apiToken: "tok",
    }, "@cf/baai/bge-base-en-v1.5");
    assert.ok(adapter);
    assert.equal(adapter.constructor.name, "CloudflareAIEmbeddingAdapter");
    assert.equal(adapter.modelKey, "@cf/baai/bge-base-en-v1.5");
  });

  it("embedding adapter factory creates OpenAI adapter", async () => {
    const { createEmbeddingAdapter } = await import("../../mysql/adapters/embedding/factory.js");
    const adapter = createEmbeddingAdapter("openai", { apiKey: "sk-test-123" }, "text-embedding-3-small");
    assert.ok(adapter);
    assert.equal(adapter.constructor.name, "OpenAIEmbeddingAdapter");
    assert.equal(adapter.apiKey, "sk-test-123");
  });

  it("embedding adapter factory creates OpenRouter adapter", async () => {
    const { createEmbeddingAdapter } = await import("../../mysql/adapters/embedding/factory.js");
    const adapter = createEmbeddingAdapter("openrouter", { apiKey: "or-key" }, "openai/text-embedding-3-small");
    assert.ok(adapter);
    assert.equal(adapter.constructor.name, "OpenRouterEmbeddingAdapter");
  });

  it("embedding adapter factory throws for unsupported provider", async () => {
    const { createEmbeddingAdapter } = await import("../../mysql/adapters/embedding/factory.js");
    assert.throws(() => createEmbeddingAdapter("cohere", {}, "embed"), /Unsupported embedding provider: cohere/);
  });

  it("vector adapter factory creates Cloudflare Vectorize adapter", async () => {
    const { createVectorAdapter } = await import("../../mysql/adapters/vector/factory.js");
    const adapter = createVectorAdapter("cloudflare", {
      accountId: "cf-1",
      apiToken: "tok",
      vectorIndexName: "my-index",
      embeddingModel: "@cf/baai/bge-base-en-v1.5",
      companyName: "acme",
    });
    assert.ok(adapter);
    assert.equal(adapter.constructor.name, "CloudflareVectorAdapter");
    assert.equal(adapter.vectorIndexName, "my-index");
    assert.equal(adapter.embeddingModel, "@cf/baai/bge-base-en-v1.5");
  });

  it("vector adapter factory throws for unsupported provider", async () => {
    const { createVectorAdapter } = await import("../../mysql/adapters/vector/factory.js");
    assert.throws(() => createVectorAdapter("mongodb", {}), /Unsupported vector provider: mongodb/);
  });
});

// ==========================
// 2. PIPELINE TRANSFORMS
// ==========================

describe("pipeline transforms", () => {
  it("transformItem preserves source URL in metadata", async () => {
    const { transformItem } = await import("../pipeline.js");
    const wpItem = {
      title: { rendered: "Safety Manual - ISO 9001 Certification Guide" },
      slug: "safety-manual",
      link: "https://example.com/safety-manual",
      modified: "2026-01-01T00:00:00Z",
      content: { 
        rendered: "<p>Safety Manual - ISO 9001 Certification Guide</p><p>This comprehensive manual provides detailed guidance on implementing a robust safety management system that meets international standards and regulatory requirements across multiple industries.</p>" 
      },
    };

    const transformed = transformItem(wpItem, "pages", {
      r2Prefix: "kb/docs-kb",
      chunkSize: 512,
    });

    assert.ok(transformed.vectorChunks[0], "should have at least one vector chunk");
    assert.equal(transformed.vectorChunks[0].metadata.type, "pages");
    assert.equal(transformed.vectorChunks[0].metadata.slug, "safety-manual");
    assert.equal(transformed.vectorChunks[0].url, "https://example.com/safety-manual");
  });

  it("transformItem creates vector IDs using KB prefix", async () => {
    const { transformItem } = await import("../pipeline.js");
    const wpItem = {
      title: { rendered: "Technical Documentation - API Reference Guide" },
      slug: "api-reference",
      link: "https://example.com/docs/api",
      modified: "2026-01-01T00:00:00Z",
      content: { 
        rendered: "<h1>API Reference Guide</h1><p>Detailed technical documentation covering all API endpoints, parameters, and response formats. This guide is essential for developers integrating with our platform and requires thorough understanding of authentication, rate limiting, and error handling best practices.</p>"
      },
    };

    const transformed = transformItem(wpItem, "pages", {
      r2Prefix: "kb/my-kb",
      chunkSize: 512,
    });

    assert.ok(transformed.vectorChunks[0], "should have at least one vector chunk");
    const chunk = transformed.vectorChunks[0];
    assert.ok(chunk.id, "chunk should have an ID");
    assert.ok(chunk.r2_key.startsWith("kb/my-kb/pages/"), "R2 key should use KB prefix");
    assert.ok(chunk.r2_key.endsWith("/chunk-0.json"), "R2 key should end with chunk index");
  });

  it("transformItem uses site prefix when r2Prefix is 'site'", async () => {
    const { transformItem } = await import("../pipeline.js");
    const wpItem = {
      title: { rendered: "Documentation Article Title" },
      slug: "article",
      link: "https://example.com/article",
      modified: "2026-01-01T00:00:00Z",
      content: { 
        rendered: "<p>Article content for testing R2 prefix behavior. This article discusses important technical topics that many developers need to understand properly.</p>"
      },
    };

    const transformed = transformItem(wpItem, "posts", {
      r2Prefix: "site",
      chunkSize: 512,
    });

    assert.ok(transformed.vectorChunks[0], "should have at least one vector chunk");
    const chunk = transformed.vectorChunks[0];
    assert.ok(chunk.r2_key.startsWith("site/posts/"), "should use site prefix for legacy mode");
  });

  it("transformItem handles KB mode with kb/ prefix", async () => {
    const { transformItem } = await import("../pipeline.js");
    const wpItem = {
      title: { rendered: "KB Content Article" },
      slug: "kb-article",
      link: "https://example.com/kb-article",
      modified: "2026-01-01T00:00:00Z",
      content: { 
        rendered: "<p>Knowledge base article explaining internal processes and company policies. This content is organized by department and includes detailed procedures for all staff members.</p>"
      },
    };

    const transformed = transformItem(wpItem, "kb-posts", {
      r2Prefix: "kb/finance",
      chunkSize: 512,
    });

    assert.ok(transformed.vectorChunks[0], "should have at least one vector chunk");
    const chunk = transformed.vectorChunks[0];
    assert.ok(chunk.r2_key.startsWith("kb/finance/kb-posts/"), "should use kb/ prefix for KB mode");
  });
});

// ==========================
// 3. REGISTRY FINGERPRINTS
// ==========================

describe("registry fingerprints", () => {
  it("same settings - entries not stale when record exists", async () => {
    const { createRegistry } = await import("../registry.js");

    // Create registry with chunkSize: 512
    const reg1 = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
    reg1.record("post-alpha", "2026-01-01T00:00:00Z");

    // Same settings - should NOT be stale
    const reg2 = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
    assert.equal(reg2.isStale("post-alpha", "2026-01-01T00:00:00Z"), false);
  });

  it("changed settings - entries ARE stale even with same modified date", async () => {
    const { createRegistry } = await import("../registry.js");

    const reg1 = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
    reg1.record("post-alpha", "2026-01-01T00:00:00Z");

    // Chunk size changed - SHOULD be stale even with same modified date
    const reg2 = createRegistry("popularcert", "docs-kb", { chunkSize: 256 });
    assert.equal(reg2.isStale("post-alpha", "2026-01-01T00:00:00Z"), true);
  });

  it("unknown key is always stale", async () => {
    const { createRegistry } = await import("../registry.js");
    const reg = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
    assert.equal(reg.isStale("unknown-post", "2026-01-01T00:00:00Z"), true);
  });

  it("newer date on existing key IS stale", async () => {
    const { createRegistry } = await import("../registry.js");
    const reg1 = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
    reg1.record("post-beta", "2026-01-01T00:00:00Z");

    // Newer modified date = stale
    const reg2 = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
    assert.equal(reg2.isStale("post-beta", "2026-01-02T00:00:00Z"), true);
  });

  it("older date on existing key is NOT stale", async () => {
    const { createRegistry } = await import("../registry.js");
    const reg1 = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
    reg1.record("post-gamma", "2026-01-02T00:00:00Z");

    // Older modified date = not stale
    const reg2 = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
    assert.equal(reg2.isStale("post-gamma", "2026-01-01T00:00:00Z"), false);
  });

  it("countDocuments excludes __meta keys", async () => {
    const { createRegistry } = await import("../registry.js");
    // Use unique key to avoid conflicts with other tests
    const reg = createRegistry("countdocs-test", "countdocs-kb", { chunkSize: 512 });
    reg.record("post-1", "2026-01-01T00:00:00Z");
    reg.record("post-2", "2026-01-02T00:00:00Z");
    assert.equal(reg.countDocuments(), 2);
  });
});

// ==========================
// 4. KB-DRIVEN EXECUTION FLOW
// ==========================

describe("KB-driven execution flow", () => {
  it("KB pipeline imports main function successfully", async () => {
    // Smoke test: ensure ingest.js exports main and can be imported
    const { main } = await import("../../ingest.js");
    assert.ok(typeof main === "function");
  });
});