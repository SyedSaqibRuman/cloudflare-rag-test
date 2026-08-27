import { getDefaultCompanyConfig } from "./schema.js";

/**
 * Resolve prompt template variables ({{VARIABLE_NAME}}) with company config values.
 */
export function resolvePromptVariables(template, companyConfig, overrides = {}) {
  const config = companyConfig || getDefaultCompanyConfig();
  const variables = {
    // When an assistant is selected its name replaces CONSULTANT_NAME.
    // Fall back to COMPANY_NAME so the prompt never reads "You are , an AI assistant...".
    CONSULTANT_NAME: overrides.assistantName || config.CONSULTANT_NAME || config.COMPANY_NAME || "",
    COMPANY_NAME: config.COMPANY_NAME,
    CONTACT_US_URL: config.CONTACT_US_URL,
    LOCATIONS_URL: config.LOCATIONS_URL,
    SERVICES_URL: config.SERVICES_URL,
    BASE_URL: config.BASE_URL,
  };
  // Merge custom assistant variables (assistant-defined {{KEY}} pairs).
  if (Array.isArray(overrides.variables)) {
    for (const v of overrides.variables) {
      if (v?.key) variables[String(v.key).trim()] = v.value ?? "";
    }
  }
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value || "");
  }
  return result;
}
