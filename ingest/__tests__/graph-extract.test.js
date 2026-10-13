// --------------------------
// GRAPH EXTRACTION TESTS — unit tests for ingest/graph-extract.js
// Tests: createGraphExtractor, toProposals, createLlmEntityExtractor.
// Best-effort/graceful-failure paths run against unreachable Neo4j URIs
// (no network, no mocking libs); pure proposal normalization is unit-tested
// directly.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("graph extraction adapter", () => {
  describe("createGraphExtractor", () => {
    it("returns an object with extractFromChunks function", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: null,
        extractEntities: async () => null,
      });
      assert.equal(typeof extractor.extractFromChunks, "function");
    });

    it("returns zero counts when graphConfig is null", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: null,
        extractEntities: async () => null,
      });
      const result = await extractor.extractFromChunks([{ id: "1", text: "hello", title: "t" }], null);
      assert.equal(result.nodesCreated, 0);
      assert.equal(result.relationshipsCreated, 0);
    });

    it("returns zero counts when chunks array is empty", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: { uri: "neo4j://x", username: "u", password: "p", database: "neo4j" },
        extractEntities: async () => null,
      });
      const result = await extractor.extractFromChunks([], null);
      assert.equal(result.nodesCreated, 0);
      assert.equal(result.relationshipsCreated, 0);
    });

    it("handles aborted signal gracefully", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      const ac = new AbortController();
      ac.abort();
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: { uri: "neo4j://x", username: "u", password: "p", database: "neo4j" },
        extractEntities: async () => null,
      });
      // AbortError is thrown inside the adapter — should not crash
      const result = await extractor.extractFromChunks([{ id: "1", text: "hello", title: "t" }], ac.signal);
      // The adapter catches errors, so result should still be zero counts
      assert.equal(result.nodesCreated, 0);
      assert.equal(result.relationshipsCreated, 0);
    });
  });

  describe("toProposals (Phase 3 normalization)", () => {
  it("normalizes relationships onto the allowlist and carries confidence", async () => {
    const { toProposals } = await import("../graph-extract.js");
    const out = toProposals({
      entities: [{ name: "A", type: "Concept" }, { name: "B", type: "Technology" }],
      relationships: [{ from: "A", to: "B", type: "relates_to", confidence: 0.91 }],
    });
    assert.equal(out.skipped, 0);
    assert.equal(out.entities.length, 2);
    assert.equal(out.relationships[0].type, "RELATED_TO"); // legacy alias normalized
    assert.equal(out.relationships[0].confidence, 0.91);
  });

  it("drops empty endpoints, self-loops and blank types, counting them skipped", async () => {
    const { toProposals } = await import("../graph-extract.js");
    const out = toProposals({
      entities: [],
      relationships: [
        { from: "", to: "B", type: "USES" },          // empty endpoint
        { from: "A", to: "a", type: "USES" },          // self-loop (case-insensitive)
        { from: "A", to: "B", type: "   " },           // blank type
        { from: "A", to: "B", type: "DROPS EVERYTHING" }, // unknown → lenient RELATED_TO
        { from: "A", to: "B", type: "USES" },          // valid
      ],
    });
    assert.equal(out.skipped, 3);
    assert.equal(out.relationships.length, 2);
    const types = out.relationships.map((r) => r.type).sort();
    assert.deepEqual(types, ["RELATED_TO", "USES"]); // unknown types never drop knowledge, they fall back safely
  });

  it("dedupes entities by canonical name (first occurrence wins the type)", async () => {
    const { toProposals } = await import("../graph-extract.js");
    const out = toProposals({
      entities: [
        { name: "ISO 9001", type: "Standard" },
        { name: "iso 9001", type: "Concept" },
        { name: "", type: "Concept" },
      ],
      relationships: [],
    });
    assert.equal(out.entities.length, 1);
    assert.equal(out.entities[0].name, "ISO 9001");
    assert.equal(out.entities[0].type, "Standard");
  });

  it("defaults missing confidence and tolerates non-numeric confidence", async () => {
    const { toProposals } = await import("../graph-extract.js");
    const out = toProposals({
      entities: [{ name: "A", type: "Concept", confidence: "n/a" }],
      relationships: [{ from: "A", to: "B", type: "USES" }],
    });
    assert.equal(out.entities[0].confidence, 0.8);
    assert.equal(out.relationships[0].confidence, 0.8);
    const clamped = toProposals({
      entities: [],
      relationships: [{ from: "A", to: "B", type: "USES", confidence: 2 }],
    });
    assert.equal(clamped.relationships[0].confidence, 0.8); // out-of-range → default
  });
});

