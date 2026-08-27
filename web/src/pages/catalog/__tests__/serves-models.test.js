// --------------------------
// CATALOG — servesModels() + usesEnvironments() unit tests (9Router card
// gating). Pure node --test (node:test + node:assert/strict); imports
// utils.js which is plain ESM with no node_modules deps, so no install needed.
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorTag, hasResourceTemplates, servesModels, usesEnvironments } from "../utils.js";

// -------- compatible endpoints (oc_/ac_ prefixes) ------------------------
test("OpenAI-compatible key serves models even with no capability rows", () => {
  assert.equal(servesModels("oc_my_gateway", {}, null), true);
});

test("Anthropic-compatible key serves models even with no capability rows", () => {
  assert.equal(servesModels("ac_my_gateway", { capabilityKeys: ["web_search"] }, null), true);
});

test("compatible prefix wins regardless of capabilityKeys", () => {
  assert.equal(servesModels("oc_x", { capabilityKeys: [] }, null), true);
});

// -------- capability-key gate (light list provider row) -------------------
test("chat capability → serves models", () => {
  assert.equal(
    servesModels("openai", { capabilityKeys: ["chat", "streaming"] }, null),
    true
  );
});

test("embeddings capability → serves models", () => {
  assert.equal(servesModels("voyage-ai", { capabilityKeys: ["embeddings"] }, null), true);
});

test("text_to_speech capability → serves models", () => {
  assert.equal(servesModels("elevenlabs", { capabilityKeys: ["text_to_speech"] }, null), true);
});

test("speech_to_text capability → serves models", () => {
  assert.equal(servesModels("deepgram", { capabilityKeys: ["speech_to_text"] }, null), true);
});

test("image_generation capability → serves models", () => {
  assert.equal(servesModels("stability-ai", { capabilityKeys: ["image_generation"] }, null), true);
});

test("vision capability → serves models", () => {
  assert.equal(servesModels("openai", { capabilityKeys: ["vision"] }, null), true);
});

// -------- non-model providers --------------------------------------------
test("web_search-only provider (brave-search) does not serve models", () => {
  assert.equal(servesModels("brave-search", { capabilityKeys: ["web_search"] }, null), false);
});

test("vector_search-only provider (pinecone) does not serve models", () => {
  assert.equal(servesModels("pinecone", { capabilityKeys: ["vector_search"] }, null), false);
});

test("resource-only provider (weaviate, no caps) does not serve models", () => {
  assert.equal(servesModels("weaviate", { capabilityKeys: [] }, null), false);
});

test("object_storage capability does not serve models", () => {
  assert.equal(servesModels("s3", { capabilityKeys: ["object_storage"] }, null), false);
});

// -------- full registry detail (is_supported flag) ------------------------
test("detail capabilities with is_supported chat → serves models even when light row is empty", () => {
  const detail = { capabilities: [{ capability_key: "chat", is_supported: true }] };
  assert.equal(servesModels("cloudflare", { capabilityKeys: [] }, detail), true);
});

test("detail capability with is_supported=false is ignored", () => {
  const detail = { capabilities: [{ capability_key: "chat", is_supported: false }] };
  assert.equal(servesModels("cloudflare", { capabilityKeys: [] }, detail), false);
});

test("detail capabilities are consulted when light provider row is missing", () => {
  const detail = { capabilities: [{ capability_key: "embeddings", is_supported: true }] };
  assert.equal(servesModels("cloudflare", undefined, detail), true);
});

test("detail resource/vector caps do not count as model-serving", () => {
  const detail = {
    capabilities: [
      { capability_key: "vector_index_resource", is_supported: true },
      { capability_key: "vector_search", is_supported: true },
    ],
  };
  assert.equal(servesModels("cloudflare_vectorize", {}, detail), false);
});

// -------- empty / defensive ----------------------------------------------
test("null provider and null detail → false", () => {
  assert.equal(servesModels("pinecone", null, null), false);
});

test("missing everything → false", () => {
  assert.equal(servesModels(undefined, {}, null), false);
});

// ==================================================================
// usesEnvironments() — Environments-card gate
// ==================================================================

const ENVS = [{ env_key: "production" }, { env_key: "staging" }];
const CREDS = [
  { provider_key: "cloudflare", credential_key: "a" },
  { provider_key: "openai", credential_key: "b" },
];

// -------- required conditions ---------------------------------------------
test("env card shows when company has environments AND provider has credentials", () => {
  assert.equal(usesEnvironments("cloudflare", "acme", ENVS, CREDS), true);
});

test("env card hides without a company selected", () => {
  assert.equal(usesEnvironments("cloudflare", "", ENVS, CREDS), false);
});

