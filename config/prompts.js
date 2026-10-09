import {
  mergePromptVariables,
  promptVariableMap,
  resolvePromptTemplate,
} from "../shared/prompt-variables.js";

/**
 * Resolve {{VARIABLE}} placeholders in a system-prompt template.
 *
 * There are NO built-in variables. The resolver used to inject nine implicit
 * names straight from company config and the wall clock (CONSULTANT_NAME,
 * COMPANY_NAME, CONTACT_US_URL, LOCATIONS_URL, SERVICES_URL, BASE_URL,
 * COMPANY_WEBSITE, ASSISTANT_NAME, CURRENT_DATE, CURRENT_YEAR), so a template
 * silently changed meaning depending on which company or assistant ran it.
 * Placeholders now resolve ONLY from custom variables, in two tiers:
 *   1. company config PROMPT_VARIABLES
 *   2. the selected assistant's `variables` (wins on conflict)
 * A placeholder with no matching pair is returned literal so a missing variable
 * is visible in the preview instead of quietly deleting prompt text. The rules
 * (key charset, normalization, dedupe) live in shared/prompt-variables.js and
 * are shared with the portal's preview.
 *
 * @param {string} template
 * @param {object|null} companyConfig — supplies the PROMPT_VARIABLES tier
 * @param {{assistantName?: string|null, variables?: Array<{key:string,value:string}>}} [overrides]
 *   `assistantName` is accepted for call-site compatibility but is no longer a
 *   variable source — define an ASSISTANT_NAME custom variable to use it.
 * @returns {string}
 */
export function resolvePromptVariables(template, companyConfig, overrides = {}) {
  if (!template) return "";
  return resolvePromptTemplate(
    template,
    mergePromptVariables(companyConfig?.PROMPT_VARIABLES, overrides?.variables)
  );
}

/**
 * The custom variables that apply to a company, as a `{ KEY: value }` map —
 * the shape returned by GET /cloudflare/prompt and consumed by the portal's
 * resolved preview. Assistant overrides are applied when provided.
 * @param {object|null} companyConfig
 * @param {Array<{key:string,value:string}>} [assistantVariables]
 * @returns {Record<string, string>}
 */
export function getPromptVariableMap(companyConfig, assistantVariables) {
  return promptVariableMap(mergePromptVariables(companyConfig?.PROMPT_VARIABLES, assistantVariables));
}
