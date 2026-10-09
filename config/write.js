import { DEFAULT_COMPANY, getDefaultCompanyConfig } from "./schema.js";
import { runtimeConfig, saveConfig, deleteCompanyDb } from "./store.js";
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
export async function updateConfig(patch, companyName) {
  const n = companyName?.trim();
  if (!n || !runtimeConfig.COMPANIES[n]) {
    return { config: {}, errors: [`Company '${n || "(missing)"}' not found.`] };
  }

  const result = await updateCompany(n, patch);
  if (result.error) {
    return { config: { ...runtimeConfig.COMPANIES[n] }, errors: [result.error] };
  }

  return { config: result.config };
}

/**
 * Reset just the system prompt to the default template for a company.
 * Returns the updated prompt.
 */
export async function resetPrompt(companyName) {
  const n = companyName?.trim();
  if (!n || !runtimeConfig.COMPANIES[n]) return { error: `Company '${n || "(missing)"}' not found.` };

  // Resetting the template also restores the default variable set, otherwise the
  // shipped template's placeholders would resolve against whatever variables the
  // operator had defined (or none, leaving raw {{braces}} in the prompt). One
  // save writes both keys.
  runtimeConfig.COMPANIES[n].SYSTEM_PROMPT = DEFAULT_COMPANY.SYSTEM_PROMPT;
  runtimeConfig.COMPANIES[n].PROMPT_VARIABLES = structuredClone(DEFAULT_COMPANY.PROMPT_VARIABLES);
  await saveConfig({ COMPANIES: { [n]: runtimeConfig.COMPANIES[n] } });
  const config = runtimeConfig.COMPANIES[n];
  return {
    template: config.SYSTEM_PROMPT,
    variables: config.PROMPT_VARIABLES,
    resolved: resolvePromptVariables(config.SYSTEM_PROMPT, config),
  };
}

/**
 * Reset a company's config to env defaults.
 * Returns the default config.
 */
export async function resetCompanyConfig(companyName) {
  const n = companyName?.trim();
  if (!n) return { error: "Company name is required." };

  runtimeConfig.COMPANIES[n] = getDefaultCompanyConfig();
  runtimeConfig.COMPANIES[n].COMPANY_NAME = n;
  await saveConfig({ COMPANIES: { [n]: runtimeConfig.COMPANIES[n] } });

  return { config: { ...runtimeConfig.COMPANIES[n] } };
}

/**
 * Reset entire runtime config to env defaults and remove all company databases.
 * Returns the default config.
 */
export async function resetConfig() {
  const companyName = DEFAULT_COMPANY.COMPANY_NAME;

  // Collect per-company failures instead of swallowing them — a DB that
  // refuses deletion must be reported, not silently kept around.
  const failed = [];
  for (const name of Object.keys(runtimeConfig.COMPANIES)) {
    try {
      await deleteCompanyDb(name);
    } catch (err) {
      failed.push({ name, error: err.message });
    }
  }
  if (failed.length) {
    console.warn(`⚠️  ${failed.length} company DB(s) could not be deleted during reset:`, failed);
  }
  clearAllCompanyDbs();

  runtimeConfig.COMPANIES = { [companyName]: getDefaultCompanyConfig() };
  await saveConfig(runtimeConfig);

  console.log("🗑  All company databases removed — config reset to defaults");
  return { ...runtimeConfig.COMPANIES[companyName] };
}
