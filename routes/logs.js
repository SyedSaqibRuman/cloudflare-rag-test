import { Router } from "express";
import fs from "fs";
import path from "path";

// --------------------------
// 🔹 Log viewer endpoints (admin-protected via requireAdmin in app.js)
// Serves the file list in logs/ and the tail of individual log files so the
// admin portal can display them without exposing the directory statically.
// --------------------------
const router = Router();

const LOG_DIR = path.resolve(process.cwd(), "logs");

// Ensure the log directory exists (matches utils/logger.js behavior).
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function statLog(name) {
  const st = fs.statSync(path.join(LOG_DIR, name));
  return { name, size: st.size, mtime: st.mtime.toISOString() };
}

// --------------------------
// 🔹 GET /logs — list log files (newest first)
// --------------------------
router.get("/", (req, res) => {
  let files = [];
  try {
    files = fs
      .readdirSync(LOG_DIR)
      .filter((name) => name.endsWith(".log") && fs.statSync(path.join(LOG_DIR, name)).isFile())
      .map(statLog)
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch (err) {
    return res.status(500).json({ success: false, error: `Failed to read logs: ${err.message}` });
  }
  res.json({ success: true, files });
});

// --------------------------
// 🔹 GET /logs/:name — read a single log file, optionally tailed
// ?tail=N limits to the last N lines (default 2000, 0 = everything).
// --------------------------
router.get("/:name", (req, res) => {
  const name = path.basename(req.params.name);
  if (name !== req.params.name || !name.endsWith(".log")) {
    return res.status(400).json({ success: false, error: "Invalid log file name." });
  }
  const filePath = path.join(LOG_DIR, name);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).json({ success: false, error: `Log file '${name}' not found.` });
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return res.status(500).json({ success: false, error: `Failed to read '${name}': ${err.message}` });
  }

  const all = raw ? raw.split("\n") : [];
  const tail = Math.max(0, Math.floor(Number(req.query.tail) || 2000));
  const lines = tail === 0 || all.length <= tail ? all : all.slice(all.length - tail);

  res.json({
    success: true,
    ...statLog(name),
    lineCount: all.length,
    truncated: all.length > lines.length,
    tailLimit: tail,
    lines,
  });
});

export default router;
