import { DEFAULT_COMPANY, getDefaultCompanyConfig, EMBEDDING_DIMENSIONS } from "./schema.js";
import { runtimeConfig, saveConfig } from "./store.js";
import { validateConfigKey } from "./validation.js";
import { resolvePromptVariables } from "./prompts.js";
import { clearAllCompanyDbs } from "./sqlite.js";

/**
 * Update one or more runtime config keys on a company.
 * @param {object} patch — key/value pairs to update.
 * @param {string} companyName — required.
 * Returns the updated config.
 */
export function updateConfig(patch, companyName) {
  const n = companyName?.trim();
  if (!n || !runtimeConfig.COMPANIES[n]) {
    return { config: {}, errors: [`Company '${n || "(missing)"}' not found.`] };
  }

  const errors = [];
  for (const [key, value] of Object.entries(patch)) {
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

  if (errors.length) {
    return { config: { ...runtimeConfig.COMPANIES[n] }, errors };
  }

  saveConfig(runtimeConfig);
  return { config: { ...runtimeConfig.COMPANIES[n] } };
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
