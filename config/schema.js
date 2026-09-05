// --------------------------
// CONFIGURATION KEYS & SCHEMA
// --------------------------

const MODEL_KEYS = [
  "EMBEDDING_MODEL",
  "LLM_MODEL",
  "SMALL_LLM",
  "RERANKING_MODEL",
];

/** AI provider selected from the gateway catalog (Config page → Models & Provider). */
const PROVIDER_KEY = ["AI_PROVIDER"];

const DIMENSION_KEYS = ["EMBEDDING_DIMENSIONS"];

const URL_KEYS = ["BASE_URL", "CONTACT_US_URL", "LOCATIONS_URL", "SERVICES_URL"];

const STRING_KEYS = ["CONSULTANT_NAME", "COMPANY_NAME"];
const PROMPT_KEYS = ["SYSTEM_PROMPT"];

/** Customizable topic guardrails. GUARDRAIL_PROMPT is appended to the system
 * message (empty string = built-in default guardrail); BLOCKED_TOPICS is a
 * newline-separated list of keywords/phrases that are refused up-front by the
 * intent fast-path before any AI call is made. */
const GUARDRAIL_KEYS = ["GUARDRAIL_PROMPT", "BLOCKED_TOPICS"];

const RESOURCE_KEYS = ["VECTOR_INDEX", "R2_BUCKET_NAME"];

/** Selected assistant (gateway assistants.assistant_key) — the ask
 * pipeline resolves this assistant and uses its system prompt / model /
 * temperature / KB / graph settings instead of the raw company defaults. */
const ASSISTANT_KEYS = ["ASSISTANT_KEY"];

const CREDENTIAL_KEYS = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_TOKEN_VALUE",
  "R2_JURISDICTION_END_POINT",
  // Neo4j graph connection (GraphRAG). Populated automatically from the
  // company's neo4j gateway credential (uri/username/password) + its
  // graph_database resource (database_name) via rag-sync.
  "NEO4J_URI",
  "NEO4J_USERNAME",
  "NEO4J_PASSWORD",
  "NEO4J_DATABASE",
];

/** Per-company API keys that gate the /ask and /ask-stream endpoints. */
const SECRET_KEYS = ["API_KEY"];

/** Keys that belong to each company config (multi-company capable). */
export const COMPANY_KEYS = [
  ...MODEL_KEYS,
  ...DIMENSION_KEYS,
  ...URL_KEYS,
  ...STRING_KEYS,
  ...PROMPT_KEYS,
  ...GUARDRAIL_KEYS,
  ...RESOURCE_KEYS,
  ...ASSISTANT_KEYS,
  ...CREDENTIAL_KEYS,
  ...SECRET_KEYS,
  ...PROVIDER_KEY,
];

export { MODEL_KEYS, DIMENSION_KEYS, URL_KEYS, STRING_KEYS, PROMPT_KEYS, GUARDRAIL_KEYS, RESOURCE_KEYS, ASSISTANT_KEYS, CREDENTIAL_KEYS, SECRET_KEYS, PROVIDER_KEY };

/**
 * Sectioned grouping of company config keys, used by the API (GET /config) and
 * the admin portal to derive the config shape from one source. Adding a key to
 * a section list is all that's needed — nothing else to hand-sync.
 */
export const CONFIG_SECTIONS = [
  { section: "GENERAL", keys: [...URL_KEYS, ...STRING_KEYS] },
  { section: "MODELS", keys: [...PROVIDER_KEY, ...MODEL_KEYS, ...DIMENSION_KEYS] },
  { section: "STORAGE", keys: RESOURCE_KEYS },
  { section: "ASSISTANT", keys: ASSISTANT_KEYS },
  { section: "GUARDRAIL", keys: GUARDRAIL_KEYS },
  { section: "CREDENTIALS", keys: CREDENTIAL_KEYS },
];

