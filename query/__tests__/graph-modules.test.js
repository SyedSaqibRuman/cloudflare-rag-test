// --------------------------
// GRAPH RAG TESTS — pure logic only (config resolution + Cypher safety gate).
// The driver/network paths (fetchGraphSchema, runCypher, retrieveGraphContext)
// are integration concerns; these tests pin the security-critical parts.
// --------------------------
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The config layer resolves its SQLite dir (db/) from process.cwd() at import
// time — point it at an isolated temp dir BEFORE importing config or graph.
// node --test runs each test file in its own process, so this can't leak.
const TEST_DIR = mkdtempSync(path.join(tmpdir(), "graph-modules-"));
process.chdir(TEST_DIR);
process.env.CONFIG_STORE = "sqlite";

const { createCompany, updateCompany } = await import("../../config/index.js");
const { getGraphConfig, graphEnabled, isSafeCypher, matchesEntityMention, entityMentionRegex, formatGraphKnowledge } = await import("../graph.js");
await createCompany("graphco");

test("getGraphConfig returns null without a full Neo4j connection", () => {
  // Fresh company has no NEO4J_* keys.
  assert.equal(getGraphConfig("graphco"), null);
  assert.equal(graphEnabled("graphco"), false);
});

test("getGraphConfig resolves NEO4J_* with a neo4j default database", async () => {
  await updateCompany("graphco", {
    NEO4J_URI: "neo4j+s://abc.databases.neo4j.io",
    NEO4J_USERNAME: "29abc",
    NEO4J_PASSWORD: "pw",
  });
  assert.deepEqual(getGraphConfig("graphco"), {
    uri: "neo4j+s://abc.databases.neo4j.io",
    username: "29abc",
    password: "pw",
    database: "neo4j",
  });
  assert.equal(graphEnabled("graphco"), true);
});

test("getGraphConfig uses the configured database name", async () => {
  await updateCompany("graphco", { NEO4J_DATABASE: "29db" });
  assert.equal(getGraphConfig("graphco").database, "29db");
});

test("getGraphConfig database override wins over the stored NEO4J_DATABASE", async () => {
  await updateCompany("graphco", { NEO4J_DATABASE: "29db" });
  assert.equal(getGraphConfig("graphco", "assistant-db").database, "assistant-db");
});

test("getGraphConfig returns null when a required field is missing", async () => {
  await updateCompany("graphco", { NEO4J_URI: "", NEO4J_USERNAME: "", NEO4J_PASSWORD: "" });
  assert.equal(getGraphConfig("graphco"), null);
});

// --------------------------
// isSafeCypher — the read-only gate
// --------------------------

test("isSafeCypher accepts a read-only MATCH...RETURN query", () => {
  assert.equal(
    isSafeCypher('MATCH (n:Company) WHERE n.name CONTAINS $q RETURN n.name LIMIT 20'),
    true
  );
  assert.equal(
    isSafeCypher("MATCH (a)-[r:PARTNERS_WITH]->(b) RETURN a.name, b.name, r.since ORDER BY r.since LIMIT 20"),
    true
  );
});

test("isSafeCypher rejects destructive clauses", () => {
  for (const cypher of [
    "MATCH (n) DELETE n",
    "MATCH (n) DETACH DELETE n",
    "CREATE (n:Company {name:'x'})",
    "MATCH (n) SET n.name = 'x'",
    "MATCH (n) REMOVE n.name",
    "DROP INDEX idx",
    "FOREACH (x IN [1] | CREATE (:N))",
    "CALL db.labels()",
    "MATCH (n) LOAD CSV FROM 'x' AS row RETURN row",
  ]) {
    assert.equal(isSafeCypher(cypher), false, `should reject: ${cypher}`);
  }
});

test("isSafeCypher rejects non-query text and multiple statements", () => {
  assert.equal(isSafeCypher(""), false);
  assert.equal(isSafeCypher(null), false);
  assert.equal(isSafeCypher("MATCH (n) RETURN n; MATCH (m) RETURN m"), false);
  assert.equal(isSafeCypher("Just a sentence."), false);
});

