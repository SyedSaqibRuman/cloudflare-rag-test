import { getDefaultCompanyConfig } from "./schema.js";

/**
 * Resolve prompt template variables ({{VARIABLE_NAME}}) with company config values.
 */
export function resolvePromptVariables(template, companyConfig, overrides = {}) {
  if (!template) return "";
  const config = companyConfig || getDefaultCompanyConfig();
  const variables = {
    // When an assistant is selected its name replaces CONSULTANT_NAME.
    // Fall back to COMPANY_NAME so the prompt never reads "You are , an AI assistant...".
    CONSULTANT_NAME: overrides.assistantName || config.CONSULTANT_NAME || config.COMPANY_NAME || "",
    COMPANY_NAME: config.COMPANY_NAME || "",
    CONTACT_US_URL: config.CONTACT_US_URL || "",
    LOCATIONS_URL: config.LOCATIONS_URL || "",
    SERVICES_URL: config.SERVICES_URL || "",
    BASE_URL: config.BASE_URL || "",
    // Extended built-in variables
    COMPANY_WEBSITE: config.BASE_URL || "",
    ASSISTANT_NAME: overrides.assistantName || config.CONSULTANT_NAME || "",
    CURRENT_DATE: new Date().toISOString().split("T")[0],
    CURRENT_YEAR: new Date().getFullYear().toString(),
  };
  // Merge custom assistant variables (assistant-defined {{KEY}} pairs).
  // Assistant variables take precedence over built-in ones.
  if (Array.isArray(overrides.variables)) {
    for (const v of overrides.variables) {
      if (v?.key) variables[String(v.key).trim().toUpperCase()] = v.value ?? "";
    }
  }
  let result = template;
  // Replace all {{VARIABLE_NAME}} patterns (case-insensitive for built-ins, exact for custom).
  result = result.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key) => {
    const upperKey = key.toUpperCase();
    return variables[upperKey] !== undefined ? variables[upperKey] : match;
  });
  return result;
}
