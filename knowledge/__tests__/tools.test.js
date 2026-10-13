// --------------------------
// KNOWLEDGE TOOLS TESTS — unit tests for knowledge/tools.js
// Pure parts (definitions, arg validation, policy tiers, dispatcher error
// paths) need no Neo4j. Session-based implementations are tested against a
// fake session (node builtins only, no node_modules needed for these).
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWLEDGE_TOOLS,
  TOOL_NAMES,
  validateToolArgs,
  resolveToolPolicy,
  executeKnowledgeTool,
} from "../index.js";
import { searchKnowledge, findDuplicates, validateClaimTool } from "../tools.js";

describe("tool registry integrity", () => {
  it("every definition has a name, description, parameters and access tier", () => {
    for (const t of KNOWLEDGE_TOOLS) {
      assert.ok(t.name, "name");
      assert.ok(t.description, `description for ${t.name}`);
      // OpenAI/Workers AI shape: parameters live under function.parameters.
      assert.ok(t.function?.parameters?.properties, `parameters for ${t.name}`);
      assert.ok(t.access === "read" || t.access === "write", `access for ${t.name}`);
      assert.ok(TOOL_NAMES.has(t.name), `TOOL_NAMES includes ${t.name}`);
    }
  });

  it("every registered tool is usable by an admin actor", () => {
    for (const name of TOOL_NAMES) {
      const p = resolveToolPolicy(name, { actor: { type: "admin" } });
      assert.notEqual(p.allowed, "denied", `${name} should be allowed for admin`);
    }
  });
});

describe("validateToolArgs", () => {
  it("requires declared fields", () => {
    const bad = validateToolArgs("propose_claim", { kbKey: "kb1", predicate: "USES" });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.subject && bad.errors.object);
  });

  it("rejects non-allowlisted predicates for claim tools (no raw LLM types)", () => {
    const bad = validateToolArgs("propose_claim", {
      kbKey: "kb1", subject: "A", predicate: "MATCH (n) DELETE", object: "B",
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.predicate);
    const good = validateToolArgs("propose_claim", {
      kbKey: "kb1", subject: "A", predicate: "relates_to", object: "B",
    });
    assert.equal(good.ok, true);
    assert.equal(good.value.predicate, "RELATED_TO"); // legacy alias normalized
  });

  it("validates confidence range and clamps limits", () => {
    const bad = validateToolArgs("validate_claim", {
      subject: "A", predicate: "USES", object: "B", confidence: 2,
    });
    assert.equal(bad.ok, false);
    const good = validateToolArgs("validate_claim", {
      subject: "A", predicate: "USES", object: "B", limit: 5000,
    });
    assert.equal(good.ok, true);
    assert.equal(good.value.limit, 100); // clamped to MAX_LIMIT
  });

  it("rejects unknown tools", () => {
    assert.equal(validateToolArgs("drop_everything").ok, false);
  });
});

describe("resolveToolPolicy (proposal §20)", () => {
  it("read tools are automatic for tenant actors", () => {
    assert.equal(resolveToolPolicy("search_knowledge", { actor: { companyKey: "acme" } }).allowed, "read");
    assert.equal(resolveToolPolicy("get_entity", { actor: { type: "admin" } }).allowed, "read");
  });

  it("read tools are denied without a tenant actor", () => {
    assert.equal(resolveToolPolicy("search_knowledge", { actor: {} }).allowed, "denied");
  });

  it("trusted actors commit write tools", () => {
    for (const type of ["admin", "api", "migration"]) {
      assert.equal(resolveToolPolicy("propose_claim", { actor: { type } }).allowed, "commit", type);
    }
  });

  it("AI actors can only propose write tools", () => {
    const p = resolveToolPolicy("propose_claim", { actor: { type: "llm" } });
    assert.equal(p.allowed, "propose");
    const p2 = resolveToolPolicy("propose_relationship", { actor: { type: "ai" } });
    assert.equal(p2.allowed, "propose");
  });

  it("unknown actors cannot write, but an explicit policy grant commits", () => {
    assert.equal(resolveToolPolicy("propose_claim", { actor: { type: "service-token" } }).allowed, "denied");
    assert.equal(
      resolveToolPolicy("propose_claim", { actor: { type: "service-token" }, policyAllow: true }).allowed,
      "commit"
    );
  });
});

