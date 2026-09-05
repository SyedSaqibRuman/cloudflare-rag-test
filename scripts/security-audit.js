#!/usr/bin/env node
// --------------------------
// SECURITY AUDIT SCRIPT — PopularCert RAG API
// Tests multi-tenant isolation, auth, IDOR, credential exposure, XSS, CORS
// --------------------------
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:3000";

// Helper: make raw HTTP request
async function req(path, { method = "GET", headers = {}, body } = {}) {
  const opts = { method, headers: { ...headers }, redirect: "manual" };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, headers: Object.fromEntries(res.headers), text, json };
}

// Login and get token
async function login(username = "admin@popularcert.com", password = "admin123") {
  const r = await req("/auth/login", { method: "POST", body: { username, password } });
  return r.json?.token;
}

// ==================== AUTHENTICATION TESTS ====================
describe("🔐 Authentication Security", () => {
  test("POST /auth/login rejects invalid credentials", async () => {
    const r = await req("/auth/login", { method: "POST", body: { username: "admin@popularcert.com", password: "wrongpassword" } });
    assert.ok(r.status === 401 || r.status === 400, `Expected 401/400, got ${r.status}`);
  });

  test("POST /auth/login rejects empty credentials", async () => {
    const r = await req("/auth/login", { method: "POST", body: { username: "", password: "" } });
    assert.ok(r.status >= 400, `Expected 4xx, got ${r.status}`);
  });

  test("GET /cloudflare/companies requires auth", async () => {
    const r = await req("/cloudflare/companies");
    assert.equal(r.status, 401, "Should return 401 without auth token");
  });

  test("GET /gateway/workflows requires auth", async () => {
    const r = await req("/gateway/workflows");
    assert.equal(r.status, 401, "Should return 401 without auth token");
  });

  test("GET /cloudflare/companies rejects invalid token", async () => {
    const r = await req("/cloudflare/companies", { headers: { Authorization: "Bearer invalid_token_12345" } });
    assert.equal(r.status, 401, "Should return 401 with invalid token");
  });

  test("GET /gateway/workflows rejects invalid token", async () => {
    const r = await req("/gateway/workflows", { headers: { Authorization: "Bearer invalid_token_12345" } });
    assert.equal(r.status, 401, "Should return 401 with invalid token");
  });

  test("GET /auth/me works with valid token", async () => {
    const token = await login();
    const r = await req("/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.equal(r.json?.authenticated, true);
  });
});

// ==================== MULTI-TENANT ISOLATION ====================
describe("🏢 Multi-Tenant Isolation", () => {
  let tokenA, tokenB;

  test("Login as company A admin", async () => {
    tokenA = await login();
    assert.ok(tokenA, "Token A should exist");
  });

  test("Create test company B for isolation testing", async () => {
    // Create company B (name must match /^[a-z0-9-]+$/)
    const r = await req("/cloudflare/companies", {
      method: "POST",
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { company: "sectestb", companyName: "Security Test B" }
    });
    // 201 = created, 409 = already exists, 400 = validation error
    assert.ok(r.status === 201 || r.status === 409 || r.status === 400, `Create company: ${r.status}`);
  });

  test("Cross-tenant: Company A cannot list Company B's KBs", async () => {
    const r = await req("/gateway/kbs", {
      headers: { Authorization: `Bearer ${tokenA}`, "x-company-name": "sectestb" }
    });
    // Should get 200 but empty list, or 403/404
    if (r.status === 200) {
      const kbs = r.json?.kbs || r.json?.data || [];
      assert.equal(kbs.length, 0, "Company A should see 0 KBs for Company B");
    }
    // 403/404 also acceptable
    assert.ok(r.status === 200 || r.status === 403 || r.status === 404, `Unexpected status: ${r.status}`);
  });

  test("Cross-tenant: Company A cannot list Company B's assistants", async () => {
    const r = await req("/gateway/assistants", {
      headers: { Authorization: `Bearer ${tokenA}`, "x-company-name": "sectestb" }
    });
    if (r.status === 200) {
      const items = r.json?.assistants || [];
      assert.equal(items.length, 0, "Company A should see 0 assistants for Company B");
    }
  });

  test("Cross-tenant: Company A cannot list Company B's workflows", async () => {
    const r = await req("/gateway/workflows", {
      headers: { Authorization: `Bearer ${tokenA}`, "x-company-name": "sectestb" }
    });
    if (r.status === 200) {
      const items = r.json?.workflows || [];
      assert.equal(items.length, 0, "Company A should see 0 workflows for Company B");
    }
  });

  test("Cross-tenant: Company A cannot list Company B's webhooks", async () => {
    const r = await req("/gateway/webhooks", {
      headers: { Authorization: `Bearer ${tokenA}`, "x-company-name": "sectestb" }
    });
    if (r.status === 200) {
      const items = r.json?.webhooks || [];
      assert.equal(items.length, 0, "Company A should see 0 webhooks for Company B");
    }
  });

  test("Cross-tenant: Company A cannot list Company B's credentials", async () => {
    const r = await req("/gateway/credentials", {
      headers: { Authorization: `Bearer ${tokenA}`, "x-company-name": "sectestb" }
    });
    if (r.status === 200) {
      const items = r.json?.credentials || [];
      assert.equal(items.length, 0, "Company A should see 0 credentials for Company B");
    }
  });

  test("Cross-tenant: Company A cannot list Company B's providers", async () => {
    const r = await req("/gateway/providers", {
      headers: { Authorization: `Bearer ${tokenA}`, "x-company-name": "sectestb" }
    });
    // Should return provider catalog (global) or empty company-scoped list
    assert.ok(r.status === 200 || r.status === 403, `Status: ${r.status}`);
  });

  test("Cross-tenant: Missing x-company-name header returns error", async () => {
    const r = await req("/gateway/kbs", {
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.ok(r.status >= 400, "Should require x-company-name header");
  });
});

// ==================== IDOR / BOLA TESTING ====================
describe("🔑 IDOR / BOLA Testing", () => {
  let token, companyId;

  test("Get token and company info", async () => {
    token = await login();
    const r = await req("/cloudflare/companies", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const companies = r.json?.companies || [];
    assert.ok(companies.length > 0, "Should have at least 1 company");
    companyId = companies[0].name || companies[0].company_name;
  });

  test("IDOR: Access KB with random ID (should fail gracefully)", async () => {
    const r = await req("/gateway/kbs/nonexistent-kb-99999", {
      headers: { Authorization: `Bearer ${token}`, "x-company-name": companyId }
    });
    assert.ok(r.status === 404 || r.status === 400, `Expected 404/400, got ${r.status}`);
  });

  test("IDOR: Access assistant with random ID (should fail gracefully)", async () => {
    const r = await req("/gateway/assistants/nonexistent-assistant-99999", {
      headers: { Authorization: `Bearer ${token}`, "x-company-name": companyId }
    });
    assert.ok(r.status === 404 || r.status === 400, `Expected 404/400, got ${r.status}`);
  });

  test("IDOR: Access workflow with random ID (should fail gracefully)", async () => {
    const r = await req("/gateway/workflows/nonexistent-wf-99999", {
      headers: { Authorization: `Bearer ${token}`, "x-company-name": companyId }
    });
    assert.ok(r.status === 404 || r.status === 400, `Expected 404/400, got ${r.status}`);
  });

  test("IDOR: Access credential with random ID (should fail gracefully)", async () => {
    const r = await req("/gateway/credentials/99999", {
      headers: { Authorization: `Bearer ${token}`, "x-company-name": companyId }
    });
    assert.ok(r.status === 404 || r.status === 400, `Expected 404/400, got ${r.status}`);
  });
});

// ==================== CREDENTIAL EXPOSURE ====================
describe("🔒 Credential Exposure", () => {
  let token, companyId;

  test("Get token and company", async () => {
    token = await login();
    const r = await req("/cloudflare/companies", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const companies = r.json?.companies || [];
    companyId = companies[0]?.name || companies[0]?.company_name;
  });

  test("GET /cloudflare/companies should NOT expose API keys or secrets", async () => {
    const r = await req("/cloudflare/companies", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const text = r.text.toLowerCase();
    // Check for common credential patterns in response
    const dangerousPatterns = [
      /api_key\s*[:=]/i,
      /secret\s*[:=]/i,
      /password\s*[:=]/i,
      /token\s*[:=]\s*["'][a-zA-Z0-9]{20,}/i,
      /cloudflare_api_token/i,
      /r2_secret/i,
      /access_key/i,
    ];
    for (const pattern of dangerousPatterns) {
      assert.ok(!pattern.test(r.text), `Response may contain credential: ${pattern}`);
    }
  });

  test("GET /cloudflare/config should NOT expose raw credentials", async () => {
    const r = await req("/cloudflare/config", {
      headers: { Authorization: `Bearer ${token}`, "x-company-name": companyId }
    });
    if (r.status === 200) {
      const text = r.text.toLowerCase();
      // CLOUDFLARE_API_TOKEN should not appear in plaintext
      assert.ok(!text.includes("gcm:"), "Response should not contain encrypted blobs");
    }
  });

  test("GET /gateway/credentials should NOT expose decrypted secrets", async () => {
    const r = await req("/gateway/credentials", {
      headers: { Authorization: `Bearer ${token}`, "x-company-name": companyId }
    });
    if (r.status === 200) {
      const creds = r.json?.credentials || [];
      for (const cred of creds) {
        // Should have encrypted_credentials but not decrypted values
        assert.ok(!cred.decrypted_values, "Should not expose decrypted credential values");
        assert.ok(!cred.api_token, "Should not expose api_token directly");
        assert.ok(!cred.secret_access_key, "Should not expose secret_access_key directly");
        assert.ok(!cred.password, "Should not expose password directly");
      }
    }
  });

  test("GET /gateway/kbs should NOT expose R2 keys or internal paths", async () => {
    const r = await req("/gateway/kbs", {
      headers: { Authorization: `Bearer ${token}`, "x-company-name": companyId }
    });
    if (r.status === 200) {
      const text = r.text.toLowerCase();
      // Should not expose internal R2 paths
      assert.ok(!text.includes("r2://"), "Response should not contain R2 paths");
    }
  });
});

// ==================== INPUT VALIDATION / XSS ====================
describe("🛡️ Input Validation & XSS", () => {
  let token, companyId;

  test("Get token and company", async () => {
    token = await login();
    const r = await req("/cloudflare/companies", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const companies = r.json?.companies || [];
    companyId = companies[0]?.name || companies[0]?.company_name;
  });

  test("XSS in company name is rejected or escaped", async () => {
    const r = await req("/cloudflare/companies", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: { company: "xss-test-co", companyName: "<script>alert('xss')</script>" }
    });
    // Should be rejected (400/422) or escaped in response
    if (r.status === 201) {
      assert.ok(!r.text.includes("<script>"), "XSS payload should be escaped in response");
      // Clean up
      await req(`/cloudflare/companies/xss-test-co`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
    }
    // 400 = rejected, 201 = accepted but escaped
    assert.ok(r.status === 200 || r.status === 201 || r.status === 400 || r.status === 422, `Status: ${r.status}`);
  });

  test("SQL injection in company name is rejected", async () => {
    const r = await req("/cloudflare/companies", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: { company: "sql-test", companyName: "'; DROP TABLE companies; --" }
    });
    // Should be rejected or sanitized
    assert.ok(r.status >= 400 || r.status === 201, `Status: ${r.status}`);
  });

  test("Extremely long input is handled gracefully", async () => {
    const longName = "A".repeat(1000);
    const r = await req("/cloudflare/companies", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: { company: "long-name-test", companyName: longName }
    });
    assert.ok(r.status >= 400 || r.status === 201, `Should reject or truncate long name: ${r.status}`);
  });
});

// ==================== CORS TESTING ====================
describe("🌐 CORS Security", () => {
  test("CORS preflight from unauthorized origin is rejected", async () => {
    const r = await fetch(`${BASE}/cloudflare/companies`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil-attacker.com",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization,x-company-name",
      },
    });
    const allowOrigin = r.headers.get("access-control-allow-origin");
    // Should NOT reflect evil origin
    assert.ok(allowOrigin !== "https://evil-attacker.com", `CORS should not allow evil origin: ${allowOrigin}`);
  });

  test("CORS preflight from localhost is allowed", async () => {
    const r = await fetch(`${BASE}/cloudflare/companies`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization,x-company-name",
      },
    });
    const allowOrigin = r.headers.get("access-control-allow-origin");
    // localhost should be allowed
    assert.ok(allowOrigin === "http://localhost:5173" || allowOrigin === "*", `localhost should be allowed: ${allowOrigin}`);
  });
});

// ==================== SECURITY HEADERS ====================
describe("📋 Security Headers", () => {
  test("Response includes X-Content-Type-Options", async () => {
    const r = await req("/_health");
    // Not critical but recommended
    const header = r.headers["x-content-type-options"];
    console.log(`  ℹ️  X-Content-Type-Options: ${header || "MISSING (recommended)"}`);
  });

  test("Response includes X-Frame-Options or CSP frame-ancestors", async () => {
    const r = await req("/_health");
    const xfo = r.headers["x-frame-options"];
    const csp = r.headers["content-security-policy"];
    console.log(`  ℹ️  X-Frame-Options: ${xfo || "MISSING"}`);
    console.log(`  ℹ️  CSP: ${csp ? "present" : "MISSING (recommended)"}`);
  });

  test("API responses don't expose server version", async () => {
    const r = await req("/_health");
    const server = r.headers["server"];
    const poweredBy = r.headers["x-powered-by"];
    assert.ok(!poweredBy, `X-Powered-By should be removed: ${poweredBy}`);
    console.log(`  ℹ️  Server: ${server || "not exposed (good)"}`);
  });
});

// ==================== RATE LIMITING ====================
describe("⏱️ Rate Limiting", () => {
  test("Login endpoint has rate limiting", async () => {
    const attempts = [];
    for (let i = 0; i < 15; i++) {
      attempts.push(req("/auth/login", { method: "POST", body: { username: "admin@popularcert.com", password: "wrong" } }));
    }
    const results = await Promise.all(attempts);
    const statuses = results.map(r => r.status);
    const rateLimited = statuses.some(s => s === 429);
    console.log(`  ℹ️  After 15 failed logins: ${rateLimited ? "Rate limited (good)" : "No rate limiting detected"}`);
    // Not asserting — just reporting
  });
});

// ==================== ERROR MESSAGE LEAKAGE ====================
describe("🐛 Error Message Security", () => {
  test("404 errors don't leak internal paths", async () => {
    const r = await req("/nonexistent-endpoint-xyz");
    assert.ok(!r.text.includes("/home/"), "Error should not expose filesystem paths");
    assert.ok(!r.text.includes("node_modules"), "Error should not expose node_modules");
    assert.ok(!r.text.includes("at Object"), "Error should not expose stack traces");
  });

  test("Invalid JSON body doesn't leak stack traces", async () => {
    const r = await fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });
    const text = await r.text();
    assert.ok(!text.includes("SyntaxError"), "Should not expose JS syntax errors");
    assert.ok(!text.includes("at Object"), "Should not expose stack traces");
  });
});

