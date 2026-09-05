// --------------------------
// POPULARCERT KNOWLEDGE — MCP SERVER CORE (proposal §26–§27)
// A minimal Model Context Protocol (stdio) server exposing the knowledge
// layer to external AI clients (Claude Desktop, Cursor, agents…).
//
// Design rule: MCP is an ADAPTER, never business logic. Every tool call
// delegates to executeKnowledgeTool() (knowledge/tools.js) — the exact same
// boundary the REST routes and the admin portal use, so validation, entity
// resolution, conflict detection, provenance and the mutation policy are
// shared. No Cypher, no tenant logic, no policy lives here.
//
// Wire protocol: newline-delimited JSON-RPC 2.0 over stdin/stdout (the MCP
// stdio transport). Only three methods are implemented — initialize,
// tools/list, tools/call — plus ping and the initialization notifications.
// Zero dependencies by design (the repo keeps its test suites dependency-
// free); the core is a pure async function so it is unit-testable without
// streams.
//
// Tenancy + policy:
//   - Company/KB come from tool arguments (`company`, `kbKey`) or the
//     MCP_COMPANY / MCP_KB_KEY environment variables — never from anywhere
//     else; executeKnowledgeTool enforces tenant scope.
//   - The default actor is `{ type: "ai", id: "mcp" }` → per the mutation
//     policy, write tools PROPOSE (candidate claims land in the review
//     queue); set MCP_TRUSTED=true to act as a trusted `api` actor that
//     commits. Read tools always work.
//   - stdio only — do not expose this process on a network socket.
// --------------------------
import { KNOWLEDGE_TOOLS, executeKnowledgeTool } from "../knowledge/index.js";

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_SERVER_NAME = "popularcert-knowledge";
export const MCP_SERVER_VERSION = "1.0.0";

// JSON-RPC 2.0 error codes (parse/internal errors are emitted by the stdio
// entry point, which owns the raw byte stream).
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/** MCP tool definitions: transform KNOWLEDGE_TOOLS into MCP shape. */
export function mcpToolDefinitions() {
  return KNOWLEDGE_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.function.parameters,
  }));
}

/** Tool-argument keys that are transport/context, not tool parameters. */
const META_KEYS = new Set(["company", "companyName", "kbKey"]);

/**
 * Resolve the execution context (tenant, KB, actor) for a tools/call and
 * strip the context keys out of the tool arguments (pure).
 * @param {object} args   raw tool arguments
 * @param {object} env    process.env-ish { MCP_COMPANY, MCP_KB_KEY, MCP_TRUSTED }
 * @returns {{ args: object, companyName: string|null, kbKey: string|null, actor: {type,id} }}
 */
export function resolveMcpContext(args = {}, env = {}) {
  const companyName = String(args.company || args.companyName || env.MCP_COMPANY || "").trim() || null;
  const kbKey = String(args.kbKey || env.MCP_KB_KEY || "").trim() || null;
  const trusted = env.MCP_TRUSTED === "true" || env.MCP_TRUSTED === "1";
  const cleaned = {};
  for (const [k, v] of Object.entries(args)) {
    if (!META_KEYS.has(k)) cleaned[k] = v;
  }
  return {
    args: cleaned,
    companyName,
    kbKey,
    actor: trusted ? { type: "api", id: "mcp" } : { type: "ai", id: "mcp" },
  };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function toolResult(id, text, isError = false) {
  return rpcResult(id, { content: [{ type: "text", text }], isError });
}

/**
 * Create an MCP server core.
 * @param {object} [opts]
 * @param {Function} [opts.executeTool]   defaults to executeKnowledgeTool (injectable for tests)
 * @param {object}   [opts.env]           env for context resolution (MCP_COMPANY/…)
 * @param {Array}    [opts.toolDefinitions]
 * @returns {{ handleMessage: (msg: object) => Promise<object[]> }}
 */
export function createMcpServer({ executeTool = executeKnowledgeTool, env = {}, toolDefinitions = mcpToolDefinitions() } = {}) {
  /**
   * Handle one parsed JSON-RPC message. Returns an array of response objects
   * (empty for notifications). Never throws — every failure becomes a
   * protocol error or an isError tool result.
   * @param {object|null} msg
   * @returns {Promise<Array<object>>}
   */
  async function handleMessage(msg) {
    if (msg === null || typeof msg !== "object") {
      return [rpcError(null, INVALID_REQUEST, "Request must be a JSON object.")];
    }
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;

    switch (method) {
      case "initialize":
        return [
          rpcResult(id ?? null, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
          }),
        ];

      case "notifications/initialized":
      case "notifications/cancelled":
        return []; // notifications get no response

      case "ping":
        return isNotification ? [] : [rpcResult(id, {})];

      case "tools/list":
        if (isNotification) return [];
        return [rpcResult(id, { tools: toolDefinitions })];

      case "tools/call": {
        if (isNotification) return []; // tools/call is a request by spec
        const { name, arguments: args = {} } = params || {};
        if (!name) return [rpcError(id, INVALID_PARAMS, "tools/call requires a tool name.")];
        if (!toolDefinitions.some((t) => t.name === name)) {
          return [toolResult(id, `Unknown tool '${name}'.`, true)];
        }

        const ctx = resolveMcpContext(args, env);
        if (!ctx.companyName) {
          return [
            toolResult(
              id,
              "No company context. Pass 'company' in the tool arguments or set MCP_COMPANY in the environment.",
              true
            ),
          ];
        }

        try {
          const result = await executeTool(name, ctx.args, {
            companyName: ctx.companyName,
            kbKey: ctx.kbKey,
            actor: ctx.actor,
            policyAllow: false, // trust flows through the actor type, never a blanket grant
          });
          return [toolResult(id, JSON.stringify(result, null, 2))];
        } catch (err) {
          return [toolResult(id, err?.message || "Knowledge tool failed.", true)];
        }
      }

      default:
        return [rpcError(id ?? null, METHOD_NOT_FOUND, `Method '${method}' not found.`)];
    }
  }

  return { handleMessage };
}