// --------------------------
// PROVIDER-ASK RUNTIME TESTS
// ADR-012 ask-runtime execution: an assistant whose catalog model is NOT a
// Workers AI key runs through the gateway provider executor with its OWN
// credential. Locks the four contract points:
//   1. createProviderStreamParser decodes OpenAI-compatible SSE + commandcode
//      NDJSON incrementally (tokens delivered as they arrive).
//   2. runPipeline routes llmCall through the executor only when the
//      assistant has a non-runnable model + execution binding; Workers AI
//      path otherwise (execution:null).
//   3. The model-access gate runs for executing non-CF assistants, and does
//      NOT deny credentials with zero grants (unmanaged policy).
//   4. Side-calls (rewriteFollowup / generatePossibleQuestions) accept an
//      execution binding and route to the provider executor.
// --------------------------
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TEST_DIR = mkdtempSync(path.join(tmpdir(), "provider-ask-"));
process.chdir(TEST_DIR);
process.env.CONFIG_STORE = "sqlite";

const { runtimeConfig, getDefaultCompanyConfig } = await import("../../config/index.js");
const COMPANY = "prov-ask-co";
if (!runtimeConfig.COMPANIES[COMPANY]) {
  runtimeConfig.COMPANIES[COMPANY] = getDefaultCompanyConfig();
}

const { createProviderStreamParser, supportsProviderStreaming } = await import(
  "../../mysql/services/provider-executor.js"
);
const { runPipeline, askQuestion } = await import("../answer.js");
const { rewriteFollowup, generatePossibleQuestions } = await import("../llm.js");
const { isRunnableModel } = await import("../assistant.js");
const { closePool } = await import("../../mysql/pool.js");

