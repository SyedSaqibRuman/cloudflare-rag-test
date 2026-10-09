import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "../answer.js";
import { runtimeConfig, getDefaultCompanyConfig } from "../../config/index.js";
import { closePool } from "../../mysql/pool.js";

// runPipeline best-effort logs usage via the lazy MySQL pool (logUsage in
// answer.js). When .env has live MySQL creds this opens a real pooled socket
// that otherwise keeps the process alive after the last test — close it so the
// suite exits cleanly. No-op when the pool was never opened.
after(async () => {
  await closePool();
});

if (!Object.keys(runtimeConfig.COMPANIES).length) {
  runtimeConfig.COMPANIES.testco = getDefaultCompanyConfig();
}

// --------------------------
// Fake services
// --------------------------
function makeSteps(overrides = {}) {
  return {
    checkFastPath: overrides.checkFastPath || (() => null),
    resolveAssistantOverrides: overrides.resolveAssistantOverrides || (async () => null),
    rewriteFollowup: overrides.rewriteFollowup || (async (q) => q),
    getCacheKey: overrides.getCacheKey || ((q, co) => `key:${co}:${q}`),
    getCached: overrides.getCached || (() => null),
    setCache: overrides.setCache || (() => {}),
    retrieveContext: overrides.retrieveContext || (async () => ({ context: "ctx", matches: [] })),
    retrieveGraphContext: overrides.retrieveGraphContext || (async () => null),
    getSystemMessage: overrides.getSystemMessage || (() => ({ role: "system", content: "sys" })),
    buildUserMessage: overrides.buildUserMessage || ((ctx, q) => `${ctx}\n\n${q}`),
    buildResponses: overrides.buildResponses || (() => ({ noContext: "no-ctx", error: "err" })),
  };
}

