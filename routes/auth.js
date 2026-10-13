import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  AUTH_ENABLED,
  TOKEN_TTL_SECONDS,
  authConfigured,
  checkCredentials,
  signToken,
  verifyToken,
  extractToken,
} from "../auth.js";
import { isClerkConfigured, verifyClerkCredentials } from "../auth-clerk.js";

const router = Router();

// Brute-force protection on the login endpoint (on top of the global limiter).
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: true,
  validate: { trustProxy: false },
  message: { success: false, error: "Too many login attempts. Try again in a minute." },
});

// --------------------------
// 🔹 LOGIN
// Two backends, mutually exclusive at runtime:
//   - CLERK_SECRET_KEY set    → credentials are verified against Clerk's
//     Backend API (users are managed in the Clerk dashboard). Clerk is
//     authoritative: wrong credentials → 401, Clerk outage → 503. No silent
//     fallback to the .env account (an outage must not bypass Clerk).
//   - CLERK_SECRET_KEY unset  → legacy .env ADMIN_USERNAME/ADMIN_PASSWORD.
// Either way a successful login mints the same HMAC session token.
// --------------------------
router.post("/login", loginLimiter, async (req, res) => {
  if (!authConfigured()) {
    return res.status(503).json({
      success: false,
      error:
        "Admin credentials are not configured. Set CLERK_SECRET_KEY (Clerk login) or ADMIN_USERNAME and ADMIN_PASSWORD (.env login) in .env, then restart the server.",
    });
  }
  const { username, password } = req.body || {};
  if (typeof username !== "string" || !username || typeof password !== "string" || !password) {
    return res.status(400).json({ success: false, error: "Username and password are required." });
  }

  if (isClerkConfigured()) {
    const result = await verifyClerkCredentials(username.trim(), password);
    if (result.ok) {
      return res.json({
        success: true,
        token: signToken(result.email),
        expiresIn: TOKEN_TTL_SECONDS,
        provider: "clerk",
      });
    }
    if (result.status === "error") {
      console.error(`❌ Clerk login unavailable: ${result.message}`);
      return res.status(503).json({ success: false, error: result.message });
    }
    return res.status(401).json({ success: false, error: result.message });
  }

  if (!checkCredentials(username, password)) {
    return res.status(401).json({ success: false, error: "Invalid username or password." });
  }
  res.json({ success: true, token: signToken(username), expiresIn: TOKEN_TTL_SECONDS });
});

// --------------------------
// 🔹 SESSION CHECK
// Tells the portal whether a valid admin session exists. When admin auth is
// not configured, it reports authenticated so the portal stays open.
// --------------------------
router.get("/me", (req, res) => {
  if (!AUTH_ENABLED) {
    return res.json({ success: true, authenticated: true, bypass: true });
  }
  const payload = verifyToken(extractToken(req));
  if (!payload) {
    return res.status(401).json({ success: false, authenticated: false, error: "Not authenticated." });
  }
  res.json({
    success: true,
    authenticated: true,
    username: payload.u,
    provider: isClerkConfigured() ? "clerk" : "env",
  });
});

// --------------------------
// 🔹 LOGOUT
// Tokens are stateless (HMAC-signed) — the client discards it.
// --------------------------
router.post("/logout", (req, res) => {
  res.json({ success: true });
});

export default router;
