// --------------------------
// LAYOUT NAVIGATION (Clean Architecture: constants separated from the shell)
// Sidebar structure + per-route header metadata for the admin portal.
// --------------------------

// Sidebar groups; icon elements are rendered by the layout (icons.jsx).
// The "cloudflare" item is filtered out at render time unless the selected
// company has Cloudflare API credentials.
export const NAV = [
  {
    section: "Overview",
    items: [{ id: "dashboard", label: "Dashboard", icon: "dashboard" }],
  },
  {
    section: "AI",
    items: [
      { id: "ask", label: "Ask Console", icon: "chat" },
      { id: "ingestion", label: "Knowledge Bases", icon: "book" },
      { id: "assistants", label: "Assistants", icon: "bot" },
    ],
  },
  {
    section: "Companies",
    items: [
      { id: "companies", label: "Companies", icon: "building" },
      { id: "config", label: "Configuration", icon: "sliders" },
    ],
  },
  {
    section: "Infrastructure",
    items: [
      { id: "cloudflare", label: "Cloudflare", icon: "cloud" },
      { id: "scheduler", label: "Scheduler", icon: "clock" },
    ],
  },
  {
    section: "Gateway",
    items: [{ id: "catalog", label: "Providers", icon: "layers" }],
  },
];

export const PAGE_META = {
  dashboard: { title: "Dashboard", subtitle: "Platform overview and live system state" },
  ask: { title: "Ask Console", subtitle: "Test the RAG assistant with live streaming responses" },
  companies: { title: "Companies", subtitle: "Tenants with isolated config, vector index, and R2 bucket" },
  config: { title: "Company Config", subtitle: "Hot-reloadable runtime configuration per tenant" },
  cloudflare: { title: "Cloudflare Resources", subtitle: "Vector indexes and R2 buckets across the account" },
  scheduler: { title: "Scheduler", subtitle: "Run jobs, schedule cron tasks, manage presets, and trigger content ingestion" },
  logs: { title: "Logs", subtitle: "Server log files written by the app (error, process, upload, vector)" },
  catalog: { title: "Providers", subtitle: "Connect providers with API keys or OAuth — live status, batch testing, and per-provider models" },
  ingestion: { title: "Knowledge Bases", subtitle: "Create and manage isolated knowledge repositories for your AI assistants" },
  assistants: { title: "Assistants", subtitle: "Personas bound to a credential, a model, and knowledge bases" },
};