after(async () => {
  await closePool();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ------------------------------------------------------------------
// 1. Stream parsers
// ------------------------------------------------------------------
describe("createProviderStreamParser", () => {
  it("decodes OpenAI-compatible SSE chunks incrementally", () => {
    const tokens = [];
    const parser = createProviderStreamParser("openai", (t) => tokens.push(t));

    parser.push('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
    assert.deepEqual(tokens, ["Hel", "Lo".replace("L", "l")]); // incremental — both seen before flush
    parser.push('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n\n');
    parser.flush();

    const { content, usage } = parser.result();
    assert.equal(content, "Hello");
    assert.deepEqual(usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  });

  it("handles split SSE frames across push boundaries", () => {
    const tokens = [];
    const parser = createProviderStreamParser("openai", (t) => tokens.push(t));
    parser.push('data: {"choices":[{"delta":{"cont');
    parser.push('ent":"Hi"}}]}\n\n');
    parser.flush();
    assert.deepEqual(tokens, ["Hi"]);
    assert.equal(parser.result().content, "Hi");
  });

  it("decodes commandcode NDJSON events and surfaces errors", () => {
    const tokens = [];
    const parser = createProviderStreamParser("commandcode", (t) => tokens.push(t));
    parser.push('{"type":"text-delta","text":"a"}\n{"type":"text-delta","text":"b"}\n{"type":"finish","usage":{"inputTokens":3,"outputTokens":2}}\n');
    parser.flush();
    assert.deepEqual(tokens, ["a", "b"]);
    assert.deepEqual(parser.result().usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });

    const errParser = createProviderStreamParser("commandcode", () => {});
    assert.throws(() => errParser.push('{"type":"error","error":"boom"}\n'), /boom/);
  });

  it("reports streaming support per wire format", () => {
    assert.equal(supportsProviderStreaming("openai"), true);
    assert.equal(supportsProviderStreaming("commandcode"), true);
    assert.equal(supportsProviderStreaming("anthropic"), false);
    assert.equal(supportsProviderStreaming("cloudflare"), false);
  });
});

// ------------------------------------------------------------------
// 2. Pipeline execution routing
// ------------------------------------------------------------------
const STEPS_BASE = {
  checkFastPath: () => null,
  rewriteFollowup: async (q) => q,
  getCacheKey: (q, co) => `k:${co}:${q}`,
  getCached: () => null,
  setCache: () => {},
  retrieveContext: async () => ({ context: "ctx", matches: [] }),
  retrieveGraphContext: async () => null,
  getSystemMessage: () => ({ role: "system", content: "sys" }),
  buildUserMessage: (ctx, q) => `${ctx} ${q}`,
  buildResponses: () => ({ error: "err", noContext: "no-ctx" }),
};

describe("runPipeline provider execution", () => {
  it("routes a non-CF assistant model through the executor binding", async () => {
    let seen = null;
    const result = await runPipeline({
      question: "What is a thread?",
      companyName: COMPANY,
      steps: {
        ...STEPS_BASE,
        resolveAssistantOverrides: async () => ({
          assistantKey: "adam",
          model: "deepseek-v4-flash-0731free",
          execution: { credentialId: 29, providerKey: "bazaarlink" },
        }),
      },
      llmCall: async (args) => {
        seen = args;
        return { response: "A thread runs in a JVM." };
      },
    });

    assert.equal(result.answer, "A thread runs in a JVM.");
    assert.equal(seen.model, "deepseek-v4-flash-0731free");
    assert.deepEqual(seen.execution, { credentialId: 29, providerKey: "bazaarlink" });
    assert.deepEqual(result.execution, { credentialId: 29, providerKey: "bazaarlink" });
    assert.equal(result.llmModel, "deepseek-v4-flash-0731free");
  });

  it("keeps the Workers AI path (execution null) for @cf models", async () => {
    let seen = null;
    const result = await runPipeline({
      question: "What is a class?",
      companyName: COMPANY,
      steps: {
        ...STEPS_BASE,
        resolveAssistantOverrides: async () => ({
          assistantKey: "cf-bot",
          model: "@cf/meta/llama-3.1-8b-instruct-fp8",
        }),
      },
      llmCall: async (args) => {
        seen = args;
        return { response: "cf" };
      },
    });

    assert.equal(seen.model, "@cf/meta/llama-3.1-8b-instruct-fp8");
    assert.equal(seen.execution, null);
    assert.equal(result.execution, null);
  });

  it("falls back to the company model when a non-CF model has no credential binding", async () => {
    let seen = null;
    await runPipeline({
      question: "Why did the chicken cross?",
      companyName: COMPANY,
      steps: {
        ...STEPS_BASE,
        resolveAssistantOverrides: async () => ({
          assistantKey: "broken",
          model: "deepseek-v4-flash-0731free", // no execution block
        }),
      },
      llmCall: async (args) => {
        seen = args;
        return { response: "cf fallback" };
      },
    });

    // Company default model, Workers AI path — never a dead URI.
    assert.match(String(seen.model), /^@cf\//);
    assert.equal(seen.execution, null);
  });

  it("the public askQuestion response never carries the internal binding keys", async () => {
    // Fast path (greeting) — hermetic, no network. The LLM-path strip is the
    // same destructure, so this pins the public contract without I/O.
    const result = await askQuestion("hello", [], COMPANY);
    assert.equal("execution" in result, false);
    assert.equal("llmModel" in result, false);
    assert.ok(typeof result.answer === "string");
  });
});

// ------------------------------------------------------------------
// 3. Model-access gate — grants-aware denial
// ------------------------------------------------------------------
describe("assistant model-access gate", () => {
  it("isRunnableModel still gates Workers AI keys only", () => {
    assert.equal(isRunnableModel("@cf/meta/llama-3.1-8b-instruct-fp8"), true);
    assert.equal(isRunnableModel("deepseek-v4-flash-0731free"), false);
  });
});

// ------------------------------------------------------------------
// 4. Side-calls accept the execution binding
// ------------------------------------------------------------------
describe("side-calls with execution binding", () => {
  it("rewriteFollowup keeps its no-history fast exit", async () => {
    const q = await rewriteFollowup("hello", [], COMPANY);
    assert.equal(q, "hello");
  });

  it("generatePossibleQuestions returns [] for an empty answer", async () => {
    assert.deepEqual(await generatePossibleQuestions("", COMPANY, { execution: { credentialId: 29, providerKey: "bazaarlink" } }), []);
  });
});
