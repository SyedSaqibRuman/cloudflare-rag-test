// --------------------------
// CLERK LOGIN TESTS — pure-ESM, no node_modules, no network.
// verifyClerkCredentials is exercised with an injected fake fetch; the HTTP
// route layer (POST /auth/login) is exercised through a real express app with
// the process env toggling Clerk on/off per test.
//
// Env handling: dotenv never overrides already-set vars, so each test sets
// CLERK_SECRET_KEY explicitly ("" → unset) and restores it afterwards.
// ADMIN_USERNAME/PASSWORD come from the developer's real .env (loaded by
// auth.js at import) — legacy-fallback tests use credentials that CANNOT match
// them so the suite never depends on their values.
// --------------------------
process.env.MYSQL_HOST = "";
process.env.MYSQL_USER = "";
process.env.MYSQL_DATABASE = "";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { isClerkConfigured, verifyClerkCredentials } from "../../auth-clerk.js";
import authRouter from "../auth.js";

const PREV_CLERK = process.env.CLERK_SECRET_KEY ?? "";
const PREV_TTL = process.env.ADMIN_TOKEN_TTL_HOURS ?? "";

// Repo test pattern (ask-routes.test.js): bind the app to an ephemeral port
// and drive it with plain fetch — no supertest dependency.
function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function call(app, method, urlPath, body) {
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  } finally {
    server.close();
  }
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Fake Clerk Backend API. `script` maps a step ("lookup" | "verify") to a
// handler (url, body) → response; calls are recorded in `calls`. Mirrors the
// REAL Backend API: GET /v1/users?<param>=… resolves the identifier, then
// POST /v1/users/:id/verify_password checks the password. (There is no
// /v1/sign_ins on the Backend API — that flow is Frontend-API-only and 404s
// server-side.) URLs that are NOT Clerk API calls (e.g. the loopback request
// to the express app under test) pass through to the real fetch.
function fakeClerk(script, calls = []) {
  const realFetch = globalThis.fetch;
  return async function fetchImpl(url, init = {}) {
    if (!String(url).includes("api.clerk.com")) {
      return realFetch(url, init);
    }
    const body = Object.fromEntries(new URLSearchParams(init.body || ""));
    const u = String(url);
    if (u.includes("/v1/users?") && init.method === "GET") {
      calls.push({ step: "lookup", url: u });
      return script.lookup(u, body);
    }
    if (u.includes("/verify_password") && init.method === "POST") {
      calls.push({ step: "verify", body });
      return script.verify(url, body);
    }
    calls.push({ step: "unknown", url: u });
    return jsonResponse(404, { errors: [{ code: "not_found", long_message: "unknown endpoint" }] });
  };
}

const TEST_USER = {
  id: "user_2a00000000000000000000000a",
  username: "admin",
  two_factor_enabled: false,
  primary_email_address_id: "idn_email_1",
  email_addresses: [
    { id: "idn_email_1", email_address: "admin@popularcert.com", verification: { status: "verified" } },
  ],
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  return app;
}

describe("isClerkConfigured", () => {
  it("mirrors CLERK_SECRET_KEY", () => {
    process.env.CLERK_SECRET_KEY = "sk_test_x";
    assert.equal(isClerkConfigured(), true);
    process.env.CLERK_SECRET_KEY = "";
    assert.equal(isClerkConfigured(), false);
  });
});

