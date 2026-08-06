import "dotenv/config";
import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { testStream } from "./streamTest.js";
import cronRoutes from "./routes/cron.js";
import cloudflareRoutes from "./routes/cloudflare.js";
import authRoutes from "./routes/auth.js";
import logsRoutes from "./routes/logs.js";
import gatewayRoutes from "./mysql/gateway-router.js";
import { createAskRouter } from "./routes/ask.js";
import { env } from "./env.js";
import { requireAdmin } from "./auth.js";
import { isAllowedOrigin } from "./utils/request-context.js";
import swaggerUi from "swagger-ui-express";
import openapi from "./docs/openapi.js";

// --------------------------
// 🔹 APP & CONFIG
// --------------------------
const app = express();
const PORT = parseInt(env.PORT, 10);

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
// 🔹 RATE LIMITING
// Protects AI endpoints (costly) and admin routes (sensitive) from abuse.
// Tune via env vars — defaults are conservative.
// --------------------------

// Global baseline: 100 req/min across all routes
const globalWindowMs = 60 * 1000; // 1 minute
const globalMax = parseInt(env.RATE_LIMIT_GLOBAL, 10);

// Strict limit for admin endpoints (POST/PUT/DELETE operations):
const adminWindowMs = 60 * 1000; // 1 minute
const adminMax = parseInt(env.RATE_LIMIT_ADMIN, 10);

const limiterDefaults = {
  standardHeaders: true,
  legacyHeaders: false,
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

const adminLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: adminWindowMs,
  max: adminMax,
  message: {
    success: false,
    error: "Admin request limit reached. Please slow down.",
  },
});

// Apply global limiter to every request (excluding health check)
// Note: Must use a wrapper function instead of a regex path pattern because
// Express 5 does not apply middleware correctly when passed via app.use(regex, fn).
app.use((req, res, next) => {
  if (req.path === "/") return next();
  return globalLimiter(req, res, next);
});

// Mount routes
app.use("/cloudflare", requireAdmin, cronRoutes);
app.use("/cloudflare", adminLimiter, requireAdmin, cloudflareRoutes);
app.use("/auth", authRoutes);
app.use("/logs", requireAdmin, logsRoutes);
app.use("/gateway", requireAdmin, adminLimiter, gatewayRoutes);
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

app.get("/_health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    message: "PopularCert RAG API is active ",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

// --------------------------
// 🔹 STATIC ASK (JSON Response)
// --------------------------
// --------------------------
// 🔹 STREAM TEST API
// --------------------------
app.post("/test", async (req, res) => {
  try {
    const prompt = req.body?.prompt || "Hello";

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
    });

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
  app.use(express.static(WEB_DIR));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/cloudflare") || req.path.startsWith("/ask") || req.path.startsWith("/_health")) return next();
    if (!(req.headers.accept || "").includes("text/html")) return next();
    res.sendFile(WEB_INDEX);
  });
}

// --------------------------
// 🔹 404 CATCH-ALL
// --------------------------
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

// --------------------------
// 🔹 START SERVER
// --------------------------
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
