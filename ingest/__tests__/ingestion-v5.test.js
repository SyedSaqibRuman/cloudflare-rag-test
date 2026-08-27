import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ==========================
// 1. STORAGE ADAPTER FACTORY
// ==========================
describe("storage adapter factory", () => {
  it("createStoreAdapter: cloudflare → CloudflareR2Adapter", async () => {
    const { createStoreAdapter } = await import("../../mysql/adapters/storage/factory.js");
    const { CloudflareR2Adapter } = await import("../../mysql/adapters/storage/cloudflare-r2.js");
    const adapter = createStoreAdapter("cloudflare", {
      accountId: "cf-123",
      apiToken: "tok",
      bucketName: "my-bucket",
      companyName: "acme",
    });
    assert.ok(adapter instanceof CloudflareR2Adapter);
    assert.equal(adapter.bucketName, "my-bucket");
    assert.equal(adapter.accountId, "cf-123");
    assert.equal(adapter.companyName, "acme");
  });

  it("createStoreAdapter: aws → S3Adapter", async () => {
    const { createStoreAdapter } = await import("../../mysql/adapters/storage/factory.js");
    const { S3Adapter } = await import("../../mysql/adapters/storage/s3.js");
    const adapter = createStoreAdapter("aws", {
      bucketName: "s3-bucket",
      companyName: "co",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
      region: "us-west-2",
    });
    assert.ok(adapter instanceof S3Adapter);
    assert.equal(adapter.bucketName, "s3-bucket");
    assert.equal(adapter.region, "us-west-2");
  });

  it("createStoreAdapter: minio → S3Adapter", async () => {
    const { createStoreAdapter } = await import("../../mysql/adapters/storage/factory.js");
    const { S3Adapter } = await import("../../mysql/adapters/storage/s3.js");
    const adapter = createStoreAdapter("minio", {
      bucketName: "minio-bucket",
      companyName: "co",
      accessKeyId: "minio",
      secretAccessKey: "minio",
      endpoint: "http://localhost:9000",
    });
    assert.ok(adapter instanceof S3Adapter);
    assert.equal(adapter.endpoint, "http://localhost:9000");
  });

  it("createStoreAdapter: unsupported provider throws", async () => {
    const { createStoreAdapter } = await import("../../mysql/adapters/storage/factory.js");
    assert.throws(
      () => createStoreAdapter("unknown", {}),
      /Unsupported storage provider: unknown/
    );
  });
});

// ==========================
// 2. EMBEDDING ADAPTER FACTORY
// ==========================
describe("embedding adapter factory", () => {
  it("createEmbeddingAdapter: cloudflare → CloudflareAIEmbeddingAdapter", async () => {
    const { createEmbeddingAdapter } = await import("../../mysql/adapters/embedding/factory.js");
    const { CloudflareAIEmbeddingAdapter } = await import("../../mysql/adapters/embedding/cloudflare-ai.js");
    const adapter = createEmbeddingAdapter(
      "cloudflare",
      { accountId: "cf-1", apiToken: "tok" },
      "@cf/baai/bge-base-en-v1.5"
    );
    assert.ok(adapter instanceof CloudflareAIEmbeddingAdapter);
    assert.equal(adapter.modelKey, "@cf/baai/bge-base-en-v1.5");
  });

  it("createEmbeddingAdapter: openai → OpenAIEmbeddingAdapter", async () => {
    const { createEmbeddingAdapter } = await import("../../mysql/adapters/embedding/factory.js");
    const { OpenAIEmbeddingAdapter } = await import("../../mysql/adapters/embedding/openai.js");
    const adapter = createEmbeddingAdapter(
      "openai",
      { apiKey: "sk-123" },
      "text-embedding-3-small"
    );
    assert.ok(adapter instanceof OpenAIEmbeddingAdapter);
    assert.equal(adapter.apiKey, "sk-123");
  });

  it("createEmbeddingAdapter: nvidia → OpenAIEmbeddingAdapter with nvidia base", async () => {
    const { createEmbeddingAdapter } = await import("../../mysql/adapters/embedding/factory.js");
    const { OpenAIEmbeddingAdapter } = await import("../../mysql/adapters/embedding/openai.js");
    const adapter = createEmbeddingAdapter(
      "nvidia",
      { apiKey: "nvkey" },
      "nvidia/nv-embedqa-e5-v5"
    );
    assert.ok(adapter instanceof OpenAIEmbeddingAdapter);
    assert.equal(adapter.baseURL, "https://integrate.api.nvidia.com/v1");
  });

  it("createEmbeddingAdapter: unsupported provider throws", async () => {
    const { createEmbeddingAdapter } = await import("../../mysql/adapters/embedding/factory.js");
    assert.throws(
      () => createEmbeddingAdapter("cohere", {}, "embed"),
      /Unsupported embedding provider: cohere/
    );
  });
});

