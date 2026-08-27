// --------------------------
// CATALOG CONSTANTS — shared enums/labels for the provider catalog UI
// (Providers page: sections grouped by provider type / service category,
// compatible provider prefixes, category accents, model categories).
// --------------------------

// The three ENUM vocabularies are shared with the backend — single source of
// truth is shared/catalog-enums.js (mirrors the MySQL columns in
// migrations/001_init.sql). Re-exported under the portal's names.
// Relative (NOT the #shared alias): constants.js is transitively imported by
// __tests__/serves-models.test.js (via utils.js) under bare `node --test`,
// which cannot resolve Vite aliases.
import {
  MODEL_CATEGORIES,
  PROVIDER_AUTH_TYPES,
  PROVIDER_CATEGORIES,
} from "../../../../shared/catalog-enums.js";

export const CATEGORIES = PROVIDER_CATEGORIES;
export const AUTH_TYPES = PROVIDER_AUTH_TYPES;
export { MODEL_CATEGORIES };

// Capability keys that mean the provider SERVES models (catalog provider_models
// + model-access grants + per-model Test are only meaningful then). Vector DBs,
// storage, graph, and web-search providers lack these, so their detail pages
// skip the "Available Models" card entirely (9Router behavior).
export const MODEL_CAPABILITY_KEYS = new Set([
  "chat",
  "embeddings",
  "embedding",
  "image_generation",
  "text_to_speech",
  "speech_to_text",
  "vision",
  "audio_output",
  "rerank",
  "reranker",
]);

// ------------------------------------------------------------------
// Provider-type sections — the Providers page groups cards by service
// category (primary_service_category), one section per type. "Custom"
// OpenAI/Anthropic-compatible endpoints are created with category "ai", so
// they land in the AI section. Sections with zero providers are hidden;
// unknown categories fall into "Other".
// ------------------------------------------------------------------
export const OPENAI_COMPATIBLE_PREFIX = "oc_";
export const ANTHROPIC_COMPATIBLE_PREFIX = "ac_";

export const isOpenAICompatible = (key) => String(key || "").startsWith(OPENAI_COMPATIBLE_PREFIX);
export const isAnthropicCompatible = (key) => String(key || "").startsWith(ANTHROPIC_COMPATIBLE_PREFIX);

// One entry per primary_service_category ENUM value (schema/v5.sql). Keep the
// ids in sync with the backend ENUM when categories are added.
export const TYPE_SECTIONS = [
  { id: "ai", label: "AI Providers", note: "Chat & language models", emoji: "🧠", tone: "indigo" },
  { id: "embedding", label: "Embedding", note: "Vector embedding APIs", emoji: "🧬", tone: "cyan" },
  { id: "vector", label: "Vector Databases", note: "Vector search stores", emoji: "🗂", tone: "cyan" },
  { id: "storage", label: "Storage", note: "Object & file storage", emoji: "📦", tone: "amber" },
  { id: "graph", label: "Graph Databases", note: "Graph query engines", emoji: "🕸", tone: "green" },
  { id: "database", label: "Databases", note: "SQL / NoSQL", emoji: "🗄", tone: "slate" },
  { id: "image", label: "Image", note: "Image generation & vision", emoji: "🎨", tone: "red" },
  { id: "speech", label: "Speech", note: "Text-to-speech / speech-to-text", emoji: "🎙", tone: "slate" },
  { id: "search", label: "Search", note: "Semantic & keyword search", emoji: "🔍", tone: "cyan" },
  { id: "email", label: "Email", note: "Email delivery APIs", emoji: "✉️", tone: "slate" },
  { id: "analytics", label: "Analytics", note: "Usage analytics", emoji: "📊", tone: "amber" },
];

// Service-group labels for the detail header badge (AI / Vector / Storage …).
// Categories map onto these display groups; no schema change required.
export const SERVICE_GROUPS = [
  { id: "ai", short: "AI", label: "AI", emoji: "🧠", match: ["ai", "embedding", "image", "speech"] },
  { id: "vector", short: "Vector", label: "Vector Database", emoji: "🗂", match: ["vector"] },
  { id: "storage", short: "Storage", label: "Object Storage", emoji: "📦", match: ["storage"] },
  { id: "graph", short: "Graph", label: "Graph Database", emoji: "🕸", match: ["graph"] },
  { id: "database", short: "Database", label: "SQL / NoSQL", emoji: "🗄", match: ["database"] },
];

export const groupFor = (category) =>
  SERVICE_GROUPS.find((g) => g.match.includes(category)) || { id: "other", short: "Other", label: "Other", emoji: "📎", match: [category] };

export const categoryTone = (c) => {
  const map = { ai: "indigo", embedding: "cyan", vector: "cyan", storage: "amber", graph: "green", database: "slate", image: "red", speech: "slate", search: "cyan", email: "slate", analytics: "amber" };
  return map[c] || "slate";
};

// Per-category accent colors for the provider icon tiles (9Router cards paint
// the icon background with the provider's color + 15% alpha).
const PROVIDER_COLORS = {
  ai: "#818cf8",
  embedding: "#22d3ee",
  vector: "#22d3ee",
  storage: "#f59e0b",
  graph: "#34d399",
  database: "#94a3b8",
  image: "#f87171",
  speech: "#94a3b8",
  search: "#22d3ee",
  email: "#94a3b8",
  analytics: "#f59e0b",
};
export const colorFor = (category) => PROVIDER_COLORS[category] || "#94a3b8";
