// --------------------------
// Tests for the vector-store provider metadata module — pure ESM, no
// node_modules, runnable under bare node --test (same as serves-models.test.js).
// Locks the portal/server contract: LIVE_VECTOR_PROVIDERS mirrors the router's
// VECTOR_PROVIDERS, and vectorNameError enforces the same regexes the server's
// validateName does (shared/patterns.js).
// --------------------------
import test from "node:test";
import assert from "node:assert/strict";
import {
  VECTOR_PROVIDER_META,
  LIVE_VECTOR_PROVIDERS,
  managesVectorResources,
  vectorNameError,
} from "../vector-providers.js";
import { VECTOR_RESOURCE_NAME_RES } from "../../../../../shared/patterns.js";

test("every live vector provider has complete metadata", () => {
  for (const key of LIVE_VECTOR_PROVIDERS) {
    const meta = VECTOR_PROVIDER_META[key];
    assert.ok(meta, `${key} has metadata`);
    for (const field of ["label", "singular", "createLabel", "namePlaceholder", "nameHint", "empty"]) {
      assert.ok(meta[field], `${key}.${field} is set`);
    }
    assert.ok(Array.isArray(meta.columns) && meta.columns.length > 0, `${key}.columns is non-empty`);
    for (const [colKey, label] of meta.columns) {
      assert.ok(colKey && label, `${key} column entry is a [key, label] pair`);
    }
    for (const f of meta.configFields || []) {
      assert.ok(f.key && f.label, `${key} config field has key + label`);
    }
  }
});

test("LIVE_VECTOR_PROVIDERS matches the server router's provider list", () => {
  assert.deepEqual(LIVE_VECTOR_PROVIDERS.sort(), ["pinecone", "qdrant", "weaviate"].sort());
});

test("managesVectorResources gates exactly the live providers", () => {
  for (const key of LIVE_VECTOR_PROVIDERS) {
    assert.equal(managesVectorResources(key), true, `${key} is managed`);
  }
  assert.equal(managesVectorResources("cloudflare"), false);
  assert.equal(managesVectorResources("cloudflare_vectorize"), false);
  assert.equal(managesVectorResources("openai"), false);
  assert.equal(managesVectorResources(""), false);
  assert.equal(managesVectorResources(undefined), false);
});

test("vectorNameError enforces the shared per-provider regexes", () => {
  // Valid names for each provider — no error.
  assert.equal(vectorNameError("pinecone", "acme-embeddings"), undefined);
  assert.equal(vectorNameError("qdrant", "acme-embeddings"), undefined);
  assert.equal(vectorNameError("weaviate", "AcmeKbVectors"), undefined);

  // Invalid names — the provider's nameHint is returned.
  assert.ok(vectorNameError("pinecone", "Acme-Embeddings"), "pinecone rejects uppercase");
  assert.ok(vectorNameError("pinecone", "-starts-with-dash"), "pinecone rejects leading dash");
  assert.ok(vectorNameError("qdrant", "a"), "qdrant rejects single-char names");
  assert.ok(vectorNameError("weaviate", "acme_vectors"), "weaviate rejects lowercase classes");

  // Empty names are not a *format* error (the form's required check handles that).
  assert.equal(vectorNameError("pinecone", ""), undefined);

  // Unknown provider → no validation (the router 400s instead).
  assert.equal(vectorNameError("openai", "whatever"), undefined);
});

test("metadata name regexes stay in sync with shared/patterns.js", () => {
  for (const key of LIVE_VECTOR_PROVIDERS) {
    assert.ok(VECTOR_RESOURCE_NAME_RES[key], `shared/patterns.js has a regex for ${key}`);
  }
});
