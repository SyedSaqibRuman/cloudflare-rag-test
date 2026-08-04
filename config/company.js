import {
  COMPANY_KEYS,
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
 * Get the full runtime state (all companies list).
 */
export function getRuntimeState() {
  return {
    COMPANIES: Object.keys(runtimeConfig.COMPANIES),
  };
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
  }));
}

/**
 * Get a single company's full config.
 */
export function getCompany(name) {
  if (!name?.trim()) return null;
  const config = runtimeConfig.COMPANIES[name.trim()];
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

  // Build company config: defaults + overrides
  const companyConfig = getDefaultCompanyConfig();
  companyConfig.COMPANY_NAME = n;
  for (const [key, value] of Object.entries(patch)) {
    if (COMPANY_KEYS.includes(key)) {
      companyConfig[key] = typeof value === "string" ? value.trim() : value;
    }
  }

  // Auto-set embedding dimensions from model
  if (companyConfig.EMBEDDING_MODEL && EMBEDDING_DIMENSIONS[companyConfig.EMBEDDING_MODEL]) {
    companyConfig.EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSIONS[companyConfig.EMBEDDING_MODEL];
  }

  runtimeConfig.COMPANIES[n] = companyConfig;
  saveConfig(runtimeConfig);

  console.log(`✅ Company '${n}' created`);
  return { config: { ...companyConfig } };
}

/**
 * Update an existing company's config.
 * Returns the updated config or an error.
 */
export function updateCompany(name, patch) {
  const n = name?.trim();
  if (!n) return { error: "Company name is required." };
  if (!runtimeConfig.COMPANIES[n]) return { error: `Company '${n}' not found.` };

  const errors = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!COMPANY_KEYS.includes(key)) { errors.push(`Unknown key: ${key}`); continue; }
    if (typeof value === "string" && value.trim()) {
      const err = validateConfigKey(key, value);
      if (err) { errors.push(err); continue; }
      runtimeConfig.COMPANIES[n][key] = value.trim();
    } else if (typeof value === "number" && key === "EMBEDDING_DIMENSIONS") {
      const err = validateConfigKey(key, value);
      if (err) { errors.push(err); continue; }
      runtimeConfig.COMPANIES[n][key] = value;
    }
  }

  if (errors.length) return { error: errors.join("; ") };

  // Auto-set embedding dimensions from model
  const cc = runtimeConfig.COMPANIES[n];
  if (cc.EMBEDDING_MODEL && EMBEDDING_DIMENSIONS[cc.EMBEDDING_MODEL]) {
    cc.EMBEDDING_DIMENSIONS = EMBEDDING_DIMENSIONS[cc.EMBEDDING_MODEL];
  }

  saveConfig(runtimeConfig);
  console.log(`✅ Company '${n}' updated:`, Object.keys(patch).join(", "));
  return { config: { ...runtimeConfig.COMPANIES[n] } };
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
