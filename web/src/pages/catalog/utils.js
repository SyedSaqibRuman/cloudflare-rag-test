// --------------------------
// CATALOG — display helpers (date + DECIMAL formatting) and slug utilities.
// --------------------------

// Lowercase, alphanumerics + underscores — matches the backend providerKey
// validation (/^[a-z0-9_]+$/). Drives the New Provider wizard's auto-key.
export const providerSlug = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// Model keys allow letters, digits, dots, underscores, hyphens and
// vendor-prefix characters @ / : (backend matches the config-layer contract,
// e.g. gpt-4o or @cf/baai/bge-base-en-v1.5). The auto-key keeps dots plus any
// @ / the name carries and uses hyphens for separators — "GPT-4o" → "gpt-4o",
// "Claude 3.5 Sonnet" → "claude-3.5-sonnet", "@cf/Moondream/Moondream 3.1" →
// "@cf/moondream/moondream-3.1".
export const modelKeyFromName = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9@._/-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");

// Endpoint keys allow lowercase letters, numbers, and hyphens
// (backend /^[a-z0-9-]+$/). "Chat Completions" → "chat-completions".
export const endpointKeyFromName = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Resource `type` is a fixed enum (RESOURCE_TYPES) — auto-select the closest
// match from the display name ("Vectorize Index" → vector_index). Ordered most-
// specific first; returns null when nothing matches so the current selection
// is left alone.
const RESOURCE_TYPE_RULES = [
  { type: "embedding_index", keywords: ["embedding"] },
  { type: "kv_namespace", keywords: ["kv"] },
  { type: "search_index", keywords: ["search"] },
  { type: "cache_namespace", keywords: ["cache"] },
  { type: "graph_database", keywords: ["graph"] },
  { type: "sql_database", keywords: ["sql"] },
  { type: "object_bucket", keywords: ["bucket", "r2", "object"] },
  { type: "vector_index", keywords: ["vector", "index"] },
];
export const resourceTypeFromName = (s) => {
  const v = (s || "").toLowerCase();
  if (!v) return null;
  return RESOURCE_TYPE_RULES.find((r) => r.keywords.some((k) => v.includes(k)))?.type ?? null;
};

export function ymd(v) {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// DECIMAL columns arrive as strings ("1.500000") — show them as numbers.
export function price(v) {
  return v === null || v === undefined || v === "" ? "—" : String(Number(v));
}