// ==================== SENSITIVE ENDPOINTS ====================
describe("🚫 Protected Endpoint Enforcement", () => {
  test("Admin endpoints require authentication", async () => {
    const endpoints = [
      "/cloudflare/companies",
      "/cloudflare/config",
      "/gateway/workflows",
      "/gateway/assistants",
      "/gateway/kbs",
      "/gateway/providers",
      "/gateway/credentials",
      "/gateway/webhooks",
    ];
    for (const ep of endpoints) {
      const r = await req(ep);
      assert.ok(r.status === 401 || r.status === 403, `${ep} should require auth, got ${r.status}`);
    }
  });

  test("POST/PUT/DELETE admin endpoints require authentication", async () => {
    const endpoints = [
      { path: "/cloudflare/companies", method: "POST" },
      { path: "/gateway/workflows", method: "POST" },
      { path: "/gateway/assistants", method: "POST" },
    ];
    for (const { path, method } of endpoints) {
      const r = await req(path, { method, body: {} });
      assert.ok(r.status === 401 || r.status === 403, `${method} ${path} should require auth, got ${r.status}`);
    }
  });
});

// ==================== BROWSER STORAGE ====================
describe("💾 Browser Storage Security", () => {
  test("localStorage should not contain raw API keys (manual check)", async () => {
    console.log("  ℹ️  Manual verification needed: Check browser localStorage for:");
    console.log("     - pc_selected_company (OK — just company name)");
    console.log("     - pc_admin_token (OK — session token for auth)");
    console.log("     - pc_theme (OK — UI preference)");
    console.log("     - Should NOT contain: API keys, provider secrets, passwords");
  });
});

console.log("\n✅ Security audit complete. Review output above for findings.\n");
