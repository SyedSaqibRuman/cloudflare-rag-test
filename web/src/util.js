export function cx(...args) {
  return args.filter(Boolean).join(" ");
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function timeAgo(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
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
