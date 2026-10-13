// --------------------------
// STARTER SUGGESTIONS TESTS — pure-ESM tests for query/suggestions.js.
// Locks the KB-grounded prompt contract (content framing, never "company
// services") and the reply parser. The retrieval/LLM wiring is verified live
// (bazaarlink-backed generation through the assistant's execution binding).
// --------------------------
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TEST_DIR = mkdtempSync(path.join(tmpdir(), "suggestions-"));
process.chdir(TEST_DIR);
process.env.CONFIG_STORE = "sqlite";

const { buildStarterPrompt, parseStarterQuestions, generateStarterQuestions } = await import(
  "../suggestions.js"
);
const { closePool } = await import("../../mysql/pool.js");

after(async () => {
  await closePool();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("buildStarterPrompt", () => {
  it("frames questions around the CONTENT, not company services", () => {
    const prompt = buildStarterPrompt("Python is a programming language. IPython is interactive.");
    assert.match(prompt, /content below/i);
    assert.match(prompt, /reader of THIS content/i);
    assert.match(prompt, /answerable from the content/i);
    // No company-services framing that produced off-KB certification questions.
    assert.doesNotMatch(prompt, /company|products|services|visitor/i);
    assert.match(prompt, /Python is a programming language/);
  });

  it("caps the content payload at 4000 chars", () => {
    const prompt = buildStarterPrompt("x".repeat(9000));
    const body = prompt.slice(prompt.indexOf("Content:"));
    assert.ok(body.length < 4200);
  });
});

describe("parseStarterQuestions", () => {
  it("parses numbered/bulleted lines and trims decorations", () => {
    assert.deepEqual(
      parseStarterQuestions("1. What is IPython?\n- Where are the tutorials?\n3) How do type annotations work?"),
      ["What is IPython?", "Where are the tutorials?", "How do type annotations work?"]
    );
  });

  it("caps at 4 questions and drops empties", () => {
    assert.deepEqual(
      parseStarterQuestions("a\n\nb\nc\nd\ne"),
      ["a", "b", "c", "d"]
    );
  });

  it("returns [] for empty input", () => {
    assert.deepEqual(parseStarterQuestions(""), []);
    assert.deepEqual(parseStarterQuestions(null), []);
  });
});

describe("generateStarterQuestions (best-effort contract)", () => {
  it("returns [] when the company has no usable KB — never throws", async () => {
    const questions = await generateStarterQuestions("no-such-kb-company");
    assert.deepEqual(questions, []);
  });
});