let prevAllowedEmails = "";
describe("verifyClerkCredentials (fake fetch)", () => {
  beforeEach(() => {
    process.env.CLERK_SECRET_KEY = "sk_test_abc";
    // Hermetic: the developer's real .env may set an allowlist that would
    // block the mocked test user. Restore it after each test.
    prevAllowedEmails = process.env.CLERK_ALLOWED_EMAILS ?? "";
    process.env.CLERK_ALLOWED_EMAILS = "";
  });
  afterEach(() => {
    process.env.CLERK_SECRET_KEY = PREV_CLERK;
    process.env.CLERK_ALLOWED_EMAILS = prevAllowedEmails;
  });

  it("returns ok with user id + email after lookup + verify_password", async () => {
    const calls = [];
    const fetchImpl = fakeClerk(
      {
        lookup: () => jsonResponse(200, [TEST_USER]),
        verify: () => jsonResponse(200, { verified: true }),
      },
      calls
    );
    const result = await verifyClerkCredentials("admin@popularcert.com", "pw", { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.userId, TEST_USER.id);
    assert.equal(result.email, "admin@popularcert.com");
    assert.deepEqual(
      calls.map((c) => c.step),
      ["lookup", "verify"]
    );
    assert.equal(calls[1].body.password, "pw");
  });

  it("falls back to the username param when the email lookup misses", async () => {
    const calls = [];
    const fetchImpl = fakeClerk(
      {
        lookup: (u) =>
          u.includes("username=")
            ? jsonResponse(200, [{ ...TEST_USER, email_addresses: [] }])
            : jsonResponse(200, []),
        verify: () => jsonResponse(200, { verified: true }),
      },
      calls
    );
    const result = await verifyClerkCredentials("admin", "pw", { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.email, "admin"); // no emails on user → identifier echoed
    assert.deepEqual(calls.map((c) => c.step), ["lookup", "lookup", "verify"]);
  });

  it("maps unknown identifier to a generic 401-style invalid (no account enumeration)", async () => {
    const fetchImpl = fakeClerk({
      lookup: () => jsonResponse(200, []),
      verify: () => jsonResponse(500, {}),
    });
    const result = await verifyClerkCredentials("ghost@nowhere.test", "pw", { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.status, "invalid");
    assert.equal(result.message, "Invalid username or password.");
  });

  it("maps a wrong password (422 incorrect_password) to invalid", async () => {
    const fetchImpl = fakeClerk({
      lookup: () => jsonResponse(200, [TEST_USER]),
      verify: () =>
        jsonResponse(422, {
          errors: [{ code: "incorrect_password", long_message: "The provided password is not the one the user has set" }],
        }),
    });
    const result = await verifyClerkCredentials("admin@popularcert.com", "bad", { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.status, "invalid");
    assert.equal(result.message, "Invalid username or password.");
  });

  it("rejects a 2FA-enabled user with a helpful message", async () => {
    const fetchImpl = fakeClerk({
      lookup: () => jsonResponse(200, [{ ...TEST_USER, two_factor_enabled: true }]),
      verify: () => jsonResponse(500, {}),
    });
    const result = await verifyClerkCredentials("admin@popularcert.com", "pw", { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.status, "invalid");
    assert.match(result.message, /second factor/i);
  });

  it("treats a non-JSON 404 from the verify endpoint as a temporary error, not invalid", async () => {
    // Regression lock: the Backend API has no /sign_ins — a misrouted call
    // returns plaintext "404 page not found" which must surface as 503-class
    // error, never as "Invalid username or password".
    const fetchImpl = fakeClerk({
      lookup: () => jsonResponse(200, [TEST_USER]),
      verify: () => ({ ok: false, status: 404, json: async () => null }),
    });
    const result = await verifyClerkCredentials("admin@popularcert.com", "pw", { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.status, "error");
    assert.match(result.message, /temporarily unavailable/i);
  });

  it("treats a Clerk 5xx as a temporary error (not invalid credentials)", async () => {
    const fetchImpl = fakeClerk({
      lookup: () => jsonResponse(503, { errors: [{ code: "backend_error", long_message: "upstream down" }] }),
      verify: () => jsonResponse(500, {}),
    });
    const result = await verifyClerkCredentials("admin@popularcert.com", "pw", { fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.status, "error");
  });

  it("treats a network failure as a temporary error", async () => {
    const result = await verifyClerkCredentials("a@b.c", "pw", {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "error");
    assert.match(result.message, /temporarily unavailable/i);
  });

  it("enforces CLERK_ALLOWED_EMAILS when set", async () => {
    process.env.CLERK_ALLOWED_EMAILS = "allowed@popularcert.com, second@popularcert.com";
    try {
      const fetchImpl = fakeClerk({
        lookup: () => jsonResponse(200, [TEST_USER]),
        verify: () => jsonResponse(200, { verified: true }),
      });
      const denied = await verifyClerkCredentials("admin@popularcert.com", "pw", { fetchImpl });
      assert.equal(denied.ok, false);
      assert.match(denied.message, /not authorized/i);

      process.env.CLERK_ALLOWED_EMAILS = "admin@popularcert.com";
      const allowed = await verifyClerkCredentials("admin@popularcert.com", "pw", { fetchImpl });
      assert.equal(allowed.ok, true);
    } finally {
      process.env.CLERK_ALLOWED_EMAILS = "";
    }
  });
});

describe("POST /auth/login with Clerk configured (HTTP)", () => {
  beforeEach(() => {
    process.env.CLERK_SECRET_KEY = "sk_test_route";
    process.env.ADMIN_TOKEN_TTL_HOURS = "1";
    // Hermetic: neutralize a developer allowlist that would block the mocked
    // user (same reason as in the verifyClerkCredentials describe above).
    prevAllowedEmails = process.env.CLERK_ALLOWED_EMAILS ?? "";
    process.env.CLERK_ALLOWED_EMAILS = "";
  });
  afterEach(() => {
    process.env.CLERK_SECRET_KEY = PREV_CLERK;
    process.env.ADMIN_TOKEN_TTL_HOURS = PREV_TTL;
    process.env.CLERK_ALLOWED_EMAILS = prevAllowedEmails;
  });

  function stubClerkOnApp() {
    // The route imports verifyClerkCredentials from auth-clerk.js, which calls
    // globalThis.fetch by default. Stub it for the route-level tests only.
    const realFetch = globalThis.fetch;
    const ROUTE_USER = {
      ...TEST_USER,
      id: "user_2b00000000000000000000000b",
      email_addresses: [
        { id: "idn_email_1", email_address: "clerk-user@popularcert.com", verification: { status: "verified" } },
      ],
    };
    globalThis.fetch = fakeClerk({
      lookup: (u) =>
        u.includes("clerk-user%40popularcert.com") || u.includes("clerk-user@popularcert.com")
          ? jsonResponse(200, [ROUTE_USER])
          : jsonResponse(200, []),
      verify: (url, body) =>
        body.password === "clerk-pass"
          ? jsonResponse(200, { verified: true })
          : jsonResponse(422, { errors: [{ code: "incorrect_password", long_message: "The provided password is not the one the user has set" }] }),
    });
    return () => {
      globalThis.fetch = realFetch;
    };
  }

  it("issues a session token for a valid Clerk user", async () => {
    const restore = stubClerkOnApp();
    try {
      const res = await call(buildApp(), "POST", "/auth/login", {
        username: "clerk-user@popularcert.com",
        password: "clerk-pass",
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.ok(res.json.token);
      assert.equal(res.json.provider, "clerk");
    } finally {
      restore();
    }
  });

  it("returns 401 for a Clerk user with the wrong password (no env fallback)", async () => {
    const restore = stubClerkOnApp();
    try {
      const res = await call(buildApp(), "POST", "/auth/login", {
        username: "clerk-user@popularcert.com",
        password: "definitely-not-clerk-pass",
      });
      assert.equal(res.status, 401);
    } finally {
      restore();
    }
  });

  it("returns 401 for an unknown identifier even with the .env admin password (Clerk is authoritative)", async () => {
    const restore = stubClerkOnApp();
    try {
      const res = await call(buildApp(), "POST", "/auth/login", {
        username: "clerk-user@popularcert.com",
        password: "unrelated-wrong-password-123",
      });
      assert.equal(res.status, 401);
    } finally {
      restore();
    }
  });

  it("returns 503 when Clerk is unreachable (no silent env fallback)", async () => {
    const realFetch = globalThis.fetch;
    // Fail only Clerk traffic — the loopback call to the app must still work.
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("api.clerk.com")) throw new Error("ECONNREFUSED");
      return realFetch(url, init);
    };
    try {
      const res = await call(buildApp(), "POST", "/auth/login", {
        username: "clerk-user@popularcert.com",
        password: "clerk-pass",
      });
      assert.equal(res.status, 503);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

let prevAdminU = "";
let prevAdminP = "";
describe("POST /auth/login legacy fallback (Clerk unset)", () => {
  beforeEach(() => {
    process.env.CLERK_SECRET_KEY = "";
    // Hermetic: set our own legacy credentials instead of depending on the
    // developer's real .env (checkCredentials reads process.env at call time).
    prevAdminU = process.env.ADMIN_USERNAME ?? "";
    prevAdminP = process.env.ADMIN_PASSWORD ?? "";
    process.env.ADMIN_USERNAME = "legacy-admin-test";
    process.env.ADMIN_PASSWORD = "legacy-pass-test-91337";
  });
  afterEach(() => {
    process.env.CLERK_SECRET_KEY = PREV_CLERK;
    process.env.ADMIN_USERNAME = prevAdminU;
    process.env.ADMIN_PASSWORD = prevAdminP;
  });

  it("falls back to .env credentials", async () => {
    const res = await call(buildApp(), "POST", "/auth/login", {
      username: "legacy-admin-test",
      password: "legacy-pass-test-91337",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.ok(res.json.token);
    assert.equal(res.json.provider, undefined);
  });

  it("rejects wrong credentials without Clerk", async () => {
    const res = await call(buildApp(), "POST", "/auth/login", {
      username: "no-such-user-xyz",
      password: "no-such-pass-xyz-987654321",
    });
    assert.equal(res.status, 401);
  });
});
