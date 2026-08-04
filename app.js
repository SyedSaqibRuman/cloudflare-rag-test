import "dotenv/config";
import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { askQuestion, askQuestionStream } from "./query/index.js";
import { testStream } from "./streamTest.js";
import cronRoutes from "./routes/cron.js";
import cloudflareRoutes from "./routes/cloudflare.js";
import { env } from "./env.js";

// --------------------------
// 🔹 APP & CONFIG
// --------------------------
const app = express();
const PORT = parseInt(env.PORT, 10);

// Served admin UI (built with `npm run build` inside web/)
const WEB_DIR = path.resolve(process.cwd(), "web", "dist");
const WEB_INDEX = path.join(WEB_DIR, "index.html");
const hasWeb = fs.existsSync(WEB_INDEX);

const ALLOWED_ORIGINS = [
  "https://dev.popularcert.com",
  "https://staging.popularcert.com",
  "https://www.popularcert.com",
  "https://popularcert.com",
  "https://crm.popularcert.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
];

// --------------------------
// 🔹 MIDDLEWARE
// --------------------------
app.set("trust proxy", true);

app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-WP-Nonce", "X-Company-Name"],
}));

app.use(express.json({ limit: "1mb" }));

// --------------------------
// 🔹 COMPANY RESOLUTION
// Extract x-company-name header and attach to request.
// Required on /ask and /ask-stream — returns 400 if missing.
// --------------------------
function requireCompany(req, res, next) {
  const company = req.headers["x-company-name"];
  if (!company?.trim()) {
    return res.status(400).json({ success: false, error: "x-company-name header is required." });
  }
  req.companyName = company.trim();
  next();
}
app.use("/ask", requireCompany);
app.use("/ask-stream", requireCompany);

// --------------------------
// 🔹 RATE LIMITING
// Protects AI endpoints (costly) and admin routes (sensitive) from abuse.
// Tune via env vars — defaults are conservative.
// --------------------------

// Global baseline: 100 req/min across all routes
const globalWindowMs = 60 * 1000; // 1 minute
const globalMax = parseInt(env.RATE_LIMIT_GLOBAL, 10);

// Strict limit for AI-powered endpoints (POST /ask, POST /ask-stream):
// Lower limit because these call Cloudflare Workers AI (cost per request).
const aiWindowMs = 60 * 1000; // 1 minute
const aiMax = parseInt(env.RATE_LIMIT_AI, 10);

// Moderate limit for admin endpoints (POST/PUT/DELETE operations):
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

const aiLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: aiWindowMs,
  max: aiMax,
  message: {
    success: false,
    error: "AI query limit reached. Please wait before sending another question.",
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
app.use("/cloudflare", cronRoutes);
app.use("/cloudflare", adminLimiter, cloudflareRoutes);

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
app.post("/ask", aiLimiter, async (req, res) => {
  try {
    const { question, history = [] } = req.body;

    if (!question?.trim()) {
      return res.status(400).json({ success: false, error: "Question is required" });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({ success: false, error: "History must be an array" });
    }

    const result = await askQuestion(question, history, req.companyName);
    return res.json({ success: true, ...result });

  } catch (err) {
    console.error("❌ /ask Error:", err);
    return res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

app.post("/ask-stream", aiLimiter, async (req, res) => {
  try {
    const { question, history = [] } = req.body;

    // --------------------------
    // 🔹 VALIDATION
    // --------------------------
    if (!question?.trim()) {
      return res.status(400).json({ success: false, error: "Question is required" });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({ success: false, error: "History must be an array" });
    }

    // --------------------------
    // 🔹 SSE HEADERS
    // --------------------------
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable proxy buffering (Nginx)
    res.flushHeaders?.();

    // --------------------------
    // 🔹 ABORT HANDLING
    // --------------------------
    const abortController = new AbortController();
    let closed = false;

    res.on("close", () => {
      closed = true;

      abortController.abort();

      console.log(
        "ℹ️ SSE connection closed"
      );
    });

    // --------------------------
    // 🔹 EXECUTE STREAM
    // --------------------------
    await askQuestionStream(
      question,
      history,
      // Token callback
      (token) => {
        if (closed) return;
        try {
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        } catch (err) {
          console.error("❌ SSE write error:", err.message);
        }
      },
      // Abort signal
      abortController.signal,
      // Company name from header
      req.companyName
    );

    // --------------------------
    // 🔹 FINISH STREAM
    // --------------------------
    if (!closed) {
      res.write("data: [DONE]\n\n");
      res.end();
    }

  } catch (err) {
    console.error("❌ Stream API Error:", err.message);

    try {
      if (!res.headersSent) {
        res.setHeader("Content-Type", "text/event-stream");
      }

      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    } catch (innerErr) {
      console.error("❌ Stream error recovery failed:", innerErr.message);
      try { res.destroy(); } catch { /* best effort */ }
    }
  }
});




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
    // 🔹 Capture stdout chunks
    // --------------------------
    const originalWrite = process.stdout.write;

    process.stdout.write = function (chunk, encoding, callback) {
      try {
        // Send streamed chunk to client in SSE format
        res.write(`data: ${chunk}\n\n`);
      } catch (err) {
        console.error("❌ SSE write error:", err.message);
      }

      return originalWrite.apply(process.stdout, [chunk, encoding, callback]);
    };

    // --------------------------
    // 🔹 Execute stream test
    // --------------------------
    await testStream(prompt);

    // Restore stdout to its original state
    process.stdout.write = originalWrite;

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
app.listen(PORT, () => {
  console.log(`
🚀 PopularCert API Started
----------------------------
Local:     http://localhost:${PORT}
Endpoints: POST /ask
           POST /ask-stream
  `);
});
