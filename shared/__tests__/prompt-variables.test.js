import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROMPT_VARIABLE_KEY_RE,
  MAX_PROMPT_VARIABLES,
  normalizePromptVariables,
  mergePromptVariables,
  promptVariableMap,
  resolvePromptTemplate,
  collectPlaceholders,
} from "../prompt-variables.js";

describe("shared/prompt-variables", () => {
  describe("normalizePromptVariables", () => {
    it("trims keys, uppercases them, and stringifies values", () => {
      const out = normalizePromptVariables([{ key: "  brand_name ", value: "  Acme  " }]);
      assert.deepEqual(out, [{ key: "BRAND_NAME", value: "Acme" }]);
    });

    it("drops entries with a blank or invalid key", () => {
      const out = normalizePromptVariables([
        { key: "", value: "a" },
        { key: "   ", value: "b" },
        { key: "9BAD", value: "c" },
        { key: "has-dash", value: "d" },
        { key: "OK_KEY", value: "e" },
      ]);
      assert.deepEqual(out, [{ key: "OK_KEY", value: "e" }]);
    });

    it("coerces missing/null values to an empty string and keeps the key", () => {
      const out = normalizePromptVariables([{ key: "X" }, { key: "Y", value: null }]);
      assert.deepEqual(out, [
        { key: "X", value: "" },
        { key: "Y", value: "" },
      ]);
    });

    it("de-duplicates case-insensitively with last-write-wins", () => {
      const out = normalizePromptVariables([
        { key: "BRAND", value: "first" },
        { key: "brand", value: "second" },
      ]);
      assert.deepEqual(out, [{ key: "BRAND", value: "second" }]);
    });

    it("tolerates non-array / nullish input", () => {
      assert.deepEqual(normalizePromptVariables(null), []);
      assert.deepEqual(normalizePromptVariables(undefined), []);
      assert.deepEqual(normalizePromptVariables("nope"), []);
    });

    it(`caps at ${MAX_PROMPT_VARIABLES} entries`, () => {
      const many = Array.from({ length: MAX_PROMPT_VARIABLES + 5 }, (_, i) => ({
        key: `K${i}`,
        value: "v",
      }));
      assert.equal(normalizePromptVariables(many).length, MAX_PROMPT_VARIABLES);
    });
  });

  describe("mergePromptVariables", () => {
    it("lets assistant variables override company variables", () => {
      const merged = mergePromptVariables(
        [{ key: "BRAND", value: "Acme" }, { key: "CITY", value: "Berlin" }],
        [{ key: "BRAND", value: "Acme Recipes" }]
      );
      assert.deepEqual(merged, [
        { key: "BRAND", value: "Acme Recipes" },
        { key: "CITY", value: "Berlin" },
      ]);
    });

    it("keeps company variables when the assistant defines none", () => {
      const merged = mergePromptVariables([{ key: "A", value: "1" }], null);
      assert.deepEqual(merged, [{ key: "A", value: "1" }]);
    });
  });

  describe("promptVariableMap", () => {
    it("maps normalized pairs to an uppercase key→value object", () => {
      assert.deepEqual(promptVariableMap([{ key: "brand", value: "Acme" }]), { BRAND: "Acme" });
    });
  });

  describe("resolvePromptTemplate", () => {
    it("expands only the supplied custom variables", () => {
      const out = resolvePromptTemplate("Hi {{BRAND}}, reach us at {{PHONE}}", [
        { key: "BRAND", value: "Acme" },
        { key: "PHONE", value: "555-0100" },
      ]);
      assert.equal(out, "Hi Acme, reach us at 555-0100");
    });

    it("does NOT expand any implicit built-in name", () => {
      // Regression for "remove all builtin variables": these were silently
      // injected from company config / the clock and must now stay literal.
      const template = "{{CONSULTANT_NAME}}|{{COMPANY_NAME}}|{{BASE_URL}}|{{CURRENT_DATE}}|{{CURRENT_YEAR}}|{{ASSISTANT_NAME}}";
      const out = resolvePromptTemplate(template, []);
      assert.equal(
        out,
        "{{CONSULTANT_NAME}}|{{COMPANY_NAME}}|{{BASE_URL}}|{{CURRENT_DATE}}|{{CURRENT_YEAR}}|{{ASSISTANT_NAME}}"
      );
    });

    it("expands a custom variable that reuses a former built-in name", () => {
      const out = resolvePromptTemplate("Hello {{COMPANY_NAME}}", [
        { key: "COMPANY_NAME", value: "Acme" },
      ]);
      assert.equal(out, "Hello Acme");
    });

    it("leaves unknown placeholders untouched", () => {
      const out = resolvePromptTemplate("Hello {{MISSING}} and {{BRAND}}", [
        { key: "BRAND", value: "Acme" },
      ]);
      assert.equal(out, "Hello {{MISSING}} and Acme");
    });

    it("matches placeholders case-insensitively against custom keys", () => {
      const out = resolvePromptTemplate("Hello {{brand_name}}", [
        { key: "BRAND_NAME", value: "Acme" },
      ]);
      assert.equal(out, "Hello Acme");
    });

    it("replaces every occurrence and returns '' for an empty template", () => {
      assert.equal(resolvePromptTemplate("{{A}} {{A}}", [{ key: "A", value: "x" }]), "x x");
      assert.equal(resolvePromptTemplate(null, [{ key: "A", value: "x" }]), "");
    });
  });

  describe("collectPlaceholders", () => {
    it("lists the unique placeholders a template uses, uppercased", () => {
      const out = collectPlaceholders("{{brand}} and {{CITY}} and {{brand}}");
      assert.deepEqual(out, ["BRAND", "CITY"]);
    });

    it("returns [] for a template with no placeholders", () => {
      assert.deepEqual(collectPlaceholders("no placeholders"), []);
    });
  });

  describe("PROMPT_VARIABLE_KEY_RE", () => {
    it("accepts uppercase identifiers and rejects anything else", () => {
      assert.ok(PROMPT_VARIABLE_KEY_RE.test("BRAND"));
      assert.ok(PROMPT_VARIABLE_KEY_RE.test("A_1"));
      assert.ok(!PROMPT_VARIABLE_KEY_RE.test("brand"));
      assert.ok(!PROMPT_VARIABLE_KEY_RE.test("1BRAND"));
      assert.ok(!PROMPT_VARIABLE_KEY_RE.test("BRAND-NAME"));
      assert.ok(!PROMPT_VARIABLE_KEY_RE.test(""));
    });
  });
});