import "dotenv/config";
import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { testStream } from "./scripts/streamTest.js";
import cronRoutes from "./routes/cron.js";
import cloudflareRoutes from "./routes/cloudflare.js";
import authRoutes from "./routes/auth.js";
import logsRoutes from "./routes/logs.js";
import gatewayRoutes from "./mysql/gateway-router.js";
import { createAskRouter, aiLimiter } from "./routes/ask.js";
import { env } from "./env.js";
import { requireAdmin, verifyToken, extractToken, AUTH_ENABLED } from "./auth.js";
import { initConfig, runtimeConfig, resolveCreds } from "./config/index.js";
import { isAppError } from "./shared/errors.js";
import { isAllowedOrigin } from "./utils/request-context.js";
import requestLogger from "./utils/request-logger.js";
import { runHealthCheck, runDetailedHealthCheck } from "./utils/health-check.js";
import { migrate } from "./mysql/migrate.js";
import swaggerUi from "swagger-ui-express";
import openapi from "./docs/openapi.js";

// --------------------------
// 🔹 APP & CONFIG
// --------------------------
const app = express();
const PORT = parseInt(env.PORT, 10);

// Trust proxy: with `true` every client controls X-Forwarded-For, so req.ip
// (and therefore every rate limiter key) can be rotated per request. Keep the
// backwards-compatible default outside production, but set an explicit hop
// count ("1") or proxy IPs (comma-separated) in production via TRUST_PROXY.
function parseTrustProxy(value) {
  if (value === undefined || value === "" || value === "true") return true;
  if (value === "false") return false;
  const n = Number(value);
  if (Number.isInteger(n) && n > 0) return n;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
const trustProxy = parseTrustProxy(env.TRUST_PROXY);
app.set("trust proxy", trustProxy);
if (trustProxy === true && env.NODE_ENV === "production") {
  console.warn(
    "⚠️  TRUST_PROXY=true in production — rate-limit keys can be spoofed via X-Forwarded-For. Set TRUST_PROXY to your proxy hop count (e.g. 1) or its IPs."
  );
}

// Served admin UI (built with `npm run build` inside web/)
const WEB_DIR = path.resolve(process.cwd(), "web", "dist");
const WEB_INDEX = path.join(WEB_DIR, "index.html");
const hasWeb = fs.existsSync(WEB_INDEX);

// --------------------------
// 🔹 MIDDLEWARE
// --------------------------
app.set("trust proxy", true);

app.use(cors({
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-WP-Nonce", "X-Company-Name", "X-Api-Key", "Authorization", "X-Auth-Token"],
}));

app.use(express.json({ limit: "1mb" }));

// --------------------------
// 🔹 REQUEST LOGGING
// Structured JSON logging for every request — file + console (dev).
app.use(requestLogger);

// --------------------------
// 🔹 RATE LIMITING
// Protects AI endpoints (costly) and public routes from abuse. Admin routes
// are deliberately NOT rate-limited: authenticated admin sessions bypass the
// global baseline too, so heavy portal/catalog work never trips a 429. The
// AI tier limiter (routes/ask.js) and the login brute-force guard still apply.
// --------------------------

// Global baseline: 100 req/min across all routes
const globalWindowMs = 60 * 1000; // 1 minute
const globalMax = 100;

const limiterDefaults = {
  standardHeaders: true,
  legacyHeaders: true,
  validate: { trustProxy: false },
};

const globalLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: globalWindowMs,
  max: globalMax,
  message: {
    success: false,
    error: "Too many requests. Please slow down and try again later.",
  },
});

// Apply global limiter to every request (excluding health check and
// authenticated admin sessions). Note: must use a wrapper function instead of
// a regex path pattern because Express 5 does not apply middleware correctly
// when passed via app.use(regex, fn).
app.use((req, res, next) => {
  if (req.path === "/") return next();
  if (AUTH_ENABLED && verifyToken(extractToken(req))) return next();
  return globalLimiter(req, res, next);
});

// Mount routes
app.use("/cloudflare", requireAdmin, cronRoutes);
app.use("/cloudflare", requireAdmin, cloudflareRoutes);
app.use("/auth", authRoutes);
app.use("/logs", requireAdmin, logsRoutes);
app.use("/gateway", requireAdmin, gatewayRoutes);
app.use(createAskRouter());

// --------------------------
// 🔹 API DOCS (Swagger UI)
// Serves the OpenAPI spec as a browsable UI at /api-docs and as raw JSON at
// /api-docs/openapi.json (importable into Postman/insomnia/codegen).
// Docs open in a new tab, which cannot set request headers — the portal
// appends ?token=<session> to the URL, and the request interceptor re-attaches
// the token (from the URL or the portal's localStorage) to every "Try it out"
// request so authorized calls work from inside the docs page.
// --------------------------
app.get("/api-docs/openapi.json", requireAdmin, (req, res) => res.json(openapi));
app.use(
  "/api-docs",
  requireAdmin,
  swaggerUi.serve,
  swaggerUi.setup(openapi, {
    swaggerOptions: {
      persistAuthorization: true,
      requestInterceptor: (req) => {
        let token = "";
        try {
          token = window.localStorage.getItem("pc_admin_token") || "";
        } catch {
          /* localStorage unavailable */
        }
        if (!token) {
          token = new URLSearchParams(window.location.search).get("token") || "";
        }
        if (token) req.headers.Authorization = `Bearer ${token}`;
        return req;
      },
    },
  })
);

