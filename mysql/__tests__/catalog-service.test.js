// --------------------------
// CATALOG SERVICE TESTS — pure validation, no MySQL needed.
// Run with: node --test "mysql/__tests__/*.test.js"
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HTTP_METHODS,
  ENDPOINT_KEY_RE,
  validateEndpointInput,
  validatePricingInput,
} from "../services/catalog-service.js";

const VALID_ENDPOINT = {
  providerKey: "cloudflare",
  endpointKey: "chat-completions",
  endpointName: "Chat Completions",
  endpointUrl: "https://api.cloudflare.com/client/v4/ai/run",
};

const VALID_PRICING = {
  providerModelId: 7,
  effectiveFrom: "2025-01-01",
};

test("validateEndpointInput rejects missing providerKey/endpointKey/endpointName/endpointUrl", () => {
  const result = validateEndpointInput({});
  assert.equal(result.ok, false);
  assert.ok(result.errors.providerKey);
  assert.ok(result.errors.endpointKey);
  assert.ok(result.errors.endpointName);
  assert.ok(result.errors.endpointUrl);
});

test("rejects endpoint_key with uppercase/spaces/underscore (ENDPOINT_KEY_RE)", () => {
  for (const bad of ["ChatCompletions", "chat completions", "chat_completions", "chat.completions"]) {
    const result = validateEndpointInput({ ...VALID_ENDPOINT, endpointKey: bad });
    assert.equal(result.ok, false, `should reject '${bad}'`);
    assert.ok(result.errors.endpointKey);
  }
  assert.match("chat-completions", ENDPOINT_KEY_RE);
});

test("rejects endpoint_key < 3 or > 50 chars", () => {
  for (const bad of ["ab", "a".repeat(51)]) {
    const result = validateEndpointInput({ ...VALID_ENDPOINT, endpointKey: bad });
    assert.equal(result.ok, false, `should reject length ${bad.length}`);
    assert.ok(result.errors.endpointKey);
  }
});

test("rejects bad URL", () => {
  const result = validateEndpointInput({ ...VALID_ENDPOINT, endpointUrl: "not a url" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.endpointUrl);
});

test("rejects unknown httpMethod; defaults to POST when omitted", () => {
  const bad = validateEndpointInput({ ...VALID_ENDPOINT, httpMethod: "TRACE" });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.httpMethod);

  const good = validateEndpointInput(VALID_ENDPOINT);
  assert.equal(good.ok, true);
  assert.equal(good.value.httpMethod, "POST");
});

test("rejects non-integer/out-of-range timeout; defaults to 30", () => {
  for (const bad of [1.5, 0, -5, 3601, "30"]) {
    const result = validateEndpointInput({ ...VALID_ENDPOINT, defaultTimeoutSeconds: bad });
    assert.equal(result.ok, false, `should reject timeout ${JSON.stringify(bad)}`);
    assert.ok(result.errors.defaultTimeoutSeconds);
  }
  const good = validateEndpointInput(VALID_ENDPOINT);
  assert.equal(good.value.defaultTimeoutSeconds, 30);
});

test("accepts a fully valid endpoint input and returns normalized value", () => {
  const result = validateEndpointInput({
    ...VALID_ENDPOINT,
    httpMethod: "GET",
    defaultTimeoutSeconds: 60,
    isDefault: true,
    isActive: false,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    providerKey: "cloudflare",
    endpointKey: "chat-completions",
    endpointName: "Chat Completions",
    endpointUrl: "https://api.cloudflare.com/client/v4/ai/run",
    httpMethod: "GET",
    defaultTimeoutSeconds: 60,
    isDefault: true,
    isActive: false,
  });
});

test("validatePricingInput rejects missing providerModelId / effectiveFrom", () => {
  const result = validatePricingInput({});
  assert.equal(result.ok, false);
  assert.ok(result.errors.providerModelId);
  assert.ok(result.errors.effectiveFrom);
});

test("rejects invalid date string and effectiveTo <= effectiveFrom", () => {
  const badDate = validatePricingInput({ ...VALID_PRICING, effectiveFrom: "2025/01/01" });
  assert.equal(badDate.ok, false);
  assert.ok(badDate.errors.effectiveFrom);

  const badRange = validatePricingInput({ ...VALID_PRICING, effectiveFrom: "2025-01-10", effectiveTo: "2025-01-10" });
  assert.equal(badRange.ok, false);
  assert.ok(badRange.errors.effectiveTo);

  const good = validatePricingInput({ ...VALID_PRICING, effectiveFrom: "2025-01-10", effectiveTo: "2025-02-01" });
  assert.equal(good.ok, true);
});

test("rejects negative/non-numeric prices; accepts null optional prices", () => {
  const negative = validatePricingInput({ ...VALID_PRICING, inputPricePerMillion: -1 });
  assert.equal(negative.ok, false);
  assert.ok(negative.errors.inputPricePerMillion);

  const nan = validatePricingInput({ ...VALID_PRICING, requestPrice: "free" });
  assert.equal(nan.ok, false);
  assert.ok(nan.errors.requestPrice);

  const nulls = validatePricingInput({ ...VALID_PRICING, outputPricePerMillion: null });
  assert.equal(nulls.ok, true);
  assert.equal(nulls.value.outputPricePerMillion, null);
});

test("defaults currency USD, billingUnit tokens, tierName standard", () => {
  const result = validatePricingInput(VALID_PRICING);
  assert.equal(result.ok, true);
  assert.equal(result.value.priceCurrency, "USD");
  assert.equal(result.value.billingUnit, "tokens");
  assert.equal(result.value.tierName, "standard");
});

test("accepts full optional price column set (cached/audio/image/request)", () => {
  const result = validatePricingInput({
    ...VALID_PRICING,
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 5,
    cachedInputPricePerMillion: 0.125,
    imagePrice: 0.02,
    audioInputPricePerMillion: 2.5,
    audioOutputPricePerMillion: 10,
    requestPrice: 0.0001,
    minUnits: 1000,
    rateLimitNotes: "burst 100 rpm",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.cachedInputPricePerMillion, 0.125);
  assert.equal(result.value.imagePrice, 0.02);
  assert.equal(result.value.audioInputPricePerMillion, 2.5);
  assert.equal(result.value.audioOutputPricePerMillion, 10);
  assert.equal(result.value.requestPrice, 0.0001);
  assert.equal(result.value.minUnits, 1000);
  assert.equal(result.value.rateLimitNotes, "burst 100 rpm");
});

test("HTTP_METHODS contains exactly the 5 enum values from 001_init.sql", () => {
  assert.deepEqual([...HTTP_METHODS].sort(), ["DELETE", "GET", "PATCH", "POST", "PUT"]);
});
