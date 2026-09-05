// --------------------------
// MCP SERVER TESTS — unit tests for mcp/mcp-server.js (node builtins only).
// The core is stream-free, so the whole protocol surface is testable with an
// injected fake tool executor.
// --------------------------
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createMcpServer,
  mcpToolDefinitions,
  resolveMcpContext,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
} from "../mcp-server.js";
import { TOOL_NAMES } from "../../knowledge/index.js";

const noopExecute = async () => ({ ok: true });

describe("MCP handshake", () => {
  it("initialize returns protocol version, capabilities and server info", async () => {
    const { handleMessage } = createMcpServer({ executeTool: noopExecute });
    const [res] = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal(res.id, 1);
    assert.equal(res.result.protocolVersion, MCP_PROTOCOL_VERSION);
    assert.deepEqual(res.result.capabilities, { tools: {} });
    assert.equal(res.result.serverInfo.name, MCP_SERVER_NAME);
  });

  it("notifications get no response", async () => {
    const { handleMessage } = createMcpServer({ executeTool: noopExecute });
    const out = await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.deepEqual(out, []);
  });

  it("ping returns an empty result", async () => {
    const { handleMessage } = createMcpServer({ executeTool: noopExecute });
    const [res] = await handleMessage({ jsonrpc: "2.0", id: 7, method: "ping" });
    assert.deepEqual(res.result, {});
  });
});

describe("tools/list", () => {
  it("exposes every knowledge tool with name, description and inputSchema", async () => {
    const { handleMessage } = createMcpServer({ executeTool: noopExecute });
    const [res] = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = res.result.tools;
    assert.equal(tools.length, TOOL_NAMES.size);
    for (const t of tools) {
      assert.ok(t.name);
      assert.ok(t.description);
      assert.ok(t.inputSchema?.properties);
      assert.ok(TOOL_NAMES.has(t.name), `registered tool ${t.name}`);
    }
  });

  it("mcpToolDefinitions matches the backend registry 1:1", () => {
    const defs = mcpToolDefinitions();
    const names = defs.map((d) => d.name).sort();
    assert.deepEqual(names, [...TOOL_NAMES].sort());
  });
});

describe("tools/call", () => {
  it("routes to the executor with company from args and AI (propose) actor by default", async () => {
    let captured;
    const executeTool = async (name, args, ctx) => {
      captured = { name, args, ctx };
      return { ok: true };
    };
    const { handleMessage } = createMcpServer({ executeTool });
    const [res] = await handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "search_knowledge", arguments: { query: "ISO", company: "acme", kbKey: "kb1" } },
    });
    assert.equal(res.id, 5);
    assert.equal(res.result.isError, false);
    assert.equal(captured.name, "search_knowledge");
    assert.deepEqual(captured.args, { query: "ISO" }); // meta keys stripped
    assert.equal(captured.ctx.companyName, "acme");
    assert.equal(captured.ctx.kbKey, "kb1");
    assert.deepEqual(captured.ctx.actor, { type: "ai", id: "mcp" });
  });

  it("falls back to env MCP_COMPANY / MCP_KB_KEY", async () => {
    let captured;
    const executeTool = async (name, args, ctx) => {
      captured = ctx;
      return { ok: true };
    };
    const { handleMessage } = createMcpServer({ executeTool, env: { MCP_COMPANY: "envco", MCP_KB_KEY: "envkb" } });
    await handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "get_claims", arguments: {} },
    });
    assert.equal(captured.companyName, "envco");
    assert.equal(captured.kbKey, "envkb");
  });

  it("MCP_TRUSTED=true switches the actor to trusted api (commits)", async () => {
    let captured;
    const executeTool = async (name, args, ctx) => {
      captured = ctx;
      return { ok: true };
    };
    const { handleMessage } = createMcpServer({ executeTool, env: { MCP_TRUSTED: "true", MCP_COMPANY: "acme" } });
    await handleMessage({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "propose_claim", arguments: { subject: "A", predicate: "USES", object: "B" } },
    });
    assert.deepEqual(captured.actor, { type: "api", id: "mcp" });
    assert.equal(captured.policyAllow, false); // trust flows through the actor type
  });

  it("returns isError for unknown tools without failing the protocol", async () => {
    const { handleMessage } = createMcpServer({ executeTool: noopExecute });
    const [res] = await handleMessage({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "drop_everything", arguments: {} },
    });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /Unknown tool/);
  });

  it("returns isError with guidance when no company context resolves", async () => {
    const { handleMessage } = createMcpServer({ executeTool: noopExecute, env: {} });
    const [res] = await handleMessage({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "search_knowledge", arguments: { query: "ISO" } },
    });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /MCP_COMPANY/);
  });

  it("surfaces executor failures as isError results", async () => {
    const executeTool = async () => {
      throw new Error("Neo4j knowledge graph is not configured.");
    };
    const { handleMessage } = createMcpServer({ executeTool });
    const [res] = await handleMessage({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "search_knowledge", arguments: { query: "ISO", company: "acme" } },
    });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /not configured/);
  });
});

describe("protocol errors", () => {
  it("rejects non-object messages", async () => {
    const { handleMessage } = createMcpServer({ executeTool: noopExecute });
    const [res] = await handleMessage(null);
    assert.equal(res.error.code, -32600);
    const [res2] = await handleMessage("nope");
    assert.equal(res2.error.code, -32600);
  });

  it("rejects unknown methods", async () => {
    const { handleMessage } = createMcpServer({ executeTool: noopExecute });
    const [res] = await handleMessage({ jsonrpc: "2.0", id: 3, method: "resources/list" });
    assert.equal(res.error.code, -32601);
  });

  it("rejects tools/call without a name", async () => {
    const { handleMessage } = createMcpServer({ executeTool: noopExecute });
    const [res] = await handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: {} });
    assert.equal(res.error.code, -32602);
  });
});

describe("resolveMcpContext", () => {
  it("prioritizes args over env and strips meta keys", () => {
    const ctx = resolveMcpContext(
      { query: "x", company: "acme", kbKey: "kb1" },
      { MCP_COMPANY: "envco", MCP_KB_KEY: "envkb" }
    );
    assert.equal(ctx.companyName, "acme");
    assert.equal(ctx.kbKey, "kb1");
    assert.deepEqual(ctx.args, { query: "x" });
    assert.deepEqual(ctx.actor, { type: "ai", id: "mcp" });
  });

  it("accepts companyName as an alias for company", () => {
    const ctx = resolveMcpContext({ companyName: "acme" }, {});
    assert.equal(ctx.companyName, "acme");
    assert.deepEqual(ctx.args, {});
  });

  it("returns nulls when nothing resolves and never trusts without the flag", () => {
    const ctx = resolveMcpContext({}, { MCP_TRUSTED: "false" });
    assert.equal(ctx.companyName, null);
    assert.equal(ctx.kbKey, null);
    assert.deepEqual(ctx.actor, { type: "ai", id: "mcp" });
  });
});