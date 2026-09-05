// --------------------------
// VALIDATION TESTS (pure — no DB)
// Covers the catalog-sourced model keys (Config page → Models & Provider)
// and the AI_PROVIDER key. Regression: @cf/ allowlist still enforced.
// --------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { validateConfigKey } from "../validation.js";

test("model keys accept the Cloudflare @cf/ allowlist", () => {
  assert.equal(validateConfigKey("LLM_MODEL", "@cf/meta/llama-3.1-8b-instruct-fp8"), null);
  assert.equal(validateConfigKey("EMBEDDING_MODEL", "@cf/baai/bge-base-en-v1.5"), null);
  assert.equal(validateConfigKey("SMALL_LLM", "@cf/meta/llama-3.2-3b-instruct"), null);
  assert.equal(validateConfigKey("RERANKING_MODEL", "@cf/baai/bge-reranker-base"), null);
});

test("model keys accept catalog-sourced model IDs", () => {
  assert.equal(validateConfigKey("LLM_MODEL", "gpt-4o"), null);
  assert.equal(validateConfigKey("LLM_MODEL", "gpt-4o-mini"), null);
  assert.equal(validateConfigKey("LLM_MODEL", "o1"), null);
  assert.equal(validateConfigKey("EMBEDDING_MODEL", "text-embedding-3-small"), null);
  assert.equal(validateConfigKey("EMBEDDING_MODEL", "text-embedding-3-large"), null);
  assert.equal(validateConfigKey("RERANKING_MODEL", "bge-reranker-v2-m3"), null);
  // @-prefixed keys not in the allowlist still pass shape validation
  assert.equal(validateConfigKey("LLM_MODEL", "@cf/meta/llama-4.1-8b"), null);
});

test("model keys reject empty / non-string / malformed values", () => {
  assert.ok(validateConfigKey("LLM_MODEL", ""));
  assert.ok(validateConfigKey("LLM_MODEL", "   "));
  assert.ok(validateConfigKey("LLM_MODEL", 42));
  assert.ok(validateConfigKey("LLM_MODEL", "has space"));
  assert.ok(validateConfigKey("LLM_MODEL", "bad|chars"));
});

test("AI_PROVIDER accepts provider keys and rejects bad ones", () => {
  assert.equal(validateConfigKey("AI_PROVIDER", "cloudflare"), null);
  assert.equal(validateConfigKey("AI_PROVIDER", "openai"), null);
  assert.equal(validateConfigKey("AI_PROVIDER", "my_provider_2"), null);
  assert.ok(validateConfigKey("AI_PROVIDER", ""));
  assert.ok(validateConfigKey("AI_PROVIDER", "My Provider"));
  assert.ok(validateConfigKey("AI_PROVIDER", "my-provider"));
});

test("unknown keys are still rejected", () => {
  assert.ok(validateConfigKey("NOT_A_KEY", "x"));
  assert.ok(validateConfigKey("LLM_MODEL", "x")); // 1-char is too short for the shape regex
});

test("GUARDRAIL_PROMPT accepts free text and rejects empty/oversized values", () => {
  assert.equal(validateConfigKey("GUARDRAIL_PROMPT", "Never discuss pricing; direct users to the contact form."), null);
  assert.equal(validateConfigKey("GUARDRAIL_PROMPT", "No technical support answers."), null);
  assert.ok(validateConfigKey("GUARDRAIL_PROMPT", ""));
  assert.ok(validateConfigKey("GUARDRAIL_PROMPT", "   "));
  assert.ok(validateConfigKey("GUARDRAIL_PROMPT", 42));
  assert.ok(validateConfigKey("GUARDRAIL_PROMPT", "x".repeat(8001)));
});

test("BLOCKED_TOPICS accepts newline-separated topics with sane limits", () => {
  assert.equal(validateConfigKey("BLOCKED_TOPICS", "crypto\ninvestments\ngambling"), null);
  assert.equal(validateConfigKey("BLOCKED_TOPICS", "single topic"), null);
  assert.ok(validateConfigKey("BLOCKED_TOPICS", ""));
  assert.ok(validateConfigKey("BLOCKED_TOPICS", 42));
  // >100 topics rejected
  assert.ok(validateConfigKey("BLOCKED_TOPICS", Array.from({ length: 101 }, (_, i) => `topic-${i}`).join("\n")));
  // a single over-long topic rejected
  assert.ok(validateConfigKey("BLOCKED_TOPICS", "x".repeat(121)));
});

test("guardrail keys are known config keys", () => {
  assert.equal(validateConfigKey("GUARDRAIL_PROMPT", "test"), null); // not 'unknown key'
  assert.equal(validateConfigKey("BLOCKED_TOPICS", "test"), null);
});
