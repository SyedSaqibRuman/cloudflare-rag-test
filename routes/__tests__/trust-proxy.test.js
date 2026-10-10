// --------------------------
// TRUST PROXY / RATE-LIMIT KEY (security regression, 2026-10-05)
//
// app.js parses TRUST_PROXY into `trustProxy` and sets it once, near the top of
// the file. A duplicate `app.set("trust proxy", true)` further down clobbered
// that value, so `req.ip` — and therefore every rate limiter's key — became
// attacker-controlled via X-Forwarded-For. Verified live before the fix:
// rotating X-Forwarded-For across 30 requests to POST /auth/login (loginLimiter,
// max 10/min) produced zero 429s, while a fixed X-Forwarded-For correctly 429'd
// after 10.
//
// app.js calls app.listen() at import time, so it cannot be imported here. The
// first test locks the source invariant; the second proves the property the
// setting buys, using the same express + express-rate-limit versions the app uses.
// --------------------------
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import rateLimit from "express-rate-limit";

const APP_JS = new URL("../../app.js", import.meta.url);

test("app.js sets 'trust proxy' exactly once (no duplicate clobbering override)", () => {
  // Strip line comments first: the file documents this exact bug in a comment
  // that would otherwise match the call pattern.
  const src = readFileSync(APP_JS, "utf8")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  const calls = [...src.matchAll(/app\.set\(\s*["']trust proxy["']\s*,\s*([^)]+)\)/g)];
  assert.equal(
    calls.length,
    1,
    `expected exactly one app.set("trust proxy", …) call, found ${calls.length}: ${calls
      .map((c) => c[0])
      .join(" | ")}. A second unconditional call re-enables X-Forwarded-For spoofing.`
  );
  // The single call must use the parsed value, never a literal `true`.
  assert.match(
    calls[0][1].trim(),
    /trustProxy/,
    "the single 'trust proxy' call must use the parseTrustProxy() result, not a hardcoded value"
  );
});

test("env.js exports TRUST_PROXY so the app.js setting is not silently ignored", () => {
  // Regression: app.js reads `env.TRUST_PROXY`, but env.js never exported it,
  // so the value was ALWAYS undefined and the operator's setting did nothing —
  // the secure default held by accident rather than by design. `env` is a frozen
  // object built from an explicit field list, so a missing key is silent.
  const src = readFileSync(APP_JS, "utf8");
  assert.match(src, /env\.TRUST_PROXY/, "app.js should read the setting via env");

  const envSrc = readFileSync(new URL("../../env.js", import.meta.url), "utf8");
  assert.match(
    envSrc,
    /TRUST_PROXY:\s*process\.env\.TRUST_PROXY/,
    "env.js must export TRUST_PROXY from process.env"
  );
});

test("a request-rotated X-Forwarded-For cannot escape the limiter when trust proxy is false", async () => {
  const app = express();
  // This is what TRUST_PROXY=false / a hop count yields: req.ip is the socket
  // address, so a client-supplied X-Forwarded-For is ignored for the limiter key.
  app.set("trust proxy", false);
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: true,
    validate: { trustProxy: false },
  });
  app.use(limiter);
  app.get("/ping", (_req, res) => res.json({ ok: true }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = server.address().port;
    const hit = (xff) =>
      fetch(`http://127.0.0.1:${port}/ping`, {
        headers: xff ? { "X-Forwarded-For": xff } : {},
      });

    // Rotate the header well past the limit — all must still be throttled,
    // because every request shares the socket IP as its limiter key.
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await hit(`203.0.113.${i}`)).status);
    }
    assert.equal(
      statuses.filter((s) => s === 429).length,
      7,
      `expected 7 throttled responses after the 5-request budget, got ${JSON.stringify(statuses)}`
    );

    // A fresh limiter window is not needed to show the point: the rotation must
    // not have produced ANY 200s past the budget.
    assert.equal(statuses.slice(5).every((s) => s === 429), true);
  } finally {
    server.close();
  }
});
