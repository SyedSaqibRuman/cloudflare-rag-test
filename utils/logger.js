import fs from "fs";
import path from "path";

// --------------------------
// 🔹 Config — resolved once at import
// --------------------------
const LOG_DIR = path.resolve(process.cwd(), "logs");
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

// 🔹 Ensure log directory exists once at startup (not on every write)
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 🔹 Rotate map — track which files have been rotated this session
const rotated = new Set();

// --------------------------
// 🔹 Async write queue
// Non-blocking: appends are buffered and flushed on next tick.
// --------------------------
let pending = [];
let flushing = false;

function flushSync() {
  const batch = pending;
  pending = [];
  flushing = false;
  for (const { filePath, line } of batch) {
    try {
      fs.appendFileSync(filePath, line);
    } catch {
      // best-effort
    }
  }
}

function scheduleFlush() {
  if (flushing) return;
  flushing = true;
  queueMicrotask(flushSync);
}

// 🔹 Safety net: flush any pending writes synchronously on exit
process.on("exit", flushSync);

// --------------------------
// 🔹 Public API
// --------------------------
export function logToFile(filename, message) {
  try {
    const filePath = path.join(LOG_DIR, filename);

    // Rotate once per file per session
    if (!rotated.has(filename) && fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_SIZE) {
        fs.writeFileSync(filePath, "");
        rotated.add(filename);
      }
    }

    const timestamp = new Date().toISOString();
    pending.push({ filePath, line: `[${timestamp}] ${message}\n` });
    scheduleFlush();
  } catch {
    // silent — never block or crash the caller
  }
}
