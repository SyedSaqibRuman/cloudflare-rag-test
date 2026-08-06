// Admin authentication for the admin portal and /cloudflare/* routes.
// Credentials come from .env (ADMIN_USERNAME / ADMIN_PASSWORD).
// If they are unset, admin auth is disabled and every route stays open
// (backwards compatible with the pre-login behavior).
import crypto from "node:crypto";
import { env } from "./env.js";

export const AUTH_ENABLED = Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD);

const SECRET = env.ADMIN_SECRET || env.ADMIN_PASSWORD || "insecure-dev-only-secret";
const TTL_SECONDS = Math.max(1, parseInt(env.ADMIN_TOKEN_TTL_HOURS || "12", 10)) * 3600;

export const TOKEN_TTL_SECONDS = TTL_SECONDS;

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function checkCredentials(username, password) {
  if (!AUTH_ENABLED) return false;
  return safeEqual(username, env.ADMIN_USERNAME) && safeEqual(password, env.ADMIN_PASSWORD);
}

export function signToken(username) {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data?.u || !data?.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

// Accepts the token via `x-auth-token` or `Authorization: Bearer <token>`.
// Falls back to the `pc_admin_token` cookie — the portal opens /api-docs in a
// new tab, whose page and asset requests can only carry a cookie (the cookie
// is path-scoped to /api-docs and SameSite=Lax, so it never leaves that route).
export function extractToken(req) {
  const header = req.headers["x-auth-token"];
  if (typeof header === "string" && header) return header;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7);
  const cookie = req.headers.cookie;
  if (typeof cookie === "string") {
    const m = cookie.match(/(?:^|;\s*)pc_admin_token=([^;]+)/);
    if (m) {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    }
  }
  return null;
}

export function requireAdmin(req, res, next) {
  if (!AUTH_ENABLED) return next();
  const token = extractToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({
      success: false,
      error: "Admin authentication required. Log in via the admin portal or POST /auth/login.",
    });
  }
  next();
}
