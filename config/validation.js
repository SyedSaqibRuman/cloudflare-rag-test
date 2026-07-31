import {
  COMPANY_KEYS,
  MODEL_KEYS,
  URL_KEYS,
  STRING_KEYS,
  PROMPT_KEYS,
  RESOURCE_KEYS,
  ALLOWED_MODELS,
} from "./schema.js";

/**
 * Validate a single config key/value pair.
 * Returns an error string if invalid, or null if valid.
 */
export function validateConfigKey(key, value) {
  if (!COMPANY_KEYS.includes(key)) return `Unknown config key: ${key}`;

  // Models must be non-empty strings
  if (MODEL_KEYS.includes(key)) {
    if (typeof value !== "string" || !value.trim()) return `${key} must be a non-empty string.`;
    const allowed = ALLOWED_MODELS[key];
    if (allowed && !allowed.includes(value.trim())) {
      return `${key} '${value}' is not in the allowed list: ${allowed.join(", ")}`;
    }
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

  // Resource names (vector indexes, R2 buckets)
  if (RESOURCE_KEYS.includes(key)) {
    const normalized = value.trim();
    if (!normalized) return `${key} must be a non-empty string.`;
    if (!/^[a-z0-9-]+$/.test(normalized)) return `${key} must contain only lowercase letters, numbers, and hyphens.`;
    if (normalized.length < 3 || normalized.length > 63) return `${key} must be between 3 and 63 characters.`;
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