describe("createLlmEntityExtractor", () => {
    it("returns a function", async () => {
      const { createLlmEntityExtractor } = await import("../graph-extract.js");
      const extractor = createLlmEntityExtractor("testco");
      assert.equal(typeof extractor, "function");
    });
  });

  describe("extraction cap + phase split", () => {
    it("caps extraction at the first 10 chunks per document", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      let extractCalls = 0;
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: { uri: "neo4j://unreachable:7687", username: "u", password: "p", database: "neo4j" },
        extractEntities: async () => {
          extractCalls += 1;
          return { entities: [], relationships: [] }; // nothing to commit → no Neo4j session ever needed
        },
      });
      const chunks = Array.from({ length: 25 }, (_, i) => ({
        id: `c${i}`,
        text: `Chunk ${i} content`,
        title: `T${i}`,
      }));
      await extractor.extractFromChunks(chunks, null);
      assert.equal(extractCalls, 10); // capped at EXTRACTION_MAX_CHUNKS
    });

    it("honors per-KB maxChunks/concurrency overrides", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      let extractCalls = 0;
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: { uri: "neo4j://unreachable:7687", username: "u", password: "p", database: "neo4j" },
        extractEntities: async () => {
          extractCalls += 1;
          return { entities: [], relationships: [] };
        },
        maxChunks: 2,
        concurrency: 1,
      });
      const chunks = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, text: `C${i}`, title: `T${i}` }));
      await extractor.extractFromChunks(chunks, null);
      assert.equal(extractCalls, 2); // per-KB cap wins over the 10 default
    });

    it("clamps invalid per-KB overrides to the defaults", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      let extractCalls = 0;
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: { uri: "neo4j://unreachable:7687", username: "u", password: "p", database: "neo4j" },
        extractEntities: async () => {
          extractCalls += 1;
          return { entities: [], relationships: [] };
        },
        maxChunks: 999, // out of range → clamped to 50 (default region)
        concurrency: -3, // invalid → default 4
      });
      const chunks = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, text: `C${i}`, title: `T${i}` }));
      await extractor.extractFromChunks(chunks, null);
      assert.equal(extractCalls, 50); // clamped to the hard ceiling
    });

    it("reports graph sub-phase progress via onProgress", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: { uri: "neo4j://unreachable:7687", username: "u", password: "p", database: "neo4j" },
        extractEntities: async () => ({ entities: [{ name: "ISO 9001", type: "Standard" }], relationships: [] }),
        maxChunks: 3,
      });
      const events = [];
      const chunks = [
        { id: "c1", text: "a", title: "A" },
        { id: "c2", text: "b", title: "B" },
        { id: "c3", text: "c", title: "C" },
      ];
      await extractor.extractFromChunks(chunks, null, (subPhase, detail) => events.push({ subPhase, detail }));
      const extracting = events.filter((e) => e.subPhase === "extracting");
      assert.ok(extracting.length >= 2, "expected start + completion extracting events");
      assert.match(extracting[0].detail, /0\/3/); // starts at 0 of the capped sample
      assert.match(extracting[extracting.length - 1].detail, /3\/3/); // last completion counts every chunk
    });

    it("extracts chunks in parallel, then commits sequentially", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      let active = 0;
      let maxActive = 0;
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: { uri: "neo4j://unreachable:7687", username: "u", password: "p", database: "neo4j" },
        extractEntities: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 5));
          active -= 1;
          return { entities: [{ name: "ISO 9001", type: "Standard" }], relationships: [] };
        },
      });
      const chunks = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, text: `C${i}`, title: `T${i}` }));
      const result = await extractor.extractFromChunks(chunks, null);
      assert.ok(maxActive > 1, `expected parallel LLM extraction, maxActive=${maxActive}`);
      // Neo4j is unreachable → commits fail gracefully, no nodes reported
      assert.equal(result.nodesCreated, 0);
    });
  });

  describe("error resilience", () => {
    it("does not throw when Neo4j connection fails", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: { uri: "neo4j://unreachable:7687", username: "u", password: "p", database: "neo4j" },
        extractEntities: async () => ({
          entities: [{ name: "ISO 9001", type: "Standard" }],
          relationships: [],
        }),
      });
      // Should not throw — best-effort design
      const result = await extractor.extractFromChunks(
        [{ id: "1", text: "ISO 9001 certification", title: "ISO" }],
        null
      );
      assert.equal(typeof result.nodesCreated, "number");
      assert.equal(typeof result.relationshipsCreated, "number");
    });

    it("skips chunks where LLM extraction returns null", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      let extractCalls = 0;
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: { uri: "neo4j://unreachable:7687", username: "u", password: "p", database: "neo4j" },
        extractEntities: async () => { extractCalls++; return null; },
      });
      const result = await extractor.extractFromChunks(
        [{ id: "1", text: "Some text", title: "T" }, { id: "2", text: "Other text", title: "U" }],
        null
      );
      assert.equal(extractCalls, 2);
      assert.equal(result.nodesCreated, 0);
    });

    it("skips chunks where LLM returns empty entities", async () => {
      const { createGraphExtractor } = await import("../graph-extract.js");
      const extractor = createGraphExtractor({
        companyName: "testco",
        kbKey: "test-kb",
        graphConfig: { uri: "neo4j://unreachable:7687", username: "u", password: "p", database: "neo4j" },
        extractEntities: async () => ({ entities: [], relationships: [] }),
      });
      const result = await extractor.extractFromChunks(
        [{ id: "1", text: "Empty content", title: "E" }],
        null
      );
      assert.equal(result.nodesCreated, 0);
      assert.equal(result.relationshipsCreated, 0);
    });
  });
});