test("isSafeCypher requires a read clause to start", () => {
  assert.equal(isSafeCypher("RETURN 1"), false); // must start with MATCH/UNWIND/OPTIONAL MATCH
  assert.equal(isSafeCypher("UNWIND [1,2] AS x RETURN x"), true);
});

// --------------------------
// Phase 4 — entity mention matching (pure, word-boundary aware)
// --------------------------

test("matchesEntityMention matches a canonical name inside a question", () => {
  assert.equal(matchesEntityMention("what is ISO 9001 certification?", "ISO 9001"), true);
  assert.equal(matchesEntityMention("What Is ISO 9001?", "ISO 9001"), true); // case-insensitive
  assert.equal(matchesEntityMention("tell me about PopularCert RAG", "PopularCert RAG"), true);
});

test("matchesEntityMention does not false-positive on substrings", () => {
  // "ISO" must not match inside "isolation"
  assert.equal(matchesEntityMention("what is the isolation level?", "ISO"), false);
  // "9001" must not match inside "19001"
  assert.equal(matchesEntityMention("the code 19001 means what?", "9001"), false);
});

test("entityMentionRegex returns null for blank terms", () => {
  assert.equal(entityMentionRegex(""), null);
  assert.equal(entityMentionRegex("   "), null);
});

// --------------------------
// Phase 4 — graph context formatting (pure)
// --------------------------

test("formatGraphKnowledge renders entities with typed edges and claims", () => {
  const out = formatGraphKnowledge({
    entities: [{ name: "ISO 9001", type: "Standard" }],
    relationships: [
      { entityName: "ISO 9001", otherName: "Quality Management System", type: "CERTIFIES", confidence: 0.92, evidence: [], direction: "out" },
      { entityName: "ISO 9001", otherName: "ISO 9001:2008", type: "SUPERSEDES", confidence: 0.95, evidence: [], direction: "in" },
    ],
    claims: [],
  });
  assert.ok(out.startsWith("[Graph Knowledge]"));
  assert.ok(out.includes("ISO 9001 (Standard)"));
  assert.ok(out.includes("→ CERTIFIES Quality Management System (0.92)"));
  assert.ok(out.includes("← SUPERSEDES ISO 9001:2008 (0.95)")); // direction arrow
});

test("formatGraphKnowledge dedupes edge + claim for the same triple", () => {
  const out = formatGraphKnowledge({
    entities: [{ name: "A", type: "Concept" }],
    relationships: [{ entityName: "A", otherName: "B", type: "USES", confidence: 0.9, evidence: [], direction: "out" }],
    claims: [{ entityName: "A", otherName: "B", predicate: "USES", confidence: 0.7, evidence: ["doc/chunk-1"], direction: "out" }],
  });
  // Same (predicate, direction, other) appears once — the higher confidence wins.
  assert.equal((out.match(/USES B/g) || []).length, 1);
  assert.ok(out.includes("(0.9)"));
  assert.ok(out.includes("doc/chunk-1")); // evidence of the kept item
});

test("formatGraphKnowledge returns null when nothing matches", () => {
  assert.equal(formatGraphKnowledge({ entities: [] }), null);
  assert.equal(
    formatGraphKnowledge({ entities: [{ name: "A", type: "Concept" }], relationships: [], claims: [] }),
    null
  );
});

test("formatGraphKnowledge respects the char budget", () => {
  const out = formatGraphKnowledge({
    entities: [{ name: "Long Entity Name", type: "Concept" }],
    relationships: [
      { entityName: "Long Entity Name", otherName: "Target One", type: "RELATED_TO", confidence: 0.9, evidence: [], direction: "out" },
      { entityName: "Long Entity Name", otherName: "Target Two", type: "RELATED_TO", confidence: 0.8, evidence: [], direction: "out" },
    ],
    claims: [],
    maxChars: 90,
  });
  assert.ok(out.length <= 90, `context exceeds budget (${out.length})`);
});

after(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});
