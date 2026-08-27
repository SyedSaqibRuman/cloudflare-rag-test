// --------------------------
// Provider model fetcher — pure normalization tests (no DB, no network)
// --------------------------
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeModels } from "../services/provider-model-fetcher.js";

test("normalizeModels maps OpenAI /models shape to catalog rows", () => {
  const rows = normalizeModels(
    [
      { id: "gpt-4o", object: "model", owned_by: "openai" },
      { id: "text-embedding-3-small", owned_by: "openai" },
    ],
    "chat"
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].modelKey, "gpt-4o");
  assert.equal(rows[0].modelName, "gpt-4o");
  assert.equal(rows[0].modelFamily, "openai");
  assert.equal(rows[0].category, "chat");
});

test("normalizeModels drops rows without any key (id/model_key/name)", () => {
  assert.deepEqual(normalizeModels([{ display_name: "no-key" }], "chat"), []);
  assert.deepEqual(normalizeModels([], "chat"), []);
});

test("normalizeModels preserves capability flags and windows", () => {
  const rows = normalizeModels(
    [{ id: "model-x", supports_streaming: true, tools: true, context_window: 128000, max_output_tokens: 4096 }],
    "chat"
  );
  assert.equal(rows[0].supportsStreaming, true);
  assert.equal(rows[0].supportsFunctionCalling, true);
  assert.equal(rows[0].maxContextWindow, 128000);
  assert.equal(rows[0].maxOutputTokens, 4096);
});