import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BUILT_IN_BLOCKED_PATTERN_LINES,
  escapeRegExp,
  parsePatternLine,
  parseBlockedPatterns,
  inspectBlockedPatterns,
  resolveBlockedPatterns,
} from "../blocked-patterns.js";

describe("shared/blocked-patterns", () => {
  describe("parsePatternLine", () => {
    it("treats plain text as an escaped case-insensitive literal", () => {
      const re = parsePatternLine("crypto");
      assert.ok(re instanceof RegExp);
      assert.ok(re.test("What is CRYPTOCURRENCY?"));
      // Dot in a literal must not act as a regex wildcard.
      const dot = parsePatternLine("a.b");
      assert.ok(!dot.test("axb"));
      assert.ok(dot.test("a.b"));
    });

    it("parses /delimited/ regex lines with i assumed", () => {
      const re = parsePatternLine("/write.*poem/i");
      assert.ok(re.test("please WRITE me a poem"));
      // Bare slashes without flags default to case-insensitive.
      assert.ok(parsePatternLine("/\\bsong\\b/").test("SONG"));
    });

    it("returns null for empty or invalid lines", () => {
      assert.equal(parsePatternLine(""), null);
      assert.equal(parsePatternLine("   "), null);
      assert.equal(parsePatternLine(null), null);
      assert.equal(parsePatternLine("/([unclosed/"), null);
    });

    it("rejects unsafe regex flags (g/s/m)", () => {
      const re = parsePatternLine("/movie/gs");
      assert.ok(re instanceof RegExp); // compiles with safe flags only
      assert.equal(re.flags.includes("g"), false);
      assert.equal(re.flags.includes("s"), false);
    });
  });

  describe("parseBlockedPatterns / inspectBlockedPatterns", () => {
    it("skips invalid lines best-effort", () => {
      const patterns = parseBlockedPatterns("crypto\n/([bad/\n\n/joke/i");
      assert.equal(patterns.length, 2);
    });

    it("accepts arrays and null", () => {
      assert.equal(parseBlockedPatterns(["crypto", "/x/i"]).length, 2);
      assert.deepEqual(parseBlockedPatterns(null), []);
    });

    it("inspect reports the first invalid line", () => {
      const info = inspectBlockedPatterns("crypto\n/([bad/\n/joke/i");
      assert.equal(info.total, 3);
      assert.equal(info.valid, 2);
      assert.equal(info.firstInvalid, "/([bad/");
      assert.equal(inspectBlockedPatterns(null).total, 0);
    });
  });

  describe("resolveBlockedPatterns", () => {
    it("assistant tier wins over company tier", () => {
      const patterns = resolveBlockedPatterns("/assistant-pattern/", "/company-pattern/");
      assert.equal(patterns.length, 1);
      assert.ok(patterns[0].test("assistant-pattern"));
      assert.ok(!patterns[0].test("company-pattern"));
    });

    it("company tier wins over built-ins", () => {
      const patterns = resolveBlockedPatterns(null, "/company-pattern/");
      assert.equal(patterns.length, 1);
      assert.ok(patterns[0].test("company-pattern"));
    });

    it("falls back to the built-ins when both overrides are empty", () => {
      const patterns = resolveBlockedPatterns(null, null);
      assert.ok(patterns.length >= BUILT_IN_BLOCKED_PATTERN_LINES.length);
      // The old hardcoded BLOCKED_PATTERNS behavior is preserved.
      assert.ok(patterns.some((p) => p.test("give me a recipe")));
      assert.ok(patterns.some((p) => p.test("what movie should I watch?")));
      assert.ok(!patterns.some((p) => p.test("what is ISO 9001?")));
    });

    it("blank string overrides fall through to lower tiers", () => {
      const patterns = resolveBlockedPatterns("   ", "/company-pattern/");
      assert.ok(patterns[0].test("company-pattern"));
    });

    it("escapeRegExp escapes regex metacharacters", () => {
      assert.equal(escapeRegExp("a.b*c"), String.raw`a\.b\*c`);
    });
  });
});
