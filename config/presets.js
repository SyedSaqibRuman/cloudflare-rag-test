// --------------------------
// SCHEDULER PRESETS (SQLite)
// Global reusable cron presets stored in db/presets/app.db
// (kept outside db/*.db so company discovery ignores them)
// --------------------------
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const PRESETS_DIR = path.resolve(process.cwd(), "db", "presets");
const PRESETS_DB = path.join(PRESETS_DIR, "app.db");

const DEFAULT_PRESETS = [
  { name: "Every 5 minutes", schedule: "*/5 * * * *" },
  { name: "Hourly", schedule: "0 * * * *" },
  { name: "Daily 06:00", schedule: "0 6 * * *" },
  { name: "Weekly Sunday", schedule: "0 0 * * 0" },
];

function ensureDir() {
  if (!fs.existsSync(PRESETS_DIR)) fs.mkdirSync(PRESETS_DIR, { recursive: true });
}

function open() {
  ensureDir();
  return new DatabaseSync(PRESETS_DB);
}

function ensureSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
}

function seedIfEmpty(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM presets").get();
  if (row.n > 0) return;
  const insert = db.prepare(
    "INSERT INTO presets (name, schedule, created_at) VALUES (?, ?, ?)"
  );
  const now = new Date().toISOString();
  for (const p of DEFAULT_PRESETS) {
    insert.run(p.name, p.schedule, now);
  }
}

export function listPresets() {
  const db = open();
  try {
    ensureSchema(db);
    seedIfEmpty(db);
    return db
      .prepare("SELECT id, name, schedule, created_at FROM presets ORDER BY id")
      .all();
  } finally {
    db.close();
  }
}

export function createPreset(name, schedule) {
  const db = open();
  try {
    ensureSchema(db);
    const result = db
      .prepare("INSERT INTO presets (name, schedule, created_at) VALUES (?, ?, ?)")
      .run(name, schedule, new Date().toISOString());
    return {
      id: Number(result.lastInsertRowid),
      name,
      schedule,
    };
  } finally {
    db.close();
  }
}

export function updatePreset(id, name, schedule) {
  const db = open();
  try {
    ensureSchema(db);
    const result = db
      .prepare("UPDATE presets SET name = ?, schedule = ? WHERE id = ?")
      .run(name, schedule, id);
    return result.changes > 0;
  } finally {
    db.close();
  }
}

export function deletePreset(id) {
  const db = open();
  try {
    ensureSchema(db);
    const result = db.prepare("DELETE FROM presets WHERE id = ?").run(id);
    return result.changes > 0;
  } finally {
    db.close();
  }
}
