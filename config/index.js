// Schema & constants
export {
  COMPANY_KEYS,
  MODEL_KEYS,
  DIMENSION_KEYS,
  URL_KEYS,
  STRING_KEYS,
  PROMPT_KEYS,
  RESOURCE_KEYS,
  ALLOWED_MODELS,
  EMBEDDING_DIMENSIONS,
  CONFIG_SECTIONS,
  DEFAULT_COMPANY,
  getDefaultCompanyConfig,
} from "./schema.js";

// Store (runtimeConfig, persistence)
export { runtimeConfig, saveConfig, getCompanyConfig, initConfig } from "./store.js";

// Validation
export { validateConfigKey, validateCompanyName } from "./validation.js";

// Prompt resolution
export { resolvePromptVariables } from "./prompts.js";

// Company CRUD
export {
  getConfig,
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
  setCompanyApiKey,
  applyConfigPatch,
  applyModelDimensions,
} from "./company.js";

// Config write path (update/reset) — the live adapter over company.js that
// routes/cloudflare.js uses for /config and /prompt mutations.
// "Legacy" in the file refers only to its return shape ({ config, errors }),
// not to dead code — it is the current write path.
export {
  updateConfig,
  resetPrompt,
  resetCompanyConfig,
  resetConfig,
} from "./write.js";

// Credentials (per-company only, no env fallback)
export { resolveCreds, generateApiKey, CREDENTIAL_KEYS } from "./creds.js";
