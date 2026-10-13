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

const { createCompany, setCompanyApiKey, updateConfig, getCompanyConfig } = await import("../../config/index.js");
const { createAskRouter } = await import("../../routes/ask.js");
const createPromptRouter = (await import("../../routes/cloudflare/prompt.js")).default;
const createConfigRouter = (await import("../../routes/cloudflare/config.js")).default;

// Seed the company the tests authenticate as. One company, created before any
// test runs; the API-key gate tests rotate its key.
await createCompany("testco");
// The prompt-variable tests need a company whose SYSTEM_PROMPT + variables are
// small and predictable (the shipped default is a long Popularcert template).
await updateConfig(
  {
    SYSTEM_PROMPT: "You are {{BRAND}}, based in {{CITY}}.",
    PROMPT_VARIABLES: [
      { key: "BRAND", value: "Acme" },
      { key: "CITY", value: "Berlin" },
    ],
  },
  "testco"
);

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

/** Admin-side app for the /cloudflare prompt + config routers (no ask gate). */
function makeConfigApp() {
  const app = express();
  app.use(express.json());
  app.use("/cloudflare/prompt", createPromptRouter);
  app.use("/cloudflare/config", createConfigRouter);
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

async function get(server, urlPath, headers = {}) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}${urlPath}`, { headers });
  return { res, json: await res.json() };
}

async function put(server, urlPath, body, headers = {}) {
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}${urlPath}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { res, json: await res.json() };
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

// --------------------------
// PROMPT VARIABLE RESOLUTION (GET/PUT /cloudflare/prompt)
// Regression: the resolver used to inject implicit built-ins (COMPANY_NAME,
// CONSULTANT_NAME, the four URLs, CURRENT_DATE/YEAR, …). Those are gone — the
// only source of {{VARIABLE}} is custom data: the company PROMPT_VARIABLES tier
// plus the selected assistant's variables, assistant winning.
// --------------------------

test("GET /cloudflare/prompt exposes no built-in variables — only custom pairs", async () => {
  const server = await listen(makeConfigApp());
  try {
    const { res, json } = await get(server, "/cloudflare/prompt", { "x-company-name": "testco" });
    assert.equal(res.status, 200);
    const { variables, companyVariables, assistantVariables, resolved } = json.prompt;
    // Exactly the seeded company tier, in custom-variable shape.
    assert.deepEqual(Object.keys(variables).sort(), ["BRAND", "CITY"]);
    assert.deepEqual(companyVariables, [
      { key: "BRAND", value: "Acme" },
      { key: "CITY", value: "Berlin" },
    ]);
    // No assistant selected for this company.
    assert.deepEqual(assistantVariables, []);
    // The company-name/consultant-name built-ins must NOT be present.
    for (const builtin of ["COMPANY_NAME", "CONSULTANT_NAME", "BASE_URL", "CURRENT_DATE"]) {
      assert.equal(variables[builtin], undefined, `${builtin} must not be a built-in variable`);
    }
    // And the template resolved through the custom pairs only.
    assert.equal(resolved, "You are Acme, based in Berlin.");
  } finally {
    server.close();
  }
});

test("GET /cloudflare/prompt reports unresolved placeholders in `missing`", async () => {
  await updateConfig({ SYSTEM_PROMPT: "Hi {{BRAND}} at {{SOME_UNKNOWN_VAR}}" }, "testco");
  const server = await listen(makeConfigApp());
  try {
    const { json } = await get(server, "/cloudflare/prompt", { "x-company-name": "testco" });
    assert.equal(json.prompt.missing.join(","), "SOME_UNKNOWN_VAR");
    // The unknown placeholder stays LITERAL so the gap is visible in preview.
    assert.equal(json.prompt.resolved, "Hi Acme at {{SOME_UNKNOWN_VAR}}");
  } finally {
    server.close();
    await updateConfig({ SYSTEM_PROMPT: "You are {{BRAND}}, based in {{CITY}}." }, "testco");
  }
});

test("PUT /cloudflare/prompt saves the template together with its variables", async () => {
  const server = await listen(makeConfigApp());
  try {
    const { res, json } = await put(
      server,
      "/cloudflare/prompt",
      {
        template: "Hello {{GREETING}} from {{SENDER}}",
        variables: [
          { key: "greeting", value: "Hi" },
          { key: "SENDER", value: "Neo" },
        ],
      },
      { "x-company-name": "testco" }
    );
    assert.equal(res.status, 200);
    // Keys are normalized to uppercase identifiers on the way in.
    assert.deepEqual(json.prompt.companyVariables, [
      { key: "GREETING", value: "Hi" },
      { key: "SENDER", value: "Neo" },
    ]);
    assert.equal(json.prompt.resolved, "Hello Hi from Neo");
    // Persisted, not just echoed.
    assert.equal(getCompanyConfig("testco").PROMPT_VARIABLES[0].key, "GREETING");
  } finally {
    server.close();
    await updateConfig(
      {
        SYSTEM_PROMPT: "You are {{BRAND}}, based in {{CITY}}.",
        PROMPT_VARIABLES: [
          { key: "BRAND", value: "Acme" },
          { key: "CITY", value: "Berlin" },
        ],
      },
      "testco"
    );
  }
});

test("PUT /cloudflare/prompt rejects an invalid variable key with 400", async () => {
  const server = await listen(makeConfigApp());
  try {
    const { res, json } = await put(
      server,
      "/cloudflare/prompt",
      { template: "Hello", variables: [{ key: "bad key!", value: "x" }] },
      { "x-company-name": "testco" }
    );
    assert.equal(res.status, 400);
    assert.match(json.error, /invalid/i);
  } finally {
    server.close();
  }
});

test("GET /cloudflare/config returns PROMPT_VARIABLES as an array in the PROMPT section", async () => {
  const server = await listen(makeConfigApp());
  try {
    const { res, json } = await get(server, "/cloudflare/config", { "x-company-name": "testco" });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(json.config.PROMPT.PROMPT_VARIABLES));
    assert.deepEqual(json.config.PROMPT.PROMPT_VARIABLES, [
      { key: "BRAND", value: "Acme" },
      { key: "CITY", value: "Berlin" },
    ]);
    assert.equal(typeof json.config.PROMPT.SYSTEM_PROMPT, "string");
  } finally {
    server.close();
  }
});
// ---------------------------------------------------------------------------
// assistantKey must be REQUEST-SCOPED (security regression, 2026-10-05)
//
// The old path called updateConfig({ASSISTANT_KEY}, company) around every ask.
// updateConfig is a persist-first DB write, so on an unauthenticated route this
// (a) wrote attacker-supplied data into the tenant's stored config, (b) never
// cleared it — the restore was `prevKey ? {...} : {}` and updateConfig({}) is a
// no-op, so an injected key PERSISTED after the request, and (c) raced between
// concurrent requests over one process-wide singleton.
//
// The override is now threaded into the pipeline as a per-call argument and
// nothing is written to the config store. These tests lock that.
// ---------------------------------------------------------------------------
test("POST /ask passes assistantKey to the pipeline without writing it to config", async () => {
  const { getCompanyConfig } = await import("../../config/index.js");
  await updateConfig({ ASSISTANT_KEY: "orig-bot" }, "testco");
  assert.equal(getCompanyConfig("testco")?.ASSISTANT_KEY, "orig-bot");

  const seen = [];
  const spyPipeline = {
    ...fakePipeline,
    askQuestion: async (_q, _h, companyName, opts = {}) => {
      seen.push({
        assistantKey: opts.assistantKey ?? null,
        configKeyDuringCall: getCompanyConfig(companyName)?.ASSISTANT_KEY ?? null,
      });
      return fakePipeline.askQuestion(_q, _h, companyName);
    },
  };
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(createAskRouter({ pipeline: spyPipeline }));
  const server = await listen(app);
  try {
    const { res, json } = await post(
      server,
      "/ask",
      { question: "hi", assistantKey: "temp-bot" },
      { "x-company-name": "testco", "x-api-key": "pk_testkey123456" }
    );
    assert.equal(res.status, 200);
    assert.equal(json.success, true);

    // The pipeline received the override as a request argument...
    assert.equal(seen.length, 1);
    assert.equal(seen[0].assistantKey, "temp-bot");
    // ...and the company's stored config was NEVER touched during the call.
    assert.equal(seen[0].configKeyDuringCall, "orig-bot");
    // ...and it is still untouched after the call.
    assert.equal(getCompanyConfig("testco")?.ASSISTANT_KEY, "orig-bot");
  } finally {
    server.close();
  }
});

test("POST /ask with an assistantKey leaves a company that had NO prior key unset", async () => {
  const { getCompanyConfig, updateConfig: upd } = await import("../../config/index.js");
  // Clear the key (empty string = clear) so the company starts with none.
  await upd({ ASSISTANT_KEY: "" }, "testco");
  assert.equal(getCompanyConfig("testco")?.ASSISTANT_KEY ?? null, null);

  const spyPipeline = { ...fakePipeline };
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(createAskRouter({ pipeline: spyPipeline }));
  const server = await listen(app);
  try {
    const { res } = await post(
      server,
      "/ask",
      { question: "hi", assistantKey: "injected-bot" },
      { "x-company-name": "testco", "x-api-key": "pk_testkey123456" }
    );
    assert.equal(res.status, 200);
    // The exact bug: the old restore left "injected-bot" committed.
    assert.equal(getCompanyConfig("testco")?.ASSISTANT_KEY ?? null, null);
  } finally {
    server.close();
  }
});

test("POST /ask without assistantKey passes null so the company default is used", async () => {
  const seen = [];
  const spyPipeline = {
    ...fakePipeline,
    askQuestion: async (_q, _h, companyName, opts = {}) => {
      seen.push(opts.assistantKey ?? null);
      return fakePipeline.askQuestion(_q, _h, companyName);
    },
  };
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(createAskRouter({ pipeline: spyPipeline }));
  const server = await listen(app);
  try {
    const { res } = await post(
      server,
      "/ask",
      { question: "hi" },
      { "x-company-name": "testco", "x-api-key": "pk_testkey123456" }
    );
    assert.equal(res.status, 200);
    assert.deepEqual(seen, [null]);
  } finally {
    server.close();
  }
});

test("POST /ask-stream passes assistantKey without writing it to config", async () => {
  const { getCompanyConfig } = await import("../../config/index.js");
  await updateConfig({ ASSISTANT_KEY: "orig-bot" }, "testco");

  const seen = [];
  const spyPipeline = {
    ...fakePipeline,
    askQuestionStream: async (_q, _h, transport, companyName, opts = {}) => {
      seen.push({
        assistantKey: opts.assistantKey ?? null,
        configKeyDuringCall: getCompanyConfig(companyName)?.ASSISTANT_KEY ?? null,
      });
      return fakePipeline.askQuestionStream(_q, _h, transport, companyName);
    },
  };
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(createAskRouter({ pipeline: spyPipeline }));
  const server = await listen(app);
  try {
    const { res } = await post(
      server,
      "/ask-stream",
      { question: "hi", assistantKey: "temp-bot" },
      { "x-company-name": "testco", "x-api-key": "pk_testkey123456" }
    );
    assert.equal(res.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].assistantKey, "temp-bot");
    assert.equal(seen[0].configKeyDuringCall, "orig-bot");
    assert.equal(getCompanyConfig("testco")?.ASSISTANT_KEY, "orig-bot");
  } finally {
    server.close();
  }
});

test("concurrent asks with different assistantKeys do not clobber each other", async () => {
  const { getCompanyConfig } = await import("../../config/index.js");
  await updateConfig({ ASSISTANT_KEY: "orig-bot" }, "testco");

  const seen = [];
  const spyPipeline = {
    ...fakePipeline,
    askQuestion: async (_q, _h, companyName, opts = {}) => {
      // Yield so the two calls interleave — the old shared-singleton write let
      // the second request's key win for both.
      await new Promise((r) => setTimeout(r, 10));
      seen.push(opts.assistantKey ?? null);
      return { answer: `answer-${opts.assistantKey}`, sources: [] };
    },
  };
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(createAskRouter({ pipeline: spyPipeline }));
  const server = await listen(app);
  try {
    const hdrs = { "x-company-name": "testco", "x-api-key": "pk_testkey123456" };
    const [a, b] = await Promise.all([
      post(server, "/ask", { question: "hi", assistantKey: "bot-a" }, hdrs),
      post(server, "/ask", { question: "hi", assistantKey: "bot-b" }, hdrs),
    ]);
    assert.equal(a.json.answer, "answer-bot-a");
    assert.equal(b.json.answer, "answer-bot-b");
    assert.deepEqual(seen.sort(), ["bot-a", "bot-b"]);
    assert.equal(getCompanyConfig("testco")?.ASSISTANT_KEY, "orig-bot");
  } finally {
    server.close();
    await updateConfig({ ASSISTANT_KEY: "" }, "testco");
  }
});
