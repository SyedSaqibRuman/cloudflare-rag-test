// --------------------------
// ASK-STREAM ANSWER DELIVERY TESTS
// The stream contract must never leave the client with an empty bubble: every
// pipeline path that returns answer text WITHOUT calling the LLM (cache hit,
// custom Q&A, no-context, model-access denial) has to deliver that text as a
// token frame. Regression: those paths emitted zero tokens, so the admin
// Test AI page rendered a blank assistant message next to the metadata and
// follow-up-question frames.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runtimeConfig, getCompanyConfig, getDefaultCompanyConfig } from "../../config/index.js";
import { getCacheKey, setCache, clearCompanyCache } from "../cache.js";
import { getLlmModel } from "../llm.js";
import { askQuestionStream } from "../answer.js";
import { createStreamTransport } from "../stream-contract.js";

const COMPANY = "stream-answer-test-co";
if (!runtimeConfig.COMPANIES[COMPANY]) {
  runtimeConfig.COMPANIES[COMPANY] = getDefaultCompanyConfig();
}

const QUESTION = "Which JVM tuning flags should I use for a large heap?";

const framesToTokens = (frames) =>
  frames
    .filter((f) => f.startsWith('data: {"token"'))
    .map((f) => JSON.parse(f.slice(6)).token);

// The legacy start sentinel rides the token frame channel — the client's frame
// dispatcher filters it (web/src/ask-stream-contract.js), so the helpers do too.
const START_SENTINEL = "__START_RESPONSE__";
const framesToAnswerTokens = (frames) => framesToTokens(frames).filter((t) => t !== START_SENTINEL);

const framesToPayloads = (frames) =>
  frames
    .filter((f) => f.startsWith("data: {"))
    .map((f) => JSON.parse(f.slice(6)));

/**
 * The retrieval-binding fingerprint the pipeline derives for a company with no
 * selected assistant (answer.js getRetrievalBinding): config values with the
 * pipeline defaults as fallbacks.
 */
function cacheBindingFor(companyName) {
  const cfg = getCompanyConfig(companyName) || {};
  return {
    embeddingModel: cfg.EMBEDDING_MODEL || "@cf/baai/bge-base-en-v1.5",
    vectorIndex: cfg.VECTOR_INDEX || "",
    llmModel: getLlmModel(companyName),
  };
}

function collectFrames() {
  const frames = [];
  return { frames, transport: createStreamTransport({ write: (f) => frames.push(f) }) };
}

describe("askQuestionStream answer delivery", () => {
  it("streams a cached answer as a token instead of leaving the bubble blank", async () => {
    const answer = "Use -Xmx to cap the heap and -Xms to fix the initial size.";
    setCache(
      getCacheKey(QUESTION, COMPANY, "", cacheBindingFor(COMPANY)),
      { answer, sources: [], matches: [], graph: null, cached: false },
      COMPANY
    );

    const { frames, transport } = collectFrames();
    const ok = await askQuestionStream(QUESTION, [], transport, COMPANY);

    assert.equal(ok, true);
    // The text reaches the client — this is the regression guard.
    assert.deepEqual(framesToTokens(frames), [answer]);

    // The answer is followed by the metadata + [DONE] terminator, never an error.
    const payloads = framesToPayloads(frames);
    assert.equal(payloads[0].token, answer);
    assert.equal(payloads.some((p) => p.error), false);
    assert.ok(frames.at(-1).includes("[DONE]"));

    clearCompanyCache(COMPANY);
  });

  it("still streams fast-path answers (greeting) without an LLM call", async () => {
    const { frames, transport } = collectFrames();
    const ok = await askQuestionStream("hello", [], transport, COMPANY);

    assert.equal(ok, true);
    // Sentinel first (clears the client's "Thinking…" state), then the greeting.
    assert.deepEqual(framesToTokens(frames)[0], START_SENTINEL);
    assert.equal(framesToAnswerTokens(frames).length, 1);
    assert.match(framesToAnswerTokens(frames)[0], /Welcome to/);
    assert.ok(frames.at(-1).includes("[DONE]"));
  });
});