// --------------------------
// 🔹 HEALTH CHECK
// Serves the admin portal for browsers (Accept: text/html) and JSON for API clients.
// --------------------------
app.get("/", (req, res) => {
  const wantsHtml = (req.headers.accept || "").includes("text/html");
  if (hasWeb && wantsHtml) {
    res.setHeader("Cache-Control", "no-cache");
    return res.sendFile(WEB_INDEX);
  }
  res.json({
    success: true,
    status: "ok",
    message: "PopularCert RAG API is active ",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

app.get("/_health", async (_req, res) => {
  try {
    const report = await runHealthCheck();
    const httpStatus = report.status === "unhealthy" ? 503 : 200;
    res.status(httpStatus).json({ success: report.status !== "unhealthy", ...report });
  } catch (err) {
    console.error("❌ Health check failed:", err);
    res.status(503).json({ success: false, status: "error", error: err.message });
  }
});

app.get("/_health/detailed", async (_req, res) => {
  try {
    const report = await runDetailedHealthCheck();
    const httpStatus = report.status === "unhealthy" ? 503 : 200;
    res.status(httpStatus).json({ success: report.status !== "unhealthy", ...report });
  } catch (err) {
    console.error("❌ Detailed health check failed:", err);
    res.status(503).json({ success: false, status: "error", error: err.message });
  }
});

// --------------------------
// 🔹 STATIC ASK (JSON Response)
// --------------------------
// --------------------------
// 🔹 STREAM TEST API
// Admin-only: this endpoint triggers a real (billable) Cloudflare AI call and
// streams raw error text, so it must never be publicly reachable.
// --------------------------
app.post("/test", requireAdmin, aiLimiter, async (req, res) => {
  try {
    const prompt = req.body?.prompt || "Hello";

    // Cloudflare credentials now come from the company's stored config
    // (MySQL/SQLite), not env vars. Use the x-company-name header if it
    // matches a known company, else fall back to the first company.
    const fromHeader = req.headers["x-company-name"];
    const companyName =
      (fromHeader && runtimeConfig.COMPANIES[fromHeader] ? fromHeader : null) ||
      Object.keys(runtimeConfig.COMPANIES)[0];

    if (!companyName) {
      throw new Error("No company configured — create one first");
    }
    const creds = resolveCreds(companyName);

    // --------------------------
    // 🔹 SSE Headers
    // --------------------------
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // --------------------------
    // 🔹 Stream via an output channel — no process.stdout hijacking.
    // Each token is framed as a data: event; errors propagate to the catch
    // below and are framed as an error event.
    // --------------------------
    await testStream(prompt, (token) => {
      res.write(`data: ${token}\n\n`);
    }, creds);

    // End signals for the frontend listener
    res.write("event: done\ndata: END\n\n");
    res.end();

  } catch (err) {
    console.error("❌ Stream API Error:", err.message);

    res.write(`event: error\ndata: ${err.message}\n\n`);
    res.end();
  }
});

// --------------------------
// 🔹 STATIC ADMIN PORTAL
// Serves the built React admin UI from web/dist on the same server.
// --------------------------
if (hasWeb) {
  // HTML shell must always be revalidated — hashed asset filenames only help
  // if index.html itself is never served stale (browsers otherwise apply
  // heuristic caching and users get stuck on old app versions after deploys).
  app.use(express.static(WEB_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    },
  }));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/cloudflare") || req.path.startsWith("/ask") || req.path.startsWith("/_health")) return next();
    if (!(req.headers.accept || "").includes("text/html")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(WEB_INDEX);
  });
}

// --------------------------
// 🔹 ERROR HANDLER
// Catches errors thrown by route handlers (typed AppError subclasses from
// shared/errors.js). Operational errors expose the message to the client;
// programming bugs return a generic 500 to avoid leaking internals.
// --------------------------
app.use((err, _req, res, _next) => {
  if (isAppError(err)) {
    const body = { success: false, error: err.message };
    if (err.code) body.code = err.code;
    if (err.errors) body.errors = err.errors;
    return res.status(err.status).json(body);
  }
  console.error("❌ Unhandled error:", err);
  if (!res.headersSent) {
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// --------------------------
// 🔹 404 CATCH-ALL
// --------------------------
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// --------------------------
// 🔹 START SERVER
// --------------------------
try {
  await initConfig();
} catch (err) {
  console.error(`❌ Failed to initialize config (${env.CONFIG_STORE}): ${err.message}`);
  process.exit(1);
}

// Auto-apply pending MySQL migrations on startup (safe — idempotent)
if (process.env.CONFIG_STORE === "mysql") {
  try {
    await migrate();
  } catch (err) {
    console.error("⚠️  Auto-migration failed:", err.message);
  }
}
app.listen(PORT, (err) => {
  if (err) {
    console.error(`❌ Failed to start server on port ${PORT}: ${err.message}`);
    console.error("   Another server may already be running on this port.");
    process.exit(1);
  }
  console.log(`
🚀 PopularCert API Started
----------------------------
Local:     http://localhost:${PORT}
Endpoints: POST /ask
           POST /ask-stream
  `);
});