// --------------------------
// Tests
// --------------------------
describe("runPipeline", () => {
  it("returns fast-path response without touching other services", async () => {
    const result = await runPipeline({
      question: "hello",
      companyName: "testco",
      llmCall: async () => ({ response: "should not reach" }),
      steps: makeSteps({
        checkFastPath: (q) => q === "hello" ? "Hi there!" : null,
      }),
    });

    assert.equal(result.answer, "Hi there!");
    assert.deepEqual(result.sources, []);
    assert.deepEqual(result.matches, []);
    assert.equal(result.graph, null);
    assert.equal(result.cached, false);
  });

  it("returns cache hit without touching retrieval or LLM", async () => {
    const result = await runPipeline({
      question: "cached question",
      companyName: "testco",
      llmCall: async () => ({ response: "should not reach" }),
      steps: makeSteps({
        getCached: () => ({ answer: "cached answer", sources: [], matches: [], graph: null }),
      }),
    });

    assert.equal(result.answer, "cached answer");
    assert.equal(result.cached, true);
  });

  it("returns no-context response when retrieval yields nothing", async () => {
    const result = await runPipeline({
      question: "anything",
      companyName: "testco",
      llmCall: async () => ({ response: "should not reach" }),
      steps: makeSteps({
        retrieveContext: async () => ({ context: null, matches: [] }),
      }),
    });

    assert.equal(result.answer, "no-ctx");
    assert.deepEqual(result.sources, []);
    assert.deepEqual(result.matches, []);
    assert.equal(result.graph, null);
  });

  it("runs full pipeline: retrieval → graph → messages → llmCall", async () => {
    const calls = [];
    const result = await runPipeline({
      question: "full pipeline question",
      history: [{ role: "user", content: "previous" }],
      companyName: "testco",
      llmCall: async ({ messages, model, temperature, max_tokens }) => {
        calls.push({ messages, model, temperature, max_tokens });
        return { response: "assembled answer" };
      },
      steps: makeSteps({
        retrieveContext: async () => ({
          context: "retrieved context",
          matches: [
            { metadata: { title: "Doc A" }, score: 0.9 },
            { metadata: { title: "Doc B" }, score: 0.8 },
          ],
        }),
        retrieveGraphContext: async () => ({ cypher: "MATCH (x) RETURN x", context: "graph context" }),
      }),
    });

    assert.equal(result.answer, "assembled answer");
    assert.equal(result.sources.length, 2);
    assert.equal(result.sources[0].title, "Doc A");
    assert.equal(result.matches.length, 2);
    assert.equal(result.graph.cypher, "MATCH (x) RETURN x");
    assert.equal(result.cached, false);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].messages[0].role, "system");
    assert.equal(calls[0].messages[calls[0].messages.length - 1].role, "user");
    assert.equal(calls[0].messages[calls[0].messages.length - 1].content, "retrieved context\ngraph context\n\nfull pipeline question");
  });

  it("caps history at MAX_HISTORY messages", async () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `msg ${i}` }));
    let msgCount = 0;

    await runPipeline({
      question: "capped history",
      history,
      companyName: "testco",
      llmCall: async ({ messages }) => {
        msgCount = messages.length;
        return { response: "ok" };
      },
      steps: makeSteps(),
    });

    // system + MAX_HISTORY (6) + user = 8
    assert.ok(msgCount <= 8, `expected ≤8 messages, got ${msgCount}`);
  });

  it("uses assistant overrides for model, temperature, max_tokens, vector index", async () => {
    const calls = [];
    const result = await runPipeline({
      question: "assistant question",
      companyName: "testco",
      llmCall: async ({ model, temperature, max_tokens }) => {
        calls.push({ model, temperature, max_tokens });
        return { response: "answer" };
      },
      steps: makeSteps({
        resolveAssistantOverrides: async () => ({
          assistantKey: "asst-1",
          model: "@cf/test-model",
          temperature: 0.5,
          maxTokens: 100,
          vectorIndex: "custom-index",
          enableGraph: true,
          graphDatabase: "neo4j-db",
        }),
      }),
    });

    assert.equal(result.answer, "answer");
    assert.equal(calls[0].model, "@cf/test-model");
    assert.equal(calls[0].temperature, 0.5);
    assert.equal(calls[0].max_tokens, 100);
  });

  it("passes retrieval options (indexName) through to retrieveContext", async () => {
    let retrievedWithIndex = null;
    const result = await runPipeline({
      question: "index test",
      companyName: "testco",
      llmCall: async () => ({ response: "ok" }),
      steps: makeSteps({
        retrieveContext: async (q, co, opts) => {
          retrievedWithIndex = opts?.indexName;
          return { context: "ctx", matches: [] };
        },
      }),
    });

    // Without assistant, indexName is null
    assert.equal(retrievedWithIndex, null);
    assert.equal(result.answer, "ok");
  });

  it("propagates errors from llmCall", async () => {
    let thrown = null;
    try {
      await runPipeline({
        question: "error question",
        companyName: "testco",
        llmCall: async () => {
          throw new Error("LLM down");
        },
        steps: makeSteps({
          retrieveContext: async () => ({ context: "ctx", matches: [] }),
        }),
      });
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown, "expected error to propagate");
    assert.equal(thrown.message, "LLM down");
  });

  it("calls onToken for each streaming token", async () => {
    const tokens = [];
    const result = await runPipeline({
      question: "stream test",
      companyName: "testco",
      llmCall: async ({ onToken }) => {
        onToken?.("Hello");
        onToken?.(" world");
        return { response: "Hello world" };
      },
      onToken: (token) => tokens.push(token),
      steps: makeSteps({
        retrieveContext: async () => ({ context: "ctx", matches: [] }),
      }),
    });

    assert.deepEqual(tokens, ["Hello", " world"]);
    assert.equal(result.answer, "Hello world");
  });

  // --------------------------
  // MODEL-ACCESS GATE
  // The gate only applies to a RUNNABLE assistant model — the one the pipeline
  // actually executes. A non-runnable catalog model falls back to the company's
  // own LLM, so gating it would deny (and blank) an answer that never needed
  // that credential. Regression for the Test AI page's blank responses.
  // --------------------------
  it("denies an ask when the runnable assistant model has no access grant", async () => {
    let llmCalled = false;
    const result = await runPipeline({
      question: "gate denial",
      companyName: "testco",
      llmCall: async () => { llmCalled = true; return { response: "should not reach" }; },
      steps: {
        ...makeSteps({
          resolveAssistantOverrides: async () => ({
            assistantKey: "asst-1",
            model: "@cf/meta/llama-3.1-8b-instruct-fp8",
          }),
        }),
        checkModelAccess: async () => ({ allowed: false, reason: "No access grant found for this credential/model pair." }),
      },
    });

    assert.equal(llmCalled, false);
    assert.match(result.answer, /Model access denied/);
    assert.equal(result.denied, true);
  });

  it("skips the gate for a non-runnable assistant model (company LLM answers)", async () => {
    let gateChecked = false;
    let llmCalled = false;
    const result = await runPipeline({
      question: "gate skipped",
      companyName: "testco",
      llmCall: async () => { llmCalled = true; return { response: "A class is a blueprint." }; },
      steps: {
        ...makeSteps({
          resolveAssistantOverrides: async () => ({
            assistantKey: "muse",
            model: "poolside/laguna-s-2.1:free",
          }),
        }),
        checkModelAccess: async () => { gateChecked = true; return { allowed: false, reason: "nope" }; },
      },
    });

    assert.equal(gateChecked, false);
    assert.equal(llmCalled, true);
    assert.equal(result.answer, "A class is a blueprint.");
    assert.equal(result.denied, undefined);
  });
});
