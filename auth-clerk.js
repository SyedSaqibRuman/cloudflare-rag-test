// Clerk-backed admin authentication (opt-in).
//
// When CLERK_SECRET_KEY is set in .env, POST /auth/login verifies the
// submitted identifier (email or username) + password against Clerk's Backend
// API (user lookup + verify_password). Users are created and managed in the
// Clerk dashboard — this server never stores or sees their credentials beyond
// the login request.
//
// On success the request proceeds exactly like an env-credential login: the
// server mints its own HMAC session token (auth.js). No Clerk session or JWT
// ever reaches the browser — requireAdmin and the portal keep working
// unchanged.
//
// Failure semantics (deliberate):
//   - Clerk says the credentials are wrong  → 401. No env fallback while Clerk
//     is configured: the .env account is a separate break-glass credential
//     (see below), and any Clerk-managed user must be validated by Clerk —
//     a disabled Clerk user must not get in some other way.
//   - Clerk is unreachable / misbehaving   → 503 (do NOT silently fall back
//     to env credentials: an outage would otherwise let attackers bypass
//     Clerk-side rate limits and audit logging).
//   - CLERK_SECRET_KEY unset               → env-credential login (backwards
//     compatible default; auth.js's AUTH_ENABLED covers both).
//
// Reads CLERK_* at call time (not import time) so tests can toggle config in
// their own process. No new dependencies — raw fetch, like the rest of the
// Cloudflare-facing code.

// Overridable for tests and self-hosted proxies.
const CLERK_API_BASE = process.env.CLERK_API_BASE || "https://api.clerk.com/v1";

export function isClerkConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

/**
 * Verify an identifier + password against Clerk's Backend API.
 *
 * Two-step flow (documented Clerk Backend API):
 *   1. GET /v1/users?email_address=… (then ?username=…) → find the user
 *   2. POST /v1/users/:id/verify_password { password } → verdict
 *
 * @param {string} identifier  Email address or username of the Clerk user
 * @param {string} password    Plaintext password (only ever sent to Clerk over TLS)
 * @param {object} [opts]
 * @param {Function} [opts.fetchImpl]   Injectable fetch for tests
 * @param {string[]} [opts.allowedEmails] Optional allowlist overriding CLERK_ALLOWED_EMAILS
 * @returns {Promise<{ ok: true, userId: string|null, email: string } |
 *                    { ok: false, status: "invalid"|"error"|"unconfigured", message: string }>}
 */
export async function verifyClerkCredentials(identifier, password, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    return { ok: false, status: "unconfigured", message: "Clerk is not configured (CLERK_SECRET_KEY is unset)." };
  }

  const headers = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  try {
    // 🔹 Step 1: resolve the identifier to a user (email first, then username).
    let user = null;
    for (const param of ["email_address", "username"]) {
      const res = await fetchImpl(
        `${CLERK_API_BASE}/users?${param}=${encodeURIComponent(identifier)}&limit=1`,
        { method: "GET", headers }
      );
      if (!res.ok) {
        // Lookup endpoint down/unauthorized = temporary, not "invalid creds".
        if (res.status >= 500 || res.status === 401 || res.status === 403) {
          return {
            ok: false,
            status: "error",
            message: `Clerk authentication is temporarily unavailable (user lookup HTTP ${res.status}).`,
          };
        }
        continue; // other 4xx: try the next identifier type
      }
      const list = await res.json().catch(() => null);
      const arr = Array.isArray(list) ? list : list?.data || [];
      if (arr.length) {
        user = arr[0];
        break;
      }
    }
    if (!user?.id) {
      // Same message as a wrong password — never leak which accounts exist.
      return { ok: false, status: "invalid", message: "Invalid username or password." };
    }

    // The portal login form has no second-factor step — reject 2FA users with
    // a clear message instead of silently accepting a half-verified login.
    if (user.two_factor_enabled) {
      return {
        ok: false,
        status: "invalid",
        message: "This account requires a second factor, which the portal login does not support yet.",
      };
    }

    // 🔹 Step 2: verify the password server-side.
    const vpRes = await fetchImpl(
      `${CLERK_API_BASE}/users/${encodeURIComponent(user.id)}/verify_password`,
      {
        method: "POST",
        headers,
        body: new URLSearchParams({ password }),
      }
    );
    if (!vpRes.ok) {
      const err = await vpRes.json().catch(() => null);
      const code = err?.errors?.[0]?.code || "";
      if (code === "incorrect_password" || code === "resource_not_found") {
        return { ok: false, status: "invalid", message: "Invalid username or password." };
      }
      // A non-JSON 404 (e.g. the plaintext "404 page not found" Clerk returns
      // for a route that doesn't exist) is an API-shape problem, not bad
      // credentials — surface it as a temporary error (503 to the client),
      // never as "wrong password".
      if (!err && vpRes.status === 404) {
        return {
          ok: false,
          status: "error",
          message: `Clerk authentication is temporarily unavailable (verify_password HTTP ${vpRes.status}).`,
        };
      }
      return {
        ok: false,
        status: vpRes.status >= 500 ? "error" : "invalid",
        message: err?.errors?.[0]?.long_message || `Clerk sign-in failed (HTTP ${vpRes.status}).`,
      };
    }
    const verified = await vpRes.json().catch(() => null);
    if (verified && verified.verified === false) {
      return { ok: false, status: "invalid", message: "Invalid username or password." };
    }

    // 🔹 Identity: prefer the primary verified email, then any verified email.
    const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
    const primary =
      emails.find((e) => e.id === user.primary_email_address_id) ||
      emails.find((e) => e.verification?.status === "verified") ||
      null;
    const email = primary?.email_address || identifier;

    // 🔹 Optional allowlist (comma/space separated emails). Empty → all Clerk users.
    const allowedRaw = opts.allowedEmails ?? process.env.CLERK_ALLOWED_EMAILS ?? "";
    const allowed = String(allowedRaw)
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length && !allowed.includes(String(email).toLowerCase())) {
      return { ok: false, status: "invalid", message: "This account is not authorized for the admin portal." };
    }

    return { ok: true, userId: user.id, email };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      message: `Clerk authentication is temporarily unavailable (${err.message}).`,
    };
  }
}
