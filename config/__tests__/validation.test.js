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

test("BLOCKED_PATTERNS accepts literal and /regex/ lines with sane limits", () => {
  assert.equal(validateConfigKey("BLOCKED_PATTERNS", "crypto\n/write.*haiku/i"), null);
  assert.equal(validateConfigKey("BLOCKED_PATTERNS", "single pattern"), null);
  assert.ok(validateConfigKey("BLOCKED_PATTERNS", ""));
  assert.ok(validateConfigKey("BLOCKED_PATTERNS", 42));
  // >100 patterns rejected
  assert.ok(validateConfigKey("BLOCKED_PATTERNS", Array.from({ length: 101 }, (_, i) => `pat-${i}`).join("\n")));
  // a single over-long pattern rejected
  assert.ok(validateConfigKey("BLOCKED_PATTERNS", "x".repeat(201)));
  // invalid /regex/ lines rejected at save time
  assert.ok(validateConfigKey("BLOCKED_PATTERNS", "crypto\n/([unclosed/").includes("invalid pattern"));
});

test("guardrail keys are known config keys", () => {
  assert.equal(validateConfigKey("GUARDRAIL_PROMPT", "test"), null); // not 'unknown key'
  assert.equal(validateConfigKey("BLOCKED_TOPICS", "test"), null);
  assert.equal(validateConfigKey("BLOCKED_PATTERNS", "test"), null);
});

// --------------------------
// PROMPT_VARIABLES (custom {{VARIABLE}} pairs)
// --------------------------

test("PROMPT_VARIABLES accepts an array of {key,value} pairs", () => {
  assert.equal(validateConfigKey("PROMPT_VARIABLES", []), null);
  assert.equal(
    validateConfigKey("PROMPT_VARIABLES", [
      { key: "BRAND", value: "Acme" },
      { key: "PHONE", value: "555" },
    ]),
    null
  );
  // Keys are normalized (trimmed/uppercased) rather than rejected.
  assert.equal(validateConfigKey("PROMPT_VARIABLES", [{ key: " brand ", value: "Acme" }]), null);
  // A null value is a deliberate empty expansion.
  assert.equal(validateConfigKey("PROMPT_VARIABLES", [{ key: "OPTIONAL" }]), null);
});

test("PROMPT_VARIABLES rejects non-arrays and malformed pairs", () => {
  assert.ok(validateConfigKey("PROMPT_VARIABLES", "BRAND=Acme"));
  assert.ok(validateConfigKey("PROMPT_VARIABLES", 42));
  assert.ok(validateConfigKey("PROMPT_VARIABLES", null));
  assert.ok(validateConfigKey("PROMPT_VARIABLES", ["BRAND"]));
  // A non-object entry.
  assert.ok(validateConfigKey("PROMPT_VARIABLES", [{ key: "A", value: "b" }, "nope"]));
  // An entirely blank key is an operator error worth reporting.
  assert.ok(validateConfigKey("PROMPT_VARIABLES", [{ key: "  ", value: "Acme" }]));
});

test("PROMPT_VARIABLES enforces key charset, value length and count limits", () => {
  // Keys must be uppercase identifiers — a lowercase key would silently never
  // match a {{placeholder}} written in the template, so reject it at save time.
  assert.ok(validateConfigKey("PROMPT_VARIABLES", [{ key: "brand name", value: "Acme" }]));
  assert.ok(validateConfigKey("PROMPT_VARIABLES", [{ key: "1BRAND", value: "Acme" }]));
  assert.ok(validateConfigKey("PROMPT_VARIABLES", [{ key: "A".repeat(65), value: "x" }]));
  assert.ok(validateConfigKey("PROMPT_VARIABLES", [{ key: "OK", value: "x".repeat(2001) }]));
  assert.ok(
    validateConfigKey(
      "PROMPT_VARIABLES",
      Array.from({ length: 51 }, (_, i) => ({ key: `K${i}`, value: "v" }))
    )
  );
  // Exactly at the caps is fine.
  assert.equal(
    validateConfigKey("PROMPT_VARIABLES", [{ key: "A".repeat(64), value: "x".repeat(2000) }]),
    null
  );
});