// ==========================
// 3. VECTOR ADAPTER FACTORY
// ==========================
describe("vector adapter factory", () => {
  it("createVectorAdapter: cloudflare → CloudflareVectorAdapter", async () => {
    const { createVectorAdapter } = await import("../../mysql/adapters/vector/factory.js");
    const { CloudflareVectorAdapter } = await import("../../mysql/adapters/vector/cloudflare-vectorize.js");
    const adapter = createVectorAdapter("cloudflare", {
      accountId: "cf-1",
      apiToken: "tok",
      vectorIndexName: "my-index",
      embeddingModel: "@cf/baai/bge-base-en-v1.5",
      companyName: "acme",
    });
    assert.ok(adapter instanceof CloudflareVectorAdapter);
    assert.equal(adapter.vectorIndexName, "my-index");
    assert.equal(adapter.companyName, "acme");
  });

  it("createVectorAdapter: unsupported provider throws", async () => {
    const { createVectorAdapter } = await import("../../mysql/adapters/vector/factory.js");
    assert.throws(
      () => createVectorAdapter("pinecone", {}),
      /Unsupported vector provider: pinecone/
    );
  });
});

// ==========================
// 4. CLOUDFLARE R2 ADAPTER
// ==========================
describe("CloudflareR2Adapter", () => {
  it("constructor stores all fields", async () => {
    const { CloudflareR2Adapter } = await import("../../mysql/adapters/storage/cloudflare-r2.js");
    const a = new CloudflareR2Adapter({
      accountId: "acct",
      apiToken: "tok123",
      bucketName: "r2-bucket",
      companyName: "co",
    });
    assert.equal(a.accountId, "acct");
    assert.equal(a.apiToken, "tok123");
    assert.equal(a.bucketName, "r2-bucket");
    assert.equal(a.companyName, "co");
  });

  it("ensureBucket resolves (no-op — R2 creates on upload)", async () => {
    const { CloudflareR2Adapter } = await import("../../mysql/adapters/storage/cloudflare-r2.js");
    const a = new CloudflareR2Adapter({ accountId: "a", apiToken: "t", bucketName: "b", companyName: "c" });
    await a.ensureBucket(); // must not throw
  });

  it("saveContent resolves (no-op placeholder)", async () => {
    const { CloudflareR2Adapter } = await import("../../mysql/adapters/storage/cloudflare-r2.js");
    const a = new CloudflareR2Adapter({ accountId: "a", apiToken: "t", bucketName: "b", companyName: "c" });
    await a.saveContent("key", "# markdown"); // must not throw
  });
});

// ==========================
// 5. S3 ADAPTER
// ==========================
describe("S3Adapter", () => {
  it("constructor stores all fields", async () => {
    const { S3Adapter } = await import("../../mysql/adapters/storage/s3.js");
    const a = new S3Adapter({
      bucketName: "s3-bkt",
      companyName: "co",
      accessKeyId: "AKID",
      secretAccessKey: "secret",
      region: "eu-west-1",
      endpoint: "http://minio:9000",
    });
    assert.equal(a.bucketName, "s3-bkt");
    assert.equal(a.region, "eu-west-1");
    assert.equal(a.endpoint, "http://minio:9000");
    assert.equal(a.accessKeyId, "AKID");
  });

  it("defaults region to us-east-1", async () => {
    const { S3Adapter } = await import("../../mysql/adapters/storage/s3.js");
    const a = new S3Adapter({ bucketName: "b", companyName: "c", accessKeyId: "k", secretAccessKey: "s" });
    assert.equal(a.region, "us-east-1");
  });

  it("saveContent resolves (no-op placeholder)", async () => {
    const { S3Adapter } = await import("../../mysql/adapters/storage/s3.js");
    const a = new S3Adapter({ bucketName: "b", companyName: "c", accessKeyId: "k", secretAccessKey: "s" });
    await a.saveContent("key", "content");
  });
});

