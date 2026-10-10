// --------------------------
// OPENAI VECTOR STORE ADAPTER TESTS — pure-ESM, mocked fetch, no network.
// Locks the adapter contract: text-search query (vector ignored), attribute
// mapping (r2_key round-trip), store-id precedence, and clear errors when
// unconfigured.
// --------------------------
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.MYSQL_HOST = "";
process.env.MYSQL_USER = "";
process.env.MYSQL_DATABASE = "";

const { OpenAIVectorStoreAdapter } = await import("../adapters/vector/openai.js");

let fetchCalls = [];
const realFetch = globalThis.fetch;

function mockFetch(handler) {
  globalThis.fetch = async (url, opts = {}) => {
    fetchCalls.push({ url: String(url), opts });
    return handler(url, opts);
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  fetchCalls = [];
});

function sampleChunks(n = 2) {
  return Array.from({ length: n }, (_, i) => ({
    id: `chunk-${i}`,
    text: `Sample text for chunk ${i}.`,
    r2_key: `kb/kb/post_x/chunk-${i}.json`,
    url: "https://example.com/post-x",
    title: "Post X",
    metadata: { type: "post", slug: "post-x", chunkIndex: i },
  }));
}

describe("OpenAIVectorStoreAdapter", () => {
  let adapter;

  function createAdapter(overrides = {}) {
    return new OpenAIVectorStoreAdapter(
      {
        apiKey: "sk-test",
        vectorStoreId: "vs_abc",
        maxNumResults: 10,
        companyName: "test-co",
        ...overrides,
      },
      { embeddingAdapter: { embed: async () => [0.1, 0.2] } }
    );
  }

  it("has correct providerKey and resolves the store id from config", () => {
    adapter = createAdapter();
    assert.equal(adapter.providerKey, "openai");
    assert.equal(adapter.vectorStoreId, "vs_abc");
  });

  it("accepts snake_case credentials and falls back to vectorIndexName for the store id", () => {
    adapter = new OpenAIVectorStoreAdapter({ api_key: "sk-s", vectorIndexName: "vs_from_kb" });
    assert.equal(adapter.apiKey, "sk-s");
    assert.equal(adapter.vectorStoreId, "vs_from_kb");
  });

  it("prefers config.vector_store_id over vectorIndexName", () => {
    adapter = new OpenAIVectorStoreAdapter({ api_key: "k", vector_store_id: "vs_cfg", vectorIndexName: "vs_kb" });
    assert.equal(adapter.vectorStoreId, "vs_cfg");
  });

  it("query sends the raw question text (vector ignored) to /search", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        data: [
          {
            file_id: "file_1",
            filename: "kb-chunk-c0.txt",
            score: 0.91,
            attributes: { r2_key: "kb/kb/post_x/chunk-0.json", title: "Post X", chunkIndex: "0" },
            content: [{ type: "text", text: "Relevant chunk text." }],
          },
        ],
      }),
    }));

    adapter = createAdapter();
    const result = await adapter.query([0.1, 0.2], 5, { queryText: "What is HACCP?" });

    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/vector_stores\/vs_abc\/search$/);
    const body = JSON.parse(fetchCalls[0].opts.body);
    assert.equal(body.query, "What is HACCP?");
    assert.equal(body.max_num_results, 5);

    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].id, "file_1");
    assert.equal(result.matches[0].score, 0.91);
    assert.equal(result.matches[0].metadata.r2_key, "kb/kb/post_x/chunk-0.json");
    assert.equal(result.matches[0].metadata.title, "Post X");
  });

  it("query throws a clear error when queryText is missing", async () => {
    adapter = createAdapter();
    await assert.rejects(
      () => adapter.query([0.1], 5, {}),
      /needs the question text/
    );
    assert.equal(fetchCalls.length, 0);
  });

  it("query throws when the store id is missing", async () => {
    adapter = createAdapter({ vectorStoreId: "" });
    await assert.rejects(
      () => adapter.query([0.1], 5, { queryText: "q" }),
      /vector store id is not configured/
    );
    assert.equal(fetchCalls.length, 0);
  });

  it("query surfaces the API error on non-OK response", async () => {
    mockFetch(() => ({ ok: false, status: 401, text: async () => '{"error":{"message":"Invalid API key"}}' }));
    adapter = createAdapter();
    await assert.rejects(() => adapter.query([0.1], 5, { queryText: "q" }), /Invalid API key/);
  });

  it("upsert uploads chunk text as a file and attaches it with attributes", async () => {
    mockFetch((url) => {
      if (String(url).endsWith("/files")) {
        return { ok: true, json: async () => ({ id: "file_new" }) };
      }
      return { ok: true, json: async () => ({ id: "attached" }) };
    });

    adapter = createAdapter();
    await adapter.upsert(sampleChunks(1));

    // 2 calls: upload file + attach to store (no existing-file list hit when listing fails cleanly? we list first → 3rd call)
    const upload = fetchCalls.find((c) => c.url.endsWith("/v1/files"));
    const attach = fetchCalls.find((c) => c.url.endsWith("/vector_stores/vs_abc/files") && c.opts.method === "POST");
    assert.ok(upload, "file upload call missing");
    assert.equal(upload.opts.body.get("purpose"), "assistants");
    assert.ok(attach, "attach call missing");
    const attachBody = JSON.parse(attach.opts.body);
    assert.equal(attachBody.file_id, "file_new");
    assert.equal(attachBody.attributes.r2_key, "kb/kb/post_x/chunk-0.json");
    assert.equal(attachBody.attributes.chunkIndex, "0");
  });

  it("upsert throws on missing chunk.id before any fetch", async () => {
    // No listing results (empty store) — the per-chunk id check runs before
    // the upload fetch for that chunk.
    mockFetch(() => ({ ok: true, json: async () => ({ data: [], has_more: false }) }));
    adapter = createAdapter();
    await assert.rejects(() => adapter.upsert([{ text: "no id" }]), /Missing chunk\.id/);
    assert.equal(fetchCalls.length, 1); // only the best-effort listing call
  });

  it("ensureIndex GETs the store and throws a readable error when absent", async () => {
    mockFetch(() => ({ ok: false, status: 404, text: async () => "Not Found" }));
    adapter = createAdapter();
    await assert.rejects(() => adapter.ensureIndex(), /lookup failed \(404\)/);

    mockFetch(() => ({ ok: true, json: async () => ({ name: "My Store", file_counts: { completed: 3 } }) }));
    adapter = createAdapter();
    await adapter.ensureIndex();
    assert.match(fetchCalls[0].url, /\/vector_stores\/vs_abc$/);
  });

  it("countVectors returns the completed file count, null on failure", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ file_counts: { completed: 7 } }) }));
    adapter = createAdapter();
    assert.equal(await adapter.countVectors(), 7);

    mockFetch(() => ({ ok: false, status: 500 }));
    adapter = createAdapter();
    assert.equal(await adapter.countVectors(), null);
  });
});
