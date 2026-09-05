import {
  COMPANY_KEYS,
  MODEL_KEYS,
  URL_KEYS,
  STRING_KEYS,
  PROMPT_KEYS,
  RESOURCE_KEYS,
  ASSISTANT_KEYS,
  CREDENTIAL_KEYS,
  SECRET_KEYS,
  ALLOWED_MODELS,
} from "./schema.js";

/**
 * Validate a single config key/value pair.
 * Returns an error string if invalid, or null if valid.
 */
export function validateConfigKey(key, value) {
  if (!COMPANY_KEYS.includes(key)) return `Unknown config key: ${key}`;

  // Models must be non-empty strings. The Cloudflare @cf/ allowlist is the
  // known-good set, but catalog-sourced model keys (e.g. `gpt-4o`,
  // `text-embedding-3-small`) are also accepted — the company's provider is
  // chosen on the Config page. Only @cf/ models are runtime-callable today;
  // other keys are validated for shape, not callability.
  if (MODEL_KEYS.includes(key)) {
    if (typeof value !== "string" || !value.trim()) return `${key} must be a non-empty string.`;
    const allowed = ALLOWED_MODELS[key];
    const v = value.trim();
    if (allowed && !allowed.includes(v) && !/^[a-zA-Z0-9@][a-zA-Z0-9._:@/-]{1,120}$/.test(v)) {
      return `${key} '${v}' is not in the allowed list: ${allowed.join(", ")}`;
    }
    return null;
  }

  // AI provider key (from the gateway catalog: /^[a-z0-9_]+$/)
  if (key === "AI_PROVIDER") {
    if (typeof value !== "string" || !value.trim()) return `${key} must be a non-empty string.`;
    if (!/^[a-z0-9_]+$/.test(value.trim())) return `${key} must match /^[a-z0-9_]+$/ (provider key).`;
    return null;
  }

  // Dimensions must be a positive integer
  if (key === "EMBEDDING_DIMENSIONS") {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) return `${key} must be a positive integer.`;
    return null;
  }

  // URLs
  if (URL_KEYS.includes(key)) {
    try { new URL(value.trim()); } catch { return `${key} is not a valid URL.`; }
    return null;
  }

  // Brand strings (consultant name, company name)
  if (STRING_KEYS.includes(key)) {
    if (typeof value !== "string" || !value.trim()) return `${key} must be a non-empty string.`;
    return null;
  }

  // System prompt
  if (PROMPT_KEYS.includes(key)) {
    if (typeof value !== "string" || !value.trim()) return `${key} must be a non-empty string.`;
    return null;
  }

  // Custom guardrail prompt (appended to the system message). Free text —
  // empty clears it and falls back to the built-in guardrail.
  if (key === "GUARDRAIL_PROMPT") {
    if (typeof value !== "string" || !value.trim()) return `${key} must be a non-empty string.`;
    if (value.length > 8000) return `${key} must be at most 8000 characters.`;
    return null;
  }

  // Blocked topics — a newline-separated list of keywords/phrases. Each line
  // is matched as a case-insensitive substring against the user's question.
  if (key === "BLOCKED_TOPICS") {
    if (typeof value !== "string" || !value.trim()) return `${key} must be a non-empty string.`;
    const lines = value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return `${key} must contain at least one topic.`;
    if (lines.length > 100) return `${key} supports at most 100 topics (one per line).`;
    for (const line of lines) {
      if (line.length > 120) return `${key} topics must be at most 120 characters each.`;
    }
    return null;
  }

  // Resource names (vector indexes, R2 buckets)
  if (RESOURCE_KEYS.includes(key)) {
    const normalized = value.trim();
    if (!normalized) return `${key} must be a non-empty string.`;
    if (!/^[a-z0-9-]+$/.test(normalized)) return `${key} must contain only lowercase letters, numbers, and hyphens.`;
    if (normalized.length < 3 || normalized.length > 63) return `${key} must be between 3 and 63 characters.`;
    return null;
  }

  // Selected assistant key (gateway assistants.assistant_key — same charset).
  if (ASSISTANT_KEYS.includes(key)) {
    const normalized = value.trim();
    if (!normalized) return `${key} must be a non-empty string.`;
    if (!/^[a-z0-9-]+$/.test(normalized)) return `${key} must contain only lowercase letters, numbers, and hyphens.`;
    if (normalized.length < 3 || normalized.length > 63) return `${key} must be between 3 and 63 characters.`;
    return null;
  }

  // Credentials (Cloudflare / R2 keys and tokens)
  if (CREDENTIAL_KEYS.includes(key)) {
    if (typeof value !== "string" || !value.trim()) return `${key} must be a non-empty string.`;
    return null;
  }

  // Per-company API keys
  if (SECRET_KEYS.includes(key)) {
    if (typeof value !== "string" || !value.trim()) return `${key} must be a non-empty string.`;
    if (value.trim().length < 8) return `${key} must be at least 8 characters.`;
    return null;
  }

  return null;
}

/**
 * Validate a company name.
 * Returns an error string if invalid, or null if valid.
 */
export function validateCompanyName(name) {
  const n = name?.trim();
  if (!n) return "Company name is required.";
  if (!/^[a-z0-9-]+$/.test(n)) return "Company name must contain only lowercase letters, numbers, and hyphens.";
  if (n.length < 2 || n.length > 63) return "Company name must be between 2 and 63 characters.";
  return null;
}