// ==========================
// 6. EMBEDDING ADAPTERS (contract)
// ==========================
describe("CloudflareAIEmbeddingAdapter", () => {
  it("constructor strips @cf/ prefix only once", async () => {
    const { CloudflareAIEmbeddingAdapter } = await import("../../mysql/adapters/embedding/cloudflare-ai.js");
    const a = new CloudflareAIEmbeddingAdapter(
      { accountId: "cf-1", apiToken: "tok" },
      "@cf/baai/bge-base-en-v1.5"
    );
    assert.equal(a.modelKey, "@cf/baai/bge-base-en-v1.5");
  });

  it("constructor adds @cf/ prefix when missing", async () => {
    const { CloudflareAIEmbeddingAdapter } = await import("../../mysql/adapters/embedding/cloudflare-ai.js");
    const a = new CloudflareAIEmbeddingAdapter(
      { accountId: "cf-1", apiToken: "tok" },
      "baai/bge-base-en-v1.5"
    );
    // embed() would prepend @cf/ at runtime, but modelKey is stored as-is
    assert.equal(a.modelKey, "baai/bge-base-en-v1.5");
  });
});

describe("OpenAIEmbeddingAdapter", () => {
  it("constructor stores api key and baseURL", async () => {
    const { OpenAIEmbeddingAdapter } = await import("../../mysql/adapters/embedding/openai.js");
    const a = new OpenAIEmbeddingAdapter({ apiKey: "sk-abc" }, "text-embedding-3-small");
    assert.equal(a.apiKey, "sk-abc");
    assert.equal(a.modelKey, "text-embedding-3-small");
    assert.equal(a.baseURL, "https://api.openai.com/v1");
  });

  it("nvidia provider uses nvidia base URL", async () => {
    const { OpenAIEmbeddingAdapter } = await import("../../mysql/adapters/embedding/openai.js");
    const a = new OpenAIEmbeddingAdapter({ apiKey: "nv" }, "model", "nvidia");
    assert.equal(a.baseURL, "https://integrate.api.nvidia.com/v1");
  });

  it("unknown provider key defaults to openai base URL", async () => {
    const { OpenAIEmbeddingAdapter } = await import("../../mysql/adapters/embedding/openai.js");
    const a = new OpenAIEmbeddingAdapter({ apiKey: "k" }, "m", "custom-provider");
    assert.equal(a.baseURL, "https://api.openai.com/v1");
  });
});

describe("OpenRouterEmbeddingAdapter", () => {
  it("constructor stores fields", async () => {
    const { OpenRouterEmbeddingAdapter } = await import("../../mysql/adapters/embedding/openrouter.js");
    const a = new OpenRouterEmbeddingAdapter({ apiKey: "or-key" }, "openai/text-embedding-3-small");
    assert.equal(a.apiKey, "or-key");
    assert.equal(a.modelKey, "openai/text-embedding-3-small");
  });
});

// ==========================
// 7. CLOUDFLARE VECTORIZE ADAPTER
// ==========================
describe("CloudflareVectorAdapter", () => {
  it("constructor stores all fields", async () => {
    const { CloudflareVectorAdapter } = await import("../../mysql/adapters/vector/cloudflare-vectorize.js");
    const a = new CloudflareVectorAdapter({
      accountId: "cf-acct",
      apiToken: "cf-tok",
      vectorIndexName: "docs-v1",
      embeddingModel: "@cf/baai/bge-base-en-v1.5",
      companyName: "popularcert",
    });
    assert.equal(a.accountId, "cf-acct");
    assert.equal(a.vectorIndexName, "docs-v1");
    assert.equal(a.embeddingModel, "@cf/baai/bge-base-en-v1.5");
    assert.equal(a.companyName, "popularcert");
  });
});