test("env card hides when the company has no environments", () => {
  assert.equal(usesEnvironments("cloudflare", "acme", [], CREDS), false);
});

test("env card hides when the provider has no credentials in the company", () => {
  assert.equal(usesEnvironments("pinecone", "acme", ENVS, CREDS), false);
});

// -------- defensive -------------------------------------------------------
test("env card hides when creds are missing/null", () => {
  assert.equal(usesEnvironments("cloudflare", "acme", ENVS, undefined), false);
  assert.equal(usesEnvironments("cloudflare", "acme", ENVS, null), false);
});

test("env card hides when environments are missing/null", () => {
  assert.equal(usesEnvironments("cloudflare", "acme", undefined, CREDS), false);
  assert.equal(usesEnvironments("cloudflare", "acme", null, CREDS), false);
});

test("env card shows with exactly one matching credential", () => {
  assert.equal(usesEnvironments("openai", "acme", ENVS, CREDS), true);
});

test("env card shows with inactive credentials included (creds list has no active filter here)", () => {
  const inactive = [{ provider_key: "cloudflare", is_active: false }];
  assert.equal(usesEnvironments("cloudflare", "acme", ENVS, inactive), true);
});

// ==================================================================
// hasResourceTemplates() — Resources-card gate
// ==================================================================

test("resources card shows when the provider detail has templates", () => {
  const detail = { resourceTemplates: [{ resource_type: "vector_index" }] };
  assert.equal(hasResourceTemplates(detail), true);
});

test("resources card hides when the only template is the 'none' sentinel", () => {
  const detail = { resourceTemplates: [{ resource_type: "none" }] };
  assert.equal(hasResourceTemplates(detail), false);
});

test("resources card shows when real templates coexist with the 'none' sentinel", () => {
  const detail = {
    resourceTemplates: [
      { resource_type: "none" },
      { resource_type: "vector_index" },
      { resource_type: "object_bucket" },
    ],
  };
  assert.equal(hasResourceTemplates(detail), true);
});

test("resources card hides when the provider has zero templates", () => {
  assert.equal(hasResourceTemplates({ resourceTemplates: [] }), false);
});

test("resources card hides when resourceTemplates is missing", () => {
  assert.equal(hasResourceTemplates({ capabilities: [] }), false);
});

test("resources card hides while detail is still loading (null)", () => {
  assert.equal(hasResourceTemplates(null), false);
  assert.equal(hasResourceTemplates(undefined), false);
});

// ==================================================================
// errorTag() — provider error → 9Router diagnosis tag.
// Mirrors the backend's diagnoseError() (mysql/routes/credentials.js) exactly:
//   1. first 4xx/5xx in the message is the literal tag (401/403 → AUTH)
//   2. per-provider vocabulary (OpenAI/Anthropic/Gemini/Cloudflare tokens)
//   3. generic patterns → RUNTIME/AUTH/429/5XX/NET, else ERR.
// ==================================================================

test("errorTag returns null for empty messages", () => {
  assert.equal(errorTag(null), null);
  assert.equal(errorTag(""), null);
  assert.equal(errorTag(undefined), null);
});

test("errorTag stringifies non-string messages", () => {
  assert.equal(errorTag(500), "500");
  assert.equal(errorTag(401), "AUTH");
});

// -------- 1. literal 4xx/5xx codes (9Router getErrorCode) ---------------
test("errorTag: first 4xx/5xx becomes the literal tag", () => {
  assert.equal(errorTag("Upstream returned 429"), "429");
  assert.equal(errorTag("HTTP 502 Bad Gateway from provider"), "502");
  assert.equal(errorTag("500: internal error"), "500");
  assert.equal(errorTag("call failed with 404 not found"), "404");
});

test("errorTag: 401 and 403 map to AUTH (9Router rule)", () => {
  assert.equal(errorTag("Got 401 unauthorized"), "AUTH");
  assert.equal(errorTag("403 forbidden"), "AUTH");
});

test("errorTag: the FIRST 4xx/5xx wins", () => {
  assert.equal(errorTag("attempted retry after 429 then died 500"), "429");
});

// -------- 2. per-provider vocabulary -------------------------------------
test("errorTag: OpenAI tokens map to 9Router buckets", () => {
  assert.equal(errorTag("invalid_api_key provided"), "AUTH");
  assert.equal(errorTag("You exceeded your current quota, insufficient_quota"), "429");
  assert.equal(errorTag("rate_limit_exceeded"), "429");
  assert.equal(errorTag("server_error"), "5XX");
  assert.equal(errorTag("internal_error"), "5XX");
});

