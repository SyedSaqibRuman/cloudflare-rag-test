// --------------------------
// ROUTE HELPERS (Clean Architecture: interface-adapters layer)
// Shared Express plumbing for every gateway sub-router.
// --------------------------
import { isMysqlConfigured } from "../pool.js";

// Async handler wrapper — Express 5 forwards rejected promises, but keeping
// the uniform { success, error } shape matches the rest of the API. Errors
// thrown with a numeric `status` (catalog-service) map to that code.
export const wrap = (fn) => (req, res) => {
  fn(req, res).catch((err) => {
    console.error("❌ /gateway error:", err);
    if (!res.headersSent) {
      const status = Number.isInteger(err?.status) ? err.status : 500;
      return res.status(status).json({ success: false, error: err.message });
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
