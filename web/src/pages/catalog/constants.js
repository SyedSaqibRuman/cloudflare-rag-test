// --------------------------
// CATALOG CONSTANTS — shared enums/labels for the provider catalog UI.
// --------------------------

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
export const CATEGORIES = ["ai", "embedding", "vector", "storage", "graph", "image", "speech", "search", "database", "email", "analytics"];
export const AUTH_TYPES = ["api_key", "bearer_token", "oauth2", "basic_auth", "custom"];

// Wizard-specific enums.
export const AUTH_FIELD_TYPES = ["text", "password", "textarea", "select", "url", "email", "numeric", "json", "file"];
export const RESOURCE_TYPES = ["vector_index", "object_bucket", "sql_database", "kv_namespace", "graph_database", "embedding_index", "search_index", "cache_namespace"];
export const FIELD_GROUPS = ["main", "advanced"];
export const FIELD_WIDTHS = ["full", "half", "third", "quarter"];
export const DRAFT_KEY = "pc_provider_wizard_draft";

// Service groups — the mental model users have when configuring an AI platform
// ("I need an AI model, a vector database, object storage…"). Schema categories
// map onto these display groups; no schema change required.
export const SERVICE_GROUPS = [
  { id: "ai", short: "AI", label: "AI Providers", emoji: "🧠", match: ["ai", "embedding", "image", "speech"] },
  { id: "vector", short: "Vector", label: "Vector Databases", emoji: "🗂", match: ["vector"] },
  { id: "storage", short: "Storage", label: "Object Storage", emoji: "📦", match: ["storage"] },
  { id: "graph", short: "Graph", label: "Graph Databases", emoji: "🕸", match: ["graph"] },
  { id: "database", short: "Database", label: "SQL / NoSQL", emoji: "🗄", match: ["database"] },
];

// Categories not covered by a named group (search, email, analytics, …).
export const groupFor = (category) =>
  SERVICE_GROUPS.find((g) => g.match.includes(category)) || { id: "other", short: "Other", label: "Other", emoji: "📎", match: [category] };

// AI vs infrastructure split — only AI providers carry models/capabilities/pricing.
export const INFRASTRUCTURE_GROUPS = SERVICE_GROUPS.filter((g) => g.id !== "ai");
export const isInfrastructure = (category) => groupFor(category).id !== "ai";

export const categoryTone = (c) => {
  const map = { ai: "indigo", embedding: "cyan", vector: "cyan", storage: "amber", graph: "green", database: "slate", image: "red", speech: "slate", search: "cyan", email: "slate", analytics: "amber" };
  return map[c] || "slate";
};

// Capability keys → friendly chips shown on infrastructure provider cards.
// (AI-flavored keys are skipped there — those providers show stats instead.)
export const CAPABILITY_LABELS = {
  s3_compatible: "S3 Compatible",
  vector_search: "Vector Search",
  object_storage: "Object Storage",
  graph_storage: "Graph Storage",
  supports_cypher: "Cypher",
  sql_database_resource: "SQL Database",
  vector_index_resource: "Vector Index",
  object_bucket_resource: "Object Bucket",
  kv_namespace_resource: "KV Namespace",
  graph_database_resource: "Graph Database",
};
export const AI_CAPABILITY_KEYS = new Set(["chat", "streaming", "embeddings", "function_calling", "vision", "reasoning", "audio_output"]);
export const capabilityLabel = (k) => CAPABILITY_LABELS[k] || k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Model category ENUM from schema/v5.sql — keep in sync with the backend.
export const MODEL_CATEGORIES = ["chat", "embedding", "reranker", "image", "tts", "stt", "vision"];

// Short labels for the stepper, full titles for the header/footer buttons,
// and per-step explanations for the "How to add a provider" help panel — only
// the tip for the current step is shown (index-aligned with the steps).
export const STEP_LABELS = ["Basics", "Auth", "Fields", "Endpoints", "Review"];
export const STEP_TITLES = ["Basics", "Auth Config", "Credential Form Fields", "Endpoints & Resource Types", "Review & Confirm"];
export const STEP_TIPS = [
  "The provider's name (the key auto-generates from it: lowercase, spaces → _), its stable key that can never change later, the service category, and website/docs/logo URLs.",
  "How requests will authenticate: the auth type, the header the credential goes into, the default API base URL, and an optional API-key format regex.",
  "What the Credentials page will ask for when connecting this provider (e.g. an API key). Each row you add becomes one input on that form.",
  "The API endpoints this provider exposes and the resources it can provision (vector index, object bucket, …).",
  "Check the summary and the exact row counts per table, then create the provider. Models are added afterward from the provider detail page.",
];