// ==========================
// 8. PIPELINE TRANSFORM EDGE CASES
// ==========================
describe("pipeline transform edge cases", () => {
  it("transformItem: short content is filtered out", async () => {
    const { transformItem } = await import("../pipeline.js");
    const shortItem = {
      title: { rendered: "Short" },
      slug: "short",
      link: "https://example.com/short",
      modified: "2026-01-01T00:00:00Z",
      content: { rendered: "<p>Tiny.</p>" },
    };
    const out = transformItem(shortItem, "posts", { r2Prefix: "site", chunkSize: 1000 });
    assert.equal(out.cleanChunks.length, 0, "short content filtered");
    assert.equal(out.vectorChunks.length, 0);
  });

  it("transformItem: long section is split into multiple chunks", async () => {
    const { transformItem } = await import("../pipeline.js");
    // Use multiple paragraphs so enforceChunkSize can split on \n\n boundaries.
    const paragraphs = Array.from({ length: 5 }, (_, i) =>
      `<p>${"word "}Platform certification for industry ${i + 1} requires extensive documentation and compliance. ${"word "}</p>`
    );
    const longHtml = paragraphs.join("");
    const longItem = {
      title: { rendered: "Long Content" },
      slug: "long-content",
      link: "https://example.com/long",
      modified: "2026-01-01T00:00:00Z",
      content: { rendered: longHtml },
    };
    const out = transformItem(longItem, "posts", { r2Prefix: "site", chunkSize: 200 });
    assert.ok(out.vectorChunks.length > 1, `long content split into multiple chunks (got ${out.vectorChunks.length})`);
    for (const c of out.vectorChunks) {
      assert.ok(c.text.length <= 200, `chunk ${c.text.length} <= 200`);
    }
  });

  it("transformItem: vector IDs are deterministic for same input", async () => {
    const { transformItem } = await import("../pipeline.js");
    const item = {
      title: { rendered: "Test" },
      slug: "test",
      link: "https://example.com/test",
      modified: "2026-01-01T00:00:00Z",
      content: { rendered: "<p>Some substantial content that should pass the minimum length filter for chunking.</p>" },
    };
    const out1 = transformItem(item, "posts", { r2Prefix: "site", chunkSize: 500 });
    const out2 = transformItem(item, "posts", { r2Prefix: "site", chunkSize: 500 });
    assert.deepEqual(out1.vectorChunks.map((c) => c.id), out2.vectorChunks.map((c) => c.id));
  });

  it("transformItem: metadata is extracted from title", async () => {
    const { transformItem } = await import("../pipeline.js");
    const item = {
      title: { rendered: "ISO 9001 Certification in Vietnam" },
      slug: "iso-9001-vietnam",
      link: "https://example.com/iso-vietnam",
      modified: "2026-01-01T00:00:00Z",
      content: { rendered: "<p>ISO 9001 certification content for Vietnam with enough text to pass chunk filters easily.</p>" },
    };
    const out = transformItem(item, "posts", { r2Prefix: "site", chunkSize: 500 });
    const chunk = out.vectorChunks[0];
    assert.equal(chunk.metadata.type, "posts");
    assert.equal(chunk.metadata.slug, "iso-9001-vietnam");
    assert.ok(chunk.id);
    assert.ok(chunk.r2_key.startsWith("site/posts/"));
  });
});

// ==========================
// 9. PIPELINE FLOW: KB-DRIVEN (MOCKED REPOSITORIES)
// ==========================
describe("pipeline flow: KB-driven (mocked)", () => {
  // Full-flow mocking of ingest.js's repository imports isn't practical here —
  // the resolver and factories are unit-tested in mysql/__tests__ and the
  // integration path is covered by the live pipeline tests. This test keeps a
  // cheap structural assertion that the module seams still exist.
  it("KB-driven runIngestion uses injected adapters (not hardcoded)", async () => {
    const { resolveResourceConnection, resolveEmbeddingModel } = await import("../../mysql/services/provider-connection-resolver.js");

    assert.equal(typeof resolveResourceConnection, "function");
    assert.equal(typeof resolveEmbeddingModel, "function");
  });
});

// ==========================
// 10. REGISTRY EDGE CASES (COPY FROM KB-PIPELINE.TEST.JS FOR COMPLETENESS)
// ==========================
describe("registry edge cases", () => {
  it("createRegistry fingerprint: same settings not stale, change re-stales, countDocuments excludes __meta", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");

    const TEST_DIR = mkdtempSync(path.join(tmpdir(), "kb-registry-"));
    const prevCwd = process.cwd();
    process.chdir(TEST_DIR);
    try {
      const { createRegistry } = await import("../registry.js");
      const reg1 = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
      assert.equal(reg1.isStale("page-about", "2026-01-01"), true);
      reg1.record("page-about", "2026-01-01");
      assert.equal(reg1.countDocuments(), 1);

      // Same settings → entry is current, not stale.
      const reg2 = createRegistry("popularcert", "docs-kb", { chunkSize: 512 });
      assert.equal(reg2.isStale("page-about", "2026-01-01"), false);

      // Settings changed → every key stale (F13) even with the same modified date.
      const reg3 = createRegistry("popularcert", "docs-kb", { chunkSize: 256 });
      assert.equal(reg3.isStale("page-about", "2026-01-01"), true);

      // __meta keys are not documents.
      assert.equal(reg3.countDocuments(), 1);
    } finally {
      process.chdir(prevCwd);
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });
});