// --------------------------
// SHARED — prompt variable rules.
// Single source of truth for the {{VARIABLE}} contract used by BOTH the API
// server (config/prompts.js, config/validation.js, routes/cloudflare/prompt.js,
// query/prompts.js) and the admin portal (SystemPromptCard, Assistants page).
//
// There are NO built-in variables. The resolver used to inject nine implicit
// names from company config and the wall clock (CONSULTANT_NAME, COMPANY_NAME,
// CONTACT_US_URL, LOCATIONS_URL, SERVICES_URL, BASE_URL, COMPANY_WEBSITE,
// ASSISTANT_NAME, CURRENT_DATE, CURRENT_YEAR) behind the operator's back, so
// templates silently changed meaning and a {{COMPANY_NAME}} in one tenant's
// prompt meant something different from another's. Every placeholder is now
// data: the company owns PROMPT_VARIABLES and the selected assistant owns
// assistant_variables, assistant wins on conflict (mergePromptVariables).
// A placeholder with no matching custom variable is left LITERAL rather than
// blanked, so a missing variable is visible in the resolved preview instead of
// silently deleting text from the prompt.
// Pure ESM, zero deps — node --test and the portal can import it directly.
// --------------------------

/** Placeholder keys are uppercase identifiers: {{BRAND_NAME}}, not {{brand-name}}. */
export const PROMPT_VARIABLE_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

/** Guard rail so a pathological config can't bloat every system message. */
export const MAX_PROMPT_VARIABLES = 50;

/** Matches a single {{PLACEHOLDER}} token (letters, digits, underscore). */
const PLACEHOLDER_RE = /\{\{([A-Za-z0-9_]+)\}\}/g;

/**
 * Clean a raw variable list into canonical `[{ key, value }]` pairs:
 * keys trimmed + uppercased, values coerced to strings, invalid/blank keys
 * dropped, case-insensitive duplicates collapsed with last-write-wins, and the
 * result capped at MAX_PROMPT_VARIABLES.
 * @param {unknown} list
 * @returns {Array<{key: string, value: string}>}
 */
export function normalizePromptVariables(list) {
  if (!Array.isArray(list)) return [];
  const byKey = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const key = String(entry.key ?? "").trim().toUpperCase();
    if (!PROMPT_VARIABLE_KEY_RE.test(key)) continue;
    // Values are trimmed like every other config write (an operator typing
    // "  Acme  " into a form should not inject the padding into the prompt),
    // but an empty value is KEPT — it is a deliberate "resolve to nothing".
    const value = entry.value == null ? "" : String(entry.value).trim();
    byKey.set(key, value); // last write wins
    if (byKey.size >= MAX_PROMPT_VARIABLES) break;
  }
  return [...byKey].map(([key, value]) => ({ key, value }));
}

/**
 * Merge the company tier with the assistant tier. Later tiers win, so an
 * assistant can override an inherited company value (or add a new one) without
 * the company losing its definition for other assistants.
 * @param {unknown} companyVariables
 * @param {unknown} assistantVariables
 * @returns {Array<{key: string, value: string}>}
 */
export function mergePromptVariables(companyVariables, assistantVariables) {
  return normalizePromptVariables([
    ...normalizePromptVariables(companyVariables),
    ...normalizePromptVariables(assistantVariables),
  ]);
}

/**
 * Canonical `[{key,value}]` → `{ KEY: value }` for API responses and the
 * portal's resolved preview.
 * @param {unknown} variables
 * @returns {Record<string, string>}
 */
export function promptVariableMap(variables) {
  const out = {};
  for (const { key, value } of normalizePromptVariables(variables)) out[key] = value;
  return out;
}

/**
 * Replace {{PLACEHOLDER}} occurrences with the matching custom variable.
 * Matching is case-insensitive. Unmatched placeholders are returned verbatim.
 * @param {string} template
 * @param {unknown} variables  `[{key,value}]` (or a KEY→value map)
 * @returns {string}
 */
export function resolvePromptTemplate(template, variables) {
  if (!template) return "";
  const values = Array.isArray(variables)
    ? promptVariableMap(variables)
    : { ...(variables || {}) };
  return String(template).replace(PLACEHOLDER_RE, (match, rawKey) => {
    const key = String(rawKey).trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match;
  });
}

/**
 * The unique placeholders a template references, uppercased and in first-seen
 * order. Powers the portal's "missing variable" hints.
 * @param {string} template
 * @returns {string[]}
 */
export function collectPlaceholders(template) {
  if (!template) return [];
  const seen = new Set();
  for (const match of String(template).matchAll(PLACEHOLDER_RE)) {
    seen.add(match[1].trim().toUpperCase());
  }
  return [...seen];
}