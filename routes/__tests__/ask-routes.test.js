import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The config layer resolves its SQLite dir (db/) from process.cwd() at import
// time, so point it at an isolated temp dir before anything config-related
// loads. node --test runs each test file in its own process, so this chdir
// cannot leak into other files. The temp db is removed in the after() hook.
const TEST_DIR = mkdtempSync(path.join(tmpdir(), "ask-routes-"));
process.chdir(TEST_DIR);

// These tests exercise the SQLite backend — pin it so an ambient
// CONFIG_STORE=mysql (shell/.env) can't reroute company writes to MySQL.
process.env.CONFIG_STORE = "sqlite";

const { createCompany, setCompanyApiKey } = await import("../../config/index.js");
const { createAskRouter } = await import("../../routes/ask.js");

// Seed the company the tests authenticate as. One company, created before any
// test runs; the API-key gate tests rotate its key.
await createCompany("testco");

after(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// Fake pipeline: the ask endpoints' remote dependency (Cloudflare AI) is
// injected here as an in-memory adapter — no network in tests. The real
// pipeline (query/answer.js) satisfies the same interface.
const fakePipeline = {
  askQuestion: async (_q, _h, companyName) => ({
    answer: `mock answer for ${companyName}`,
    sources: [{ title: "Doc", score: 0.9 }],
  }),
  askQuestionStream: async (_q, _h, transport, companyName) => {
    transport.sendToken(`streamed for ${companyName}`);
    return true;
  },
};

function makeApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(createAskRouter({ pipeline: fakePipeline }));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function post(server, urlPath, body, headers = {}) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}${urlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* SSE or empty body */ }
  return { res, text, json };
}

test("POST /ask requires the x-company-name header", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await post(server, "/ask", { question: "hi" });
    assert.equal(res.status, 400);
    assert.match(json.error, /Company is required/);
  } finally {
    server.close();
  }
});

test("POST /ask rejects an unknown company", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await post(server, "/ask", { question: "hi" }, { "x-company-name": "ghostco" });
    assert.equal(res.status, 400);
    assert.match(json.error, /Company 'ghostco' not found/);
  } finally {
    server.close();
  }
});

test("POST /ask requires a question", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await post(server, "/ask", { question: "  " }, { "x-company-name": "testco" });
    assert.equal(res.status, 400);
    assert.equal(json.error, "Question is required");
  } finally {
    server.close();
  }
});

test("POST /ask requires history to be an array", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await post(server, "/ask", { question: "hi", history: "nope" }, { "x-company-name": "testco" });
    assert.equal(res.status, 400);
    assert.equal(json.error, "History must be an array");
  } finally {
    server.close();
  }
});

test("POST /ask returns the pipeline answer", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await post(server, "/ask", { question: "hi" }, { "x-company-name": "testco" });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.answer, "mock answer for testco");
    assert.equal(json.sources[0].title, "Doc");
  } finally {
    server.close();
  }
});

test("POST /ask-stream streams token + [DONE] frames", async () => {
  const server = await listen(makeApp());
  try {
    const { res, text } = await post(server, "/ask-stream", { question: "hi" }, { "x-company-name": "testco" });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/event-stream/);
    assert.ok(text.includes('data: {"token":"streamed for testco"}'));
    assert.ok(text.includes("data: [DONE]"));
  } finally {
    server.close();
  }
});

test("POST /ask-stream validates before opening the stream", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await post(server, "/ask-stream", { question: "" }, { "x-company-name": "testco" });
    assert.equal(res.status, 400);
    assert.equal(json.error, "Question is required");
    assert.notEqual(res.headers.get("content-type"), "text/event-stream");
  } finally {
    server.close();
  }
});

test("API key gate: 401 without the key when one is set", async () => {
  await setCompanyApiKey("testco", "pk_testkey123456");
  const server = await listen(makeApp());
  try {
    const { res, json } = await post(server, "/ask", { question: "hi" }, { "x-company-name": "testco" });
    assert.equal(res.status, 401);
    assert.equal(json.error, "Invalid or missing API key.");
  } finally {
    server.close();
  }
});

test("API key gate: correct key passes without an origin", async () => {
  const server = await listen(makeApp());
  try {
    const { res, json } = await post(server, "/ask", { question: "hi" }, {
      "x-company-name": "testco",
      "x-api-key": "pk_testkey123456",
    });
    assert.equal(res.status, 200);
    assert.equal(json.answer, "mock answer for testco");
  } finally {
    server.close();
  }
});

test("POST /ask/reset requires the company header and API key", async () => {
  const server = await listen(makeApp());
  try {
    const missing = await post(server, "/ask/reset", {});
    assert.equal(missing.res.status, 400);

    const noKey = await post(server, "/ask/reset", {}, { "x-company-name": "testco" });
    assert.equal(noKey.res.status, 401);
  } finally {
    server.close();
  }
});

test("POST /ask/reset clears the company's cache and reports the count", async () => {
  const { getCacheKey, setCache, getCached } = await import("../../query/cache.js");
  // Prime the cache with one entry for testco (the API-key gate was enabled in
  // an earlier test, so send the key) and one for a different company.
  setCache(getCacheKey("reset-me", "testco"), { answer: "stale" }, "testco");
  setCache(getCacheKey("keep-me", "otherco"), { answer: "fresh" }, "otherco");

  const server = await listen(makeApp());
  try {
    const { res, json } = await post(server, "/ask/reset", {}, {
      "x-company-name": "testco",
      "x-api-key": "pk_testkey123456",
    });
    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.equal(json.cleared, 1);
    assert.equal(getCached(getCacheKey("reset-me", "testco")), null);
    assert.deepEqual(getCached(getCacheKey("keep-me", "otherco")), { answer: "fresh" });
  } finally {
    server.close();
  }
});
