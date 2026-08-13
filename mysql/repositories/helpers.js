// --------------------------
// REPOSITORY LAYER (MySQL)
// All SQL for the AI Gateway platform layer lives here, one repository per
// aggregate. Callers (services/routes) never write raw SQL — they use these
// functions. Row casing is snake_case (as stored); routes are responsible
// for shaping responses.
//
// JSON columns come back as strings from mysql2; the `json()` helper parses
// them so callers get plain objects.
// --------------------------
import { getPool } from "../pool.js";

export function json(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function mapRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (k.includes("config") || k.includes("json") || k.endsWith("_schema") || k === "tools" || k === "kb_ids") {
      out[k] = json(v);
    }
  }
  return out;
}

