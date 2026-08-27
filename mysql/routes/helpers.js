// --------------------------
// ROUTE HELPERS (Clean Architecture: interface-adapters layer)
// Shared Express plumbing for every gateway sub-router.
// --------------------------
import { isMysqlConfigured } from "../pool.js";
import { isAppError } from "../../shared/errors.js";
import { env } from "../../env.js";

// Async handler wrapper — Express 5 forwards rejected promises, but keeping
// the uniform { success, error } shape matches the rest of the API. Typed
// errors (AppError subclasses from shared/errors.js) carry their own status
// code and optional per-field error map. Legacy ad-hoc `err.status = N`
// patterns are still supported for backward compatibility.
export const wrap = (fn) => (req, res) => {
  fn(req, res).catch((err) => {
    const status = isAppError(err)
      ? err.status
      : Number.isInteger(err?.status) ? err.status : 500;
    // Routine client errors (404 lookups, 409 conflicts — constant portal
    // polls) are warn-level so real failures aren't buried in noise.
    if (status >= 500) console.error("❌ /gateway error:", err);
    else console.warn(`⚠️ /gateway ${status}:`, err.message);
    if (!res.headersSent) {
      // Operational errors (4xx) expose their message; unexpected failures
      // (5xx) stay generic in production so driver/decrypt internals never
      // reach the client. Full detail remains in the log line above.
      const expose = status < 500 || env.NODE_ENV !== "production";
      const body = { success: false, error: expose ? err.message : "Internal Server Error" };
      if (isAppError(err) && err.errors) body.errors = err.errors;
      if (isAppError(err) && err.code) body.code = err.code;
      return res.status(status).json(body);
    }
  });
};

// Every gateway route requires a configured database.
export const gate = (req, res, next) => {
  if (!isMysqlConfigured()) {
    return res.status(503).json({
      success: false,
      error:
        "MySQL gateway layer is not configured. Set MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE in .env and run: node mysql/migrate.js",
    });
  }
  next();
};
