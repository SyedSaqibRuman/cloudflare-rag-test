import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The logs router + logger resolve logs/ from process.cwd() at import time,
// so point them at an isolated temp dir first (same chdir pattern as the
// ask-routes suite). Removed in the after() hook.
const TEST_DIR = mkdtempSync(path.join(tmpdir(), "logs-routes-"));
process.chdir(TEST_DIR);

const { default: logsRouter } = await import("../logs.js");

after(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// app.js mounts the logs router under /logs — mirror that so the test hits
// the same path structure as production (POST /logs/ui, GET /logs, …).
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/logs", logsRouter);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function req(server, method, urlPath, body) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

test("POST /logs/ui requires a non-empty message", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/logs/ui", {});
    assert.equal(res.status, 400);
    assert.match(json.error, /message is required/);

    const blank = await req(server, "POST", "/logs/ui", { message: "   " });
    assert.equal(blank.res.status, 400);
  } finally {
    server.close();
  }
});

test("POST /logs/ui appends the toast to logs/UI.logs", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "POST", "/logs/ui", { message: "Configuration saved.", tone: "green" });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
  } finally {
    server.close();
  }

  // The async logger flushes on a microtask — poll briefly for the file.
  const uiLog = path.join(TEST_DIR, "logs", "UI.logs");
  let raw = "";
  for (let i = 0; i < 50; i++) {
    if (existsSync(uiLog)) {
      raw = readFileSync(uiLog, "utf8");
      if (raw.includes("Configuration saved.")) break;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(raw.includes("Configuration saved."), `UI.logs should contain the toast, got: ${JSON.stringify(raw)}`);
});

test("error-toned toasts are tagged [error] in UI.logs", async () => {
  const server = await listen(makeApp());
  try {
    await req(server, "POST", "/logs/ui", { message: "Delete failed: nope", tone: "red" });
  } finally {
    server.close();
  }

  const uiLog = path.join(TEST_DIR, "logs", "UI.logs");
  let raw = "";
  for (let i = 0; i < 50; i++) {
    if (existsSync(uiLog)) {
      raw = readFileSync(uiLog, "utf8");
      if (raw.includes("Delete failed: nope")) break;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.match(raw, /\[error\] Delete failed: nope/);
});

test("GET /logs lists UI.logs and reads it back", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await req(server, "GET", "/logs");
    assert.equal(res.status, 200);
    assert.ok(json.files.some((f) => f.name === "UI.logs"), "UI.logs should appear in the file list");

    const read = await req(server, "GET", "/logs/UI.logs?tail=0");
    assert.equal(read.res.status, 200);
    assert.ok(read.json.lines.some((l) => l.includes("Configuration saved.")));
  } finally {
    server.close();
  }
});

test("GET /logs/UI.logs/download serves the file", async () => {
  const server = await listen(makeApp());
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/logs/UI.logs/download`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition"), /UI\.logs/);
  } finally {
    server.close();
  }
});