test("errorTag: Anthropic tokens (providerKey selects the vocab)", () => {
  assert.equal(errorTag("authentication_error", "anthropic"), "AUTH");
  assert.equal(errorTag("permission_error", "anthropic"), "AUTH");
  assert.equal(errorTag("rate_limit_error", "anthropic"), "429");
  assert.equal(errorTag("overloaded_error", "anthropic"), "429");
  assert.equal(errorTag("api_error", "anthropic"), "5XX");
});

test("errorTag: Gemini statuses", () => {
  assert.equal(errorTag("status UNAUTHENTICATED", "gemini"), "AUTH");
  assert.equal(errorTag("PERMISSION_DENIED", "gemini-cli"), "AUTH");
  assert.equal(errorTag("resource_exhausted", "antigravity"), "429");
  assert.equal(errorTag("deadline_exceeded", "gemini"), "5XX");
});

test("errorTag: Cloudflare numeric auth codes (not 4xx/5xx, so vocab catches them)", () => {
  assert.equal(errorTag("9109 — Invalid API Token", "cloudflare"), "AUTH");
  assert.equal(errorTag("10000 Authentication error", "cloudflare"), "AUTH");
  assert.equal(errorTag("10001 invalid token", "cloudflare"), "AUTH");
});

test("errorTag: providerKey is case-insensitive and families share vocab", () => {
  assert.equal(errorTag("invalid_api_key"), "AUTH"); // default OpenAI vocab
  assert.equal(errorTag("9109", "ClouDflare"), "AUTH"); // case-insensitive providerKey → cloudflare vocab
  assert.equal(errorTag("rate_limit_error", "kimi"), "429"); // kimi → Anthropic vocab
  assert.equal(errorTag("unauthenticated", "GEMINI"), "AUTH");
  // cloudflare vocab has no invalid_api_key token — OpenAI tokens only apply
  // to providers that actually use the OpenAI vocabulary.
  assert.equal(errorTag("invalid_api_key", "cloudflare"), "ERR");
});

// -------- 3. generic patterns + fallback ---------------------------------
test("errorTag: RUNTIME patterns", () => {
  assert.equal(errorTag("model not runnable on this device"), "RUNTIME");
  assert.equal(errorTag("runtime error"), "RUNTIME");
  assert.equal(errorTag("dependency not installed"), "RUNTIME");
});

test("errorTag: AUTH patterns without a code", () => {
  assert.equal(errorTag("Invalid API key provided"), "AUTH");
  assert.equal(errorTag("Your api key is invalid"), "AUTH");
  assert.equal(errorTag("token invalid or revoked"), "AUTH");
  assert.equal(errorTag("unauthorized"), "AUTH");
  assert.equal(errorTag("access denied"), "AUTH");
  assert.equal(errorTag("authentication failed"), "AUTH");
  assert.equal(errorTag("permission denied"), "AUTH");
});

test("errorTag: 429 wording without a code", () => {
  assert.equal(errorTag("rate limit hit"), "429");
  assert.equal(errorTag("too many requests"), "429");
  assert.equal(errorTag("quota exhausted"), "429");
  assert.equal(errorTag("overloaded"), "429");
});

test("errorTag: 5XX wording without a code", () => {
  assert.equal(errorTag("server error"), "5XX");
  assert.equal(errorTag("internal server error"), "5XX");
  assert.equal(errorTag("bad gateway"), "5XX");
  assert.equal(errorTag("service unavailable"), "5XX");
});

test("errorTag: NET patterns", () => {
  assert.equal(errorTag("connect ECONNRESET"), "NET");
  assert.equal(errorTag("socket hang up"), "NET");
  assert.equal(errorTag("network error"), "NET");
  assert.equal(errorTag("fetch failed"), "NET");
  assert.equal(errorTag("getaddrinfo ENOTFOUND"), "NET");
  assert.equal(errorTag("ETIMEDOUT"), "NET");
  assert.equal(errorTag("ECONNREFUSED"), "NET");
  assert.equal(errorTag("host unreachable"), "NET");
});

test("errorTag: unknown messages fall back to ERR", () => {
  assert.equal(errorTag("something completely unexpected happened"), "ERR");
  assert.equal(errorTag("weird upstream response: zebra"), "ERR");
});

test("errorTag: code extraction wins over vocab (9Router getErrorCode first)", () => {
  // Even a vocab-token message with a literal code returns the code.
  assert.equal(errorTag("401 invalid_api_key"), "AUTH"); // 401 → AUTH anyway
  assert.equal(errorTag("500 server_error"), "500"); // literal 500, not 5XX
  assert.equal(errorTag("429 rate_limit_exceeded"), "429");
});
