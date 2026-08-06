import { DEFAULT_COMPANY, getDefaultCompanyConfig } from "./schema.js";
import { runtimeConfig, saveConfig } from "./store.js";
import { resolvePromptVariables } from "./prompts.js";
import { clearAllCompanyDbs } from "./sqlite.js";
import { updateCompany } from "./company.js";

/**
 * Update one or more runtime config keys on a company.
 * Thin adapter over updateCompany: same write rules (validation, empty-string
 * clearing, EMBEDDING_DIMENSIONS auto-follows EMBEDDING_MODEL), legacy return
 * shape kept for existing callers.
 * @param {object} patch — key/value pairs to update.
 * @param {string} companyName — required.
 * Returns the updated config.
 */
export function updateConfig(patch, companyName) {
  const n = companyName?.trim();
  if (!n || !runtimeConfig.COMPANIES[n]) {
    return { config: {}, errors: [`Company '${n || "(missing)"}' not found.`] };
  }

  const result = updateCompany(n, patch);
  if (result.error) {
    return { config: { ...runtimeConfig.COMPANIES[n] }, errors: [result.error] };
  }

  return { config: result.config };
}

/**
 * Reset just the system prompt to the default template for a company.
 * Returns the updated prompt.
 */
export function resetPrompt(companyName) {
  const n = companyName?.trim();
  if (!n || !runtimeConfig.COMPANIES[n]) return { error: `Company '${n || "(missing)"}' not found.` };

  runtimeConfig.COMPANIES[n].SYSTEM_PROMPT = DEFAULT_COMPANY.SYSTEM_PROMPT;
  saveConfig(runtimeConfig);
  const config = runtimeConfig.COMPANIES[n];
  return { template: config.SYSTEM_PROMPT, resolved: resolvePromptVariables(config.SYSTEM_PROMPT, config) };
}

/**
 * Reset a company's config to env defaults.
 * Returns the default config.
 */
export function resetCompanyConfig(companyName) {
  const n = companyName?.trim();
  if (!n) return { error: "Company name is required." };

  runtimeConfig.COMPANIES[n] = getDefaultCompanyConfig();
  runtimeConfig.COMPANIES[n].COMPANY_NAME = n;
  saveConfig(runtimeConfig);

  return { config: { ...runtimeConfig.COMPANIES[n] } };
}

/**
 * Reset entire runtime config to env defaults and remove all company databases.
 * Returns the default config.
 */
export function resetConfig() {
  const companyName = DEFAULT_COMPANY.COMPANY_NAME;
  runtimeConfig.COMPANIES = { [companyName]: getDefaultCompanyConfig() };

  clearAllCompanyDbs();
  saveConfig(runtimeConfig);

  console.log("🗑  All company databases removed — config reset to defaults");
  return { ...runtimeConfig.COMPANIES[companyName] };
}
