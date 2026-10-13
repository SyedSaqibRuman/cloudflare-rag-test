// --------------------------
// POPULARCERT KNOWLEDGE — MCP STdio ENTRY (node mcp/index.js)
// Wires the MCP server core (mcp-server.js) to stdin/stdout using the MCP
// stdio transport: one JSON-RPC 2.0 object per line. Run directly, never
// imported — the argv guard keeps app.js imports clean (same pattern as
// query/cli.js).
//
// Environment:
//   MCP_COMPANY     default company (overridable per-call via `company` arg)
//   MCP_KB_KEY      default KB (overridable per-call via `kbKey` arg)
//   MCP_TRUSTED     "true" → MCP acts as a trusted api actor (write tools
//                   commit); otherwise AI actor → write tools propose to the
//                   review queue. Defaults to safe (propose).
//
// All diagnostics go to stderr — stdout carries ONLY protocol JSON.
// --------------------------
import "dotenv/config";
import readline from "readline";
import { initConfig } from "../config/index.js";
import { createMcpServer } from "./mcp-server.js";

if (process.argv[1]?.endsWith("mcp/index.js")) {
  // stdout must carry ONLY protocol JSON. Route every stray console.log
  // (config boot logs, dependency chatter, …) to stderr for the lifetime of
  // the process — a single non-JSON line would break the client handshake.
  console.log = (...args) => console.error(...args);

  await initConfig();
  const { handleMessage } = createMcpServer({ env: process.env });

  const rl = readline.createInterface({ input: process.stdin });

  const send = (obj) => {
    if (obj === undefined) return;
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  };

  /** Process one line, returning responses (serialized via a promise chain). */
  const processLine = async (line) => {
    const trimmed = String(line).trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    try {
      const responses = await handleMessage(msg);
      for (const r of responses) send(r);
    } catch (err) {
      // Should never happen (handleMessage is total) — defensive only.
      send({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32603, message: err?.message || "Internal error" } });
    }
  };

  // Serialize: MCP stdio is request/response over one pipe — responses must
  // not interleave when the client pipelines requests.
  let queue = Promise.resolve();
  rl.on("line", (line) => {
    queue = queue.then(() => processLine(line));
  });

  rl.on("close", () => {
    queue.finally(() => process.exit(0));
  });

  console.error(
    `🕸️ PopularCert Knowledge MCP server ready (stdio). Company=${process.env.MCP_COMPANY || "(per-call)"} KB=${process.env.MCP_KB_KEY || "(per-call)"} trust=${process.env.MCP_TRUSTED === "true" ? "commit" : "propose"}`
  );
}