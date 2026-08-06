import test from "node:test";
import assert from "node:assert/strict";
import { extractToken } from "../../auth.js";

// extractToken resolves the admin session token from, in priority order:
// x-auth-token header, Authorization: Bearer, then the /api-docs-scoped
// pc_admin_token cookie (set by the portal so a new-tab docs page — whose
// page and asset requests can only carry a cookie — can authenticate).

test("x-auth-token header wins over all other sources", () => {
  const req = {
    headers: {
      "x-auth-token": "header-token",
      authorization: "Bearer bearer-token",
      cookie: "pc_admin_token=cookie-token",
    },
  };
  assert.equal(extractToken(req), "header-token");
});

test("Authorization: Bearer is used when no x-auth-token header", () => {
  const req = { headers: { authorization: "Bearer abc.def.ghi" } };
  assert.equal(extractToken(req), "abc.def.ghi");
});

test("pc_admin_token cookie is the fallback (URL-decoded)", () => {
  const req = { headers: { cookie: "other=1; pc_admin_token=abc%2Edef%2Eghi" } };
  assert.equal(extractToken(req), "abc.def.ghi");
});

test("cookie token is found when not the first cookie", () => {
  const req = { headers: { cookie: "theme=dark; pc_admin_token=xyz" } };
  assert.equal(extractToken(req), "xyz");
});

test("malformed Authorization without Bearer prefix is ignored", () => {
  const req = { headers: { authorization: "Basic abc" } };
  assert.equal(extractToken(req), null);
});

test("no credentials anywhere -> null", () => {
  assert.equal(extractToken({ headers: {} }), null);
});