describe("executeKnowledgeTool — error paths (no Neo4j needed)", () => {
  it("rejects unknown tools", async () => {
    await assert.rejects(
      executeKnowledgeTool("drop_everything", {}, { companyName: "acme", actor: { type: "admin" } }),
      (err) => err.code === "UNKNOWN_TOOL" && err.status === 400
    );
  });

  it("requires a company (tenant)", async () => {
    await assert.rejects(
      executeKnowledgeTool("search_knowledge", { query: "x" }, { actor: { type: "admin" } }),
      (err) => err.code === "TENANT_REQUIRED"
    );
  });

  it("rejects invalid arguments before touching the graph", async () => {
    await assert.rejects(
      executeKnowledgeTool("propose_claim", { kbKey: "kb", subject: "A", object: "B" }, { companyName: "acme", actor: { type: "admin" } }),
      (err) => err.code === "INVALID_TOOL_ARGS"
    );
  });

  it("denies write tools to non-trusted actors", async () => {
    await assert.rejects(
      executeKnowledgeTool("propose_claim", { kbKey: "kb", subject: "A", predicate: "USES", object: "B" }, { companyName: "acme", actor: { type: "service-token" } }),
      (err) => err.code === "TOOL_POLICY_DENIED" && err.status === 403
    );
  });

  it("throws a clear error when the graph is not configured", async () => {
    await assert.rejects(
      executeKnowledgeTool("search_knowledge", { query: "ISO" }, { companyName: "acme", actor: { type: "admin" } }),
      (err) => err.code === "GRAPH_NOT_CONFIGURED"
    );
  });
});

// ---------------------------------------------------------------------------
// Session-based implementations against a fake session
// ---------------------------------------------------------------------------

function fakeSession(rowsByCypherContains) {
  return {
    calls: [],
    async run(cypher, params) {
      this.calls.push({ cypher, params });
      const key = Object.keys(rowsByCypherContains).find((k) => cypher.includes(k)) || "";
      const rows = rowsByCypherContains[key] || [];
      return { records: rows };
    },
  };
}

function row(entries) {
  const keys = Object.keys(entries);
  return { keys, get: (k) => entries[k] };
}

describe("session-based tool implementations (fake session)", () => {
  it("searchKnowledge filters by company (+kb) and returns entity summaries", async () => {
    const session = fakeSession({
      "CONTAINS toLower($q)": [
        row({ id: "ent_1", name: "ISO 9001", type: "Standard", kbKey: "kb1", confidence: 0.9, relationshipCount: 3 }),
      ],
    });
    const out = await searchKnowledge(session, { companyName: "acme", query: "ISO", kbKey: "kb1" });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "ISO 9001");
    assert.equal(out[0].relationshipCount, 3);
    const call = session.calls[0];
    assert.equal(call.params.company, "acme");
    assert.equal(call.params.kb, "kb1"); // kb-scoped
    assert.ok(call.cypher.includes("e.company = $company"));
  });

  it("findDuplicates returns same-name entity pairs", async () => {
    const session = fakeSession({
      "toLower(a.name) = toLower(b.name)": [
        row({ name: "ISO 9001", keepId: "ent_1", dropId: "ent_2", createdAt: null, duplicateCreatedAt: null }),
      ],
    });
    const out = await findDuplicates(session, { companyName: "acme", kbKey: "kb1" });
    assert.equal(out.length, 1);
    assert.equal(out[0].keepId, "ent_1");
    assert.equal(out[0].dropId, "ent_2");
  });

  it("validateClaimTool validates purely when no kbKey is provided", async () => {
    const session = fakeSession({});
    const out = await validateClaimTool(session, { subject: "A", predicate: "USES", object: "B", confidence: 0.9 });
    assert.equal(out.valid, true);
    assert.deepEqual(out.duplicates, []);
    assert.deepEqual(out.conflicts, []);
    assert.equal(session.calls.length, 0); // no graph queries when kbKey absent
  });
});