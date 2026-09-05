// --------------------------
// ADR-012 Cache Key Isolation Tests
// Verifies that the cache key includes the full retrieval binding fingerprint
// (embedding model, vector index, LLM model) so that changing any factor
// invalidates the cache and prevents serving stale answers from incompatible
// vector spaces or LLM models.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCacheKey } from "../cache.js";

describe("ADR-012 Cache Key Isolation", () => {
  describe("getCacheKey binding fingerprint", () => {
    it("produces different keys when embedding model changes", () => {
      const base = getCacheKey("what is ISO 9001?", "popularcert", "sarah", {
        embeddingModel: "@cf/baai/bge-base-en-v1.5",
        vectorIndex: "popularcert-index",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      });
      const changed = getCacheKey("what is ISO 9001?", "popularcert", "sarah", {
        embeddingModel: "@cf/baai/bge-large-en-v1.5",
        vectorIndex: "popularcert-index",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      });
      assert.notEqual(base, changed, "Different embedding models must produce different cache keys");
    });

    it("produces different keys when vector index changes", () => {
      const base = getCacheKey("what is ISO 9001?", "popularcert", "sarah", {
        embeddingModel: "@cf/baai/bge-base-en-v1.5",
        vectorIndex: "popularcert-index",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      });
      const changed = getCacheKey("what is ISO 9001?", "popularcert", "sarah", {
        embeddingModel: "@cf/baai/bge-base-en-v1.5",
        vectorIndex: "maxicert-index",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      });
      assert.notEqual(base, changed, "Different vector indexes must produce different cache keys");
    });

    it("produces different keys when LLM model changes", () => {
      const base = getCacheKey("what is ISO 9001?", "popularcert", "sarah", {
        embeddingModel: "@cf/baai/bge-base-en-v1.5",
        vectorIndex: "popularcert-index",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      });
      const changed = getCacheKey("what is ISO 9001?", "popularcert", "sarah", {
        embeddingModel: "@cf/baai/bge-base-en-v1.5",
        vectorIndex: "popularcert-index",
        llmModel: "@cf/meta/llama-3.3-70b-instruct-fp8",
      });
      assert.notEqual(base, changed, "Different LLM models must produce different cache keys");
    });

    it("produces same key when all bindings match", () => {
      const binding = {
        embeddingModel: "@cf/baai/bge-base-en-v1.5",
        vectorIndex: "popularcert-index",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      };
      const key1 = getCacheKey("what is ISO 9001?", "popularcert", "sarah", binding);
      const key2 = getCacheKey("what is ISO 9001?", "popularcert", "sarah", binding);
      assert.equal(key1, key2, "Same binding must produce same cache key");
    });

    it("produces different keys for different companies", () => {
      const binding = {
        embeddingModel: "@cf/baai/bge-base-en-v1.5",
        vectorIndex: "popularcert-index",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      };
      const key1 = getCacheKey("what is ISO 9001?", "popularcert", "sarah", binding);
      const key2 = getCacheKey("what is ISO 9001?", "maxicert", "sarah", binding);
      assert.notEqual(key1, key2, "Different companies must produce different cache keys");
    });

    it("produces different keys for different assistants", () => {
      const binding = {
        embeddingModel: "@cf/baai/bge-base-en-v1.5",
        vectorIndex: "popularcert-index",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      };
      const key1 = getCacheKey("what is ISO 9001?", "popularcert", "sarah", binding);
      const key2 = getCacheKey("what is ISO 9001?", "popularcert", "support-bot", binding);
      assert.notEqual(key1, key2, "Different assistants must produce different cache keys");
    });

    it("backward-compatible: works without binding parameter", () => {
      const key = getCacheKey("what is ISO 9001?", "popularcert", "sarah");
      assert.ok(key, "getCacheKey must work without binding parameter");
      assert.equal(key.length, 32, "Must return MD5 hex digest (32 chars)");
    });

    it("backward-compatible: empty binding produces valid key", () => {
      const key = getCacheKey("what is ISO 9001?", "popularcert", "sarah", {});
      assert.ok(key, "getCacheKey must work with empty binding object");
      assert.equal(key.length, 32, "Must return MD5 hex digest (32 chars)");
    });

    it("detects silent semantic corruption scenario from ADR-012", () => {
      // Scenario: Company ingests KB with bge-base-en-v1.5, then switches to
      // text-embedding-3-large. Without binding isolation, the same question
      // would return stale answers from the old vector space.
      const oldBinding = {
        embeddingModel: "@cf/baai/bge-base-en-v1.5",
        vectorIndex: "popularcert-index",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      };
      const newBinding = {
        embeddingModel: "@cf/openai/text-embedding-3-large",
        vectorIndex: "popularcert-index",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      };

      const oldKey = getCacheKey("ISO 9001 requirements", "popularcert", "sarah", oldBinding);
      const newKey = getCacheKey("ISO 9001 requirements", "popularcert", "sarah", newBinding);

      assert.notEqual(oldKey, newKey,
        "Switching embedding models must invalidate cache to prevent silent semantic corruption"
      );
    });

    it("detects index change scenario", () => {
      // Scenario: Admin re-creates the vector index with a different name
      const oldBinding = {
        embeddingModel: "@cf/baai/bge-base-en-v1.5",
        vectorIndex: "popularcert-index",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      };
      const newBinding = {
        embeddingModel: "@cf/baai/bge-base-en-v1.5",
        vectorIndex: "popularcert-index-v2",
        llmModel: "@cf/meta/llama-3.1-8b-instruct-fp8",
      };

      const oldKey = getCacheKey("ISO 9001 requirements", "popularcert", "sarah", oldBinding);
      const newKey = getCacheKey("ISO 9001 requirements", "popularcert", "sarah", newBinding);

      assert.notEqual(oldKey, newKey,
        "Changing vector index must invalidate cache"
      );
    });
  });
});
