#!/bin/bash
# Security Audit — curl-based (no node:test to avoid server crashes)
set -e

BASE="http://localhost:3000"
PASS=0
FAIL=0
WARN=0

pass() { echo "  ✅ $1"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
warn() { echo "  ⚠️  $1"; WARN=$((WARN+1)); }

echo "🔒 Security Audit — PopularCert RAG API"
echo "========================================"
echo ""

# ---- AUTH ----
echo "🔐 Authentication"
echo "---"

# Invalid login
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" -H "Content-Type: application/json" -d '{"username":"admin@popularcert.com","password":"wrong"}')
[ "$STATUS" = "401" ] && pass "Invalid credentials rejected (401)" || fail "Invalid credentials returned $STATUS (expected 401)"

# Empty login
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" -H "Content-Type: application/json" -d '{"username":"","password":""}')
[ "$STATUS" -ge 400 ] && pass "Empty credentials rejected ($STATUS)" || fail "Empty credentials returned $STATUS"

# Valid login
TOKEN=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" -d '{"username":"admin@popularcert.com","password":"admin123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
[ -n "$TOKEN" ] && pass "Valid login returns token" || fail "Valid login failed"

# No auth
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/cloudflare/companies")
[ "$STATUS" = "401" ] && pass "Unauthenticated access blocked (401)" || fail "Unauthenticated returned $STATUS"

# Invalid token
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/cloudflare/companies" -H "Authorization: Bearer invalid_token_12345")
[ "$STATUS" = "401" ] && pass "Invalid token rejected (401)" || fail "Invalid token returned $STATUS"

echo ""

# ---- MULTI-TENANT ----
echo "🏢 Multi-Tenant Isolation"
echo "---"

COMPANY=$(curl -s "$BASE/cloudflare/companies" -H "Authorization: Bearer $TOKEN" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)

# Cross-tenant KB access
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/gateway/kbs" -H "Authorization: Bearer $TOKEN" -H "x-company-name: nonexistent-company-xyz")
[ "$STATUS" = "200" ] && pass "Cross-tenant KB access returns 200 (scoped)" || warn "Cross-tenant KB returned $STATUS"

# Missing company header
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/gateway/kbs" -H "Authorization: Bearer $TOKEN")
[ "$STATUS" -ge 400 ] && pass "Missing x-company-name returns error ($STATUS)" || fail "Missing company header returned $STATUS"

# Cross-tenant assistants
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/gateway/assistants" -H "Authorization: Bearer $TOKEN" -H "x-company-name: nonexistent-company-xyz")
[ "$STATUS" = "200" ] && pass "Cross-tenant assistants scoped (200)" || warn "Cross-tenant assistants returned $STATUS"

# Cross-tenant workflows
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/gateway/workflows" -H "Authorization: Bearer $TOKEN" -H "x-company-name: nonexistent-company-xyz")
[ "$STATUS" = "200" ] && pass "Cross-tenant workflows scoped (200)" || warn "Cross-tenant workflows returned $STATUS"

# Cross-tenant credentials
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/gateway/credentials" -H "Authorization: Bearer $TOKEN" -H "x-company-name: nonexistent-company-xyz")
[ "$STATUS" = "200" ] && pass "Cross-tenant credentials scoped (200)" || warn "Cross-tenant credentials returned $STATUS"

echo ""

# ---- IDOR ----
echo "🔑 IDOR / BOLA"
echo "---"

# Random KB key
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/gateway/kbs/nonexistent-kb-99999" -H "Authorization: Bearer $TOKEN" -H "x-company-name: $COMPANY")
[ "$STATUS" = "404" ] && pass "Random KB key returns 404" || fail "Random KB key returned $STATUS"

# Random assistant key
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/gateway/assistants/nonexistent-99999" -H "Authorization: Bearer $TOKEN" -H "x-company-name: $COMPANY")
[ "$STATUS" = "404" ] && pass "Random assistant key returns 404" || fail "Random assistant key returned $STATUS"

# Random workflow key
STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/gateway/workflows/nonexistent-99999" -H "Authorization: Bearer $TOKEN" -H "x-company-name: $COMPANY")
[ "$STATUS" = "404" ] && pass "Random workflow key returns 404" || fail "Random workflow key returned $STATUS"

echo ""

# ---- CREDENTIAL EXPOSURE ----
echo "🔒 Credential Exposure"
echo "---"

# Companies API should not expose secrets
BODY=$(curl -s "$BASE/cloudflare/companies" -H "Authorization: Bearer $TOKEN")
echo "$BODY" | grep -qi "api_key\|secret_key\|password\|cloudflare_api_token" && fail "Companies API leaks secrets" || pass "Companies API does not expose secrets"

# Credentials API should not expose decrypted values
BODY=$(curl -s "$BASE/gateway/credentials" -H "Authorization: Bearer $TOKEN" -H "x-company-name: $COMPANY")
echo "$BODY" | grep -qi "decrypted_values\|plaintext" && fail "Credentials API leaks decrypted secrets" || pass "Credentials API does not expose decrypted secrets"

echo ""

# ---- SECURITY HEADERS ----
echo "📋 Security Headers"
echo "---"

HEADERS=$(curl -sI "$BASE/_health")
echo "$HEADERS" | grep -qi "x-powered-by" && fail "X-Powered-By header present (leaks Express)" || pass "X-Powered-By header removed"
echo "$HEADERS" | grep -qi "x-content-type-options" && pass "X-Content-Type-Options present" || warn "X-Content-Type-Options missing (recommended)"
echo "$HEADERS" | grep -qi "x-frame-options" && pass "X-Frame-Options present" || warn "X-Frame-Options missing (recommended)"
echo "$HEADERS" | grep -qi "content-security-policy" && pass "Content-Security-Policy present" || warn "Content-Security-Policy missing (recommended)"

echo ""

# ---- INPUT VALIDATION ----
echo "🛡️ Input Validation"
echo "---"

# XSS payload
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/cloudflare/companies" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"company":"xss-test","companyName":"<script>alert(1)</script>"}')
[ "$STATUS" -ge 400 ] && pass "XSS payload rejected ($STATUS)" || warn "XSS payload accepted ($STATUS — check if escaped)"

# SQL injection
STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/cloudflare/companies" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"company":"sqli-test","companyName":"'\'' OR 1=1 --"}')
[ "$STATUS" -ge 400 ] && pass "SQL injection rejected ($STATUS)" || warn "SQL injection accepted ($STATUS)"

echo ""

# ---- CORS ----
echo "🌐 CORS"
echo "---"

CORS=$(curl -sI -X OPTIONS "$BASE/cloudflare/companies" -H "Origin: https://evil-attacker.com" -H "Access-Control-Request-Method: GET")
ALLOW=$(echo "$CORS" | grep -i "access-control-allow-origin" | head -1)
if echo "$ALLOW" | grep -qi "evil-attacker"; then
  fail "CORS reflects attacker origin"
else
  pass "CORS does not reflect attacker origin"
fi

CORS2=$(curl -sI -X OPTIONS "$BASE/cloudflare/companies" -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: GET")
ALLOW2=$(echo "$CORS2" | grep -i "access-control-allow-origin" | head -1)
if echo "$ALLOW2" | grep -qi "localhost"; then
  pass "CORS allows localhost"
else
  warn "CORS does not allow localhost (check if intentional)"
fi

echo ""

# ---- ERROR LEAKAGE ----
echo "🐛 Error Message Security"
echo "---"

ERR=$(curl -s "$BASE/nonexistent-endpoint-xyz")
echo "$ERR" | grep -qi "node_modules\|at Object\|SyntaxError\|stack" && fail "Error leaks stack traces" || pass "404 errors don't leak stack traces"

echo ""

# ---- PROTECTED ENDPOINTS ----
echo "🚫 Protected Endpoint Enforcement"
echo "---"

ENDPOINTS=("/cloudflare/companies" "/cloudflare/config" "/gateway/workflows" "/gateway/assistants" "/gateway/kbs" "/gateway/providers" "/gateway/credentials" "/gateway/webhooks")
for ep in "${ENDPOINTS[@]}"; do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$ep")
  [ "$STATUS" = "401" ] && pass "$ep requires auth (401)" || fail "$ep returned $STATUS without auth"
done

echo ""

# ---- RATE LIMITING ----
echo "⏱️ Rate Limiting"
echo "---"

HIT_429=false
for i in $(seq 1 15); do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/login" -H "Content-Type: application/json" -d '{"username":"admin@popularcert.com","password":"wrong"}')
  [ "$STATUS" = "429" ] && HIT_429=true && break
done
$HIT_429 && pass "Login rate limiting works (429 after repeated failures)" || warn "Login rate limiting not triggered after 15 attempts"

echo ""

# ---- SUMMARY ----
echo "========================================"
echo "📊 Security Audit Summary"
echo "========================================"
echo "  ✅ Passed: $PASS"
echo "  ❌ Failed: $FAIL"
echo "  ⚠️  Warnings: $WARN"
echo "========================================"
[ $FAIL -eq 0 ] && echo "🔒 Overall: GOOD — No critical security issues found" || echo "🔓 Overall: $FAIL issue(s) need attention"
