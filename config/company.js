import {
  COMPANY_KEYS,
  CREDENTIAL_KEYS,
  EMBEDDING_DIMENSIONS,
  getDefaultCompanyConfig,
} from "./schema.js";
import { runtimeConfig, saveConfig, getCompanyConfig, deleteCompanyDb } from "./store.js";
import { validateConfigKey, validateCompanyName } from "./validation.js";

/**
 * Get a snapshot of a company's config.
 * @param {string} companyName — required. Throws if missing or not found.
 */
export function getConfig(companyName) {
  const config = getCompanyConfig(companyName);
  if (!config) throw new Error(`Company '${companyName || "(missing)"}' not found. Pass x-company-name header.`);
  return { ...config };
}

/**
 * Auto-set EMBEDDING_DIMENSIONS from the company's EMBEDDING_MODEL.
 * The model → dimensions mapping lives in one place: schema.js EMBEDDING_DIMENSIONS.
 */
export function applyModelDimensions(config) {
  if (config.EMBEDDING_MODEL && EMBEDDING_DIMENSIONS[config.EMBEDDING_MODEL]) {
    config.EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSIONS[config.EMBEDDING_MODEL];
  }
  return config;
}

/**
 * List all companies with a summary of their config.
 */
export function listCompanies() {
  return Object.entries(runtimeConfig.COMPANIES).map(([name, config]) => ({
    name,
    COMPANY_NAME: config.COMPANY_NAME,
    CONSULTANT_NAME: config.CONSULTANT_NAME,
    BASE_URL: config.BASE_URL,
    VECTOR_INDEX: config.VECTOR_INDEX,
    R2_BUCKET_NAME: config.R2_BUCKET_NAME,
    // Whether any Cloudflare credentials are configured. Boolean only — never
    // expose the secrets themselves through the list endpoint.
    hasCredentials: CREDENTIAL_KEYS.some((k) => config[k]),
  }));
}

/**
 * Get a single company's full config.
 */
export function getCompany(name) {
  const n = name?.trim();
  if (!n) return null;
  const config = getCompanyConfig(n);
  return config ? { ...config } : null;
}

/**
 * Create a new company with the given config.
 * Falls back to defaults for missing keys.
 * Returns the created config or an error.
 */
export function createCompany(name, patch = {}) {
  const n = name?.trim();
  const nameErr = validateCompanyName(n);
  if (nameErr) return { error: nameErr };
  if (runtimeConfig.COMPANIES[n]) return { error: `Company '${n}' already exists.` };

  // Validate provided keys
  const errors = [];
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string" && value.trim()) {
      const err = validateConfigKey(key, value);
      if (err) errors.push(err);
    } else if (typeof value === "number" && key === "EMBEDDING_DIMENSIONS") {
      const err = validateConfigKey(key, value);
      if (err) errors.push(err);
    }
  }
  if (errors.length) return { error: errors.join("; ") };

  // Build company config: defaults + overrides. Blank credentials — the user
  // enters them per company (Config page → Cloudflare Credentials).
  const companyConfig = getDefaultCompanyConfig();
  companyConfig.COMPANY_NAME = n;
  for (const [key, value] of Object.entries(patch)) {
    if (COMPANY_KEYS.includes(key)) {
      companyConfig[key] = typeof value === "string" ? value.trim() : value;
    }
  }

  // Auto-set embedding dimensions from model
  applyModelDimensions(companyConfig);

  runtimeConfig.COMPANIES[n] = companyConfig;
  saveConfig(runtimeConfig);

  console.log(`✅ Company '${n}' created`);
  return { config: { ...companyConfig } };
}

/**
 * Apply a validated patch to a company config.
 * Works on a copy: returns { config, errors } — the caller commits only when
 * errors is empty, so a failed write never leaves a partially-mutated config.
 * Empty strings clear the stored value (except SYSTEM_PROMPT, which is left
 * untouched — use resetPrompt to restore the default). EMBEDDING_DIMENSIONS
 * always follows EMBEDDING_MODEL.
 */
export function applyConfigPatch(companyConfig, patch) {
  const errors = [];
  const draft = { ...companyConfig };
  for (const [key, value] of Object.entries(patch)) {
    if (!COMPANY_KEYS.includes(key)) { errors.push(`Unknown key: ${key}`); continue; }
    if (typeof value === "string" && value.trim()) {
      const err = validateConfigKey(key, value);
      if (err) { errors.push(err); continue; }
      draft[key] = value.trim();
    } else if (typeof value === "string" && key !== "SYSTEM_PROMPT") {
      // Empty string = clear the stored value.
      delete draft[key];
    } else if (typeof value === "number" && key === "EMBEDDING_DIMENSIONS") {
      const err = validateConfigKey(key, value);
      if (err) { errors.push(err); continue; }
      draft[key] = value;
    }
  }
  applyModelDimensions(draft);
  return { config: draft, errors };
}

/**
 * Update an existing company's config.
 * Returns the updated config or an error.
 */
export function updateCompany(name, patch) {
  const n = name?.trim();
  if (!n) return { error: "Company name is required." };
  if (!runtimeConfig.COMPANIES[n]) return { error: `Company '${n}' not found.` };

  const { config, errors } = applyConfigPatch(runtimeConfig.COMPANIES[n], patch);
  if (errors.length) return { error: errors.join("; ") };

  runtimeConfig.COMPANIES[n] = config;
  saveConfig(runtimeConfig);
  console.log(`✅ Company '${n}' updated:`, Object.keys(patch).join(", "));
  return { config: { ...config } };
}

/**
 * Delete a company.
 */
export function deleteCompany(name) {
  const n = name?.trim();
  if (!n) return { error: "Company name is required." };
  if (!runtimeConfig.COMPANIES[n]) return { error: `Company '${n}' not found.` };

  delete runtimeConfig.COMPANIES[n];
  deleteCompanyDb(n);
  saveConfig(runtimeConfig);

  console.log(`🗑 Company '${n}' deleted`);
  return { success: true };
}

/**
 * Set or clear a company's ask/ask-stream API key.
 * Pass a non-empty key to set it; pass null/"" to revoke it.
 */
export function setCompanyApiKey(name, apiKey) {
  const n = name?.trim();
  if (!n) return { error: "Company name is required." };
  if (!runtimeConfig.COMPANIES[n]) return { error: `Company '${n}' not found.` };

  if (apiKey == null || apiKey === "") {
    delete runtimeConfig.COMPANIES[n].API_KEY;
  } else {
    const err = validateConfigKey("API_KEY", apiKey);
    if (err) return { error: err };
    runtimeConfig.COMPANIES[n].API_KEY = apiKey.trim();
  }

  saveConfig(runtimeConfig);
  console.log(`🔑 API key ${apiKey ? "set" : "cleared"} for company '${n}'`);
  return { success: true };
}