/** Whitelist of allowed Cloudflare model IDs for each role. */
export const ALLOWED_MODELS = {
  EMBEDDING_MODEL: [
    "@cf/baai/bge-base-en-v1.5",
    "@cf/baai/bge-large-en-v1.5",
    "@cf/baai/bge-small-en-v1.5",
    "@cf/baai/bge-m3",
    "@cf/llmware/bge-small-en-v1.5",
    "@cloudflare/coding-gemma",
  ],
  LLM_MODEL: [
    "@cf/meta/llama-3.1-8b-instruct-fp8",
    "@cf/meta/llama-3.3-70b-instruct-fp8",
    "@cf/meta/llama-3.2-3b-instruct",
    "@cf/meta/llama-3.1-70b-instruct",
    "@cf/meta/llama-3.1-8b-instruct",
    "@cf/meta/llama-4-scout-17b-16e-instruct",
  ],
  SMALL_LLM: [
    "@cf/meta/llama-3.2-3b-instruct",
    "@cf/meta/llama-3.1-8b-instruct-fp8",
    "@cf/meta/llama-3.2-1b-instruct",
  ],
  RERANKING_MODEL: [
    "@cf/baai/bge-reranker-base",
    "@cf/baai/bge-reranker-large",
  ],
};

/** Maps embedding model IDs to their vector dimensions. */
export const EMBEDDING_DIMENSIONS = {
  "@cf/baai/bge-base-en-v1.5": 768,
  "@cf/baai/bge-large-en-v1.5": 1024,
  "@cf/baai/bge-small-en-v1.5": 384,
  "@cf/baai/bge-m3": 1024,
  "@cf/llmware/bge-small-en-v1.5": 384,
};

// --------------------------
// DEFAULT COMPANY CONFIG
// --------------------------
export const DEFAULT_COMPANY = {
  BASE_URL: "https://popularcert.com",
  CONTACT_US_URL: "https://popularcert.com/contact-us/",
  LOCATIONS_URL: "https://popularcert.com/locations/",
  SERVICES_URL: "https://popularcert.com/services/",
  CONSULTANT_NAME: "Sarah",
  COMPANY_NAME: "Popularcert",
  AI_PROVIDER: "cloudflare",
  EMBEDDING_MODEL: "@cf/baai/bge-base-en-v1.5",
  EMBEDDING_DIMENSIONS: 768,
  LLM_MODEL: "@cf/meta/llama-3.1-8b-instruct-fp8",
  SMALL_LLM: "@cf/meta/llama-3.2-3b-instruct",
  RERANKING_MODEL: "@cf/baai/bge-reranker-base",
  VECTOR_INDEX: "",
  R2_BUCKET_NAME: "",
  GUARDRAIL_PROMPT: "",
  BLOCKED_TOPICS: "",
  SYSTEM_PROMPT: `You are {{CONSULTANT_NAME}}, an AI assistant for {{COMPANY_NAME}}. Do not deny being an AI if asked.

## Rules
- Answer only from available information. Never reveal your source.
- Reply in the user's language; switch if asked.
- Be concise, clear, and professional. No jokes, opinions, or assumptions.

## Formatting
- Markdown only. Use ## for multi-section headings, - for bullets, **bold** for key terms, numbered lists for steps only.
- No raw HTML, code blocks, or underline headings (=== / ---).

## Greetings & Introductions
If the user greets you or introduces themselves, respond warmly, acknowledge them by name if given, and ask how you can help with their certification goals. Do NOT treat greetings or introductions as vague queries.

## Clarification
If a message is vague: acknowledge what you understood, then ask one focused question about the missing part. Never ask multiple questions at once.

## Discovery
If a user wants certification WITHOUT specifying a standard, ask these one at a time:
1. Which standard? (ISO 9001, 14001, 27001, CE Mark, Halal, etc.)
2. What industry/sector?
3. Primary country/location?
Do NOT outline steps or processes until the standard is confirmed.

## Pricing
If asked about cost:
"Certification costs depend on your organization's size, number of employees, standards, and industry scope. We offer a **Free Cost Calculator** on our website. Would you like to share an email or phone number so a consultant can prepare a precise quote?"

## Contact
[Contact Us]({{CONTACT_US_URL}})

## Locations
[Our Locations]({{LOCATIONS_URL}})

## Services
[Our Services]({{SERVICES_URL}})

## No Information Found
"I'm not able to find relevant information regarding your query. Please contact our team directly."
[Contact Us]({{CONTACT_US_URL}})`,
};

/**
 * Build a fresh default company config clone.
 */
export function getDefaultCompanyConfig(overrides = {}) {
  return { ...DEFAULT_COMPANY, ...overrides };
}