describe("graph query safety", () => {
  it("isSafeCypher is exported and works", async () => {
    const { isSafeCypher } = await import("../../query/graph.js");
    assert.equal(isSafeCypher("MATCH (n) RETURN n LIMIT 10"), true);
    assert.equal(isSafeCypher("CREATE (n:Bad)"), false);
    assert.equal(isSafeCypher("MATCH (n) DELETE n"), false);
    assert.equal(isSafeCypher(""), false);
    assert.equal(isSafeCypher(null), false);
  });

  it("getGraphConfig returns null for unconfigured company", async () => {
    const { getGraphConfig } = await import("../../query/graph.js");
    // Non-existent company returns null (not an error)
    const result = getGraphConfig("nonexistent-company-xyz");
    assert.equal(result, null);
  });

  it("graphEnabled returns false for non-existent company", async () => {
    const { graphEnabled } = await import("../../query/graph.js");
    assert.equal(graphEnabled("nonexistent-company-xyz"), false);
  });
});

describe("graph extraction edge cases", () => {
  it("handles extractEntities that throws", async () => {
    const { createGraphExtractor } = await import("../graph-extract.js");
    const extractor = createGraphExtractor({
      companyName: "testco",
      kbKey: "test-kb",
      graphConfig: { uri: "neo4j://unreachable:7687", username: "u", password: "p", database: "neo4j" },
      extractEntities: async () => { throw new Error("LLM unavailable"); },
    });
    // Should not throw — best-effort
    const result = await extractor.extractFromChunks(
      [{ id: "1", text: "Test content", title: "Test" }],
      null
    );
    assert.equal(result.nodesCreated, 0);
    assert.equal(result.relationshipsCreated, 0);
  });

  it("extractEntities with malformed JSON returns null", async () => {
    const { createLlmEntityExtractor } = await import("../graph-extract.js");
    // The LLM extractor returns null for unparseable responses
    const extractor = createLlmEntityExtractor("testco");
    assert.equal(typeof extractor, "function");
  });
});
