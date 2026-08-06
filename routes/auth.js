import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  AUTH_ENABLED,
  TOKEN_TTL_SECONDS,
  checkCredentials,
  signToken,
  verifyToken,
  extractToken,
} from "../auth.js";

const router = Router();

// Brute-force protection on the login endpoint (on top of the global limiter).
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: { success: false, error: "Too many login attempts. Try again in a minute." },
});

// --------------------------
// 🔹 LOGIN
// --------------------------
router.post("/login", loginLimiter, (req, res) => {
  if (!AUTH_ENABLED) {
    return res.status(503).json({
      success: false,
      error: "Admin credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env, then restart the server.",
    });
  }
  const { username, password } = req.body || {};
  if (typeof username !== "string" || !username || typeof password !== "string" || !password) {
    return res.status(400).json({ success: false, error: "Username and password are required." });
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
  res.json({ success: true, authenticated: true, username: payload.u });
});

// --------------------------
// 🔹 LOGOUT
// Tokens are stateless (HMAC-signed) — the client discards it.
// --------------------------
router.post("/logout", (req, res) => {
  res.json({ success: true });
});

export default router;
