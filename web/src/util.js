export function cx(...args) {
  return args.filter(Boolean).join(" ");
}

// ------------------------------------------------------------------
// DB timestamp parsing. MySQL DATETIME columns come back as naive
// "YYYY-MM-DD HH:MM:SS" strings in UTC with no timezone marker — but
// `new Date("2026-09-28 08:19:40")` (space, no TZ) parses as
// BROWSER-LOCAL time, skewing every relative time by the UTC offset
// (e.g. +5:30 for IST browsers: a run 5 minutes ago shows "5h ago").
// Fix: rewrite only that exact shape to "YYYY-MM-DDTHH:MM:SSZ" so it
// parses as UTC. ISO strings (T/Z or offset), date-only "YYYY-MM-DD"
// (already UTC per spec), HTTP-dates, and Date objects pass through
// untouched.
// ------------------------------------------------------------------
const NAIVE_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

/**
 * Parse a timestamp string, treating naive DB datetimes as UTC.
 * Returns a Date, or null when value is empty/unparseable.
 * @param {string|Date|number|null} value
 * @returns {Date|null}
 */
export function parseUtcDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return new Date(value);
  const s = String(value).trim();
  const normalized = NAIVE_DATETIME_RE.test(s) ? `${s.replace(" ", "T")}Z` : s;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value) {
  const d = parseUtcDate(value);
  if (!d) return value ? String(value) : "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function timeAgo(value) {
  const d = parseUtcDate(value);
  if (!d) return "—";
  const diff = Math.max(0, Date.now() - d.getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function shorten(value, n = 60) {
  if (!value) return "—";
  const s = String(value);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * Derive a company's setup status from its config summary.
 * Returns { label, tone } where tone maps to the Badge palette.
 */
export function companyStatus(c) {
  if (!c?.hasCredentials) return { label: "Config Required", tone: "amber" };
  if (c.VECTOR_INDEX && c.R2_BUCKET_NAME) return { label: "Healthy", tone: "green" };
  if (!c.VECTOR_INDEX && c.R2_BUCKET_NAME) return { label: "Missing Vector", tone: "red" };
  if (c.VECTOR_INDEX && !c.R2_BUCKET_NAME) return { label: "Missing Bucket", tone: "red" };
  return { label: "Config Required", tone: "amber" };
}
