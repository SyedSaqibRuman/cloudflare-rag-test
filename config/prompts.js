import { getDefaultCompanyConfig } from "./schema.js";

/**
 * Resolve prompt template variables ({{VARIABLE_NAME}}) with company config values.
 */
export function resolvePromptVariables(template, companyConfig) {
  const config = companyConfig || getDefaultCompanyConfig();
  const variables = {
    CONSULTANT_NAME: config.CONSULTANT_NAME,
    COMPANY_NAME: config.COMPANY_NAME,
    CONTACT_US_URL: config.CONTACT_US_URL,
    LOCATIONS_URL: config.LOCATIONS_URL,
    SERVICES_URL: config.SERVICES_URL,
    BASE_URL: config.BASE_URL,
  };
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value || "");
  }
  return result;
}
