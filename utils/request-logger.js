// --------------------------
// 🔹 REQUEST LOGGER
// Structured request logging middleware for API call tracking.
// Logs method, path, status, duration, company, and client IP.
// Writes to logs/requests.log (always) + console (dev only).
// --------------------------
import crypto from "crypto";
import { logToFile } from "./logger.js";

// ------------------------------------------------------------------
// Routes to skip (health checks, static assets, favicon)
// ------------------------------------------------------------------
const SKIP_PATHS = new Set(["/_health", "/favicon.ico"]);

/**
 * Express middleware that logs every completed request as a structured
 * JSON line to `logs/requests.log` and to the console (in dev mode).
 *
 * Logged fields:
 *   - timestamp, method, path, status, durationMs
 *   - company (from x-company-name header, if present)
 *   - ip (client IP, respecting trust proxy)
 *   - userAgent
 *   - error (if status >= 400, the first 200 chars of the error body)
 */
export default function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl } = req;

  // Skip trivial routes
  if (SKIP_PATHS.has(originalUrl)) return next();

  // Generate or accept request ID for cross-service tracing.
  // Clients can send X-Request-Id; otherwise we generate a short UUID.
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  req.id = requestId;
  res.set("X-Request-Id", requestId);

  // Capture the response body for error diagnostics
  let errorBody = null;
  const originalSend = res.send;
  res.send = function interceptedSend(body) {
    if (res.statusCode >= 400 && typeof body === "string") {
      errorBody = body.slice(0, 200);
    } else if (res.statusCode >= 400 && Buffer.isBuffer(body)) {
      errorBody = body.toString("utf8").slice(0, 200);
    }
    return originalSend.call(this, body);
  };

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const { statusCode } = res;
    const company = req.headers["x-company-name"] || null;
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const userAgent = req.headers["user-agent"] || "";

    const entry = {
      requestId,
      timestamp: new Date().toISOString(),
      method,
      path: originalUrl,
      status: statusCode,
      durationMs,
      company,
      ip,
      userAgent: userAgent.slice(0, 120),
    };

    if (errorBody) entry.error = errorBody;

    // Write to file (structured JSON lines)
    logToFile("requests.log", JSON.stringify(entry));

    // Console output (dev-friendly colored output)
    if (process.env.NODE_ENV !== "production") {
      const color = statusCode >= 500 ? "\x1b[31m"  // red
        : statusCode >= 400 ? "\x1b[33m"              // yellow
        : statusCode >= 300 ? "\x1b[36m"              // cyan
        : "\x1b[32m";                                  // green
      const reset = "\x1b[0m";
      const ms = durationMs < 100 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(2)}s`;
      const companyTag = company ? ` [${company}]` : "";
      const idTag = requestId.slice(0, 8);
      console.log(`${color}${method}${reset} ${originalUrl} ${color}${statusCode}${reset} ${ms}${companyTag} ${idTag}`);
    }
  });

  next();
}
