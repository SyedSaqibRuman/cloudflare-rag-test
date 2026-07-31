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
  DEFAULT_COMPANY,
  getDefaultCompanyConfig,
} from "./schema.js";

// Store (runtimeConfig, persistence)
export { runtimeConfig, saveConfig, getCompanyConfig } from "./store.js";

// Validation
export { validateConfigKey, validateCompanyName } from "./validation.js";

// Prompt resolution
export { resolvePromptVariables } from "./prompts.js";

// Company CRUD
export {
  getConfig,
  getRuntimeState,
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  deleteCompany,
} from "./company.js";

// Legacy / compat
export {
  updateConfig,
  resetPrompt,
  resetCompanyConfig,
  resetConfig,
} from "./legacy.js";
