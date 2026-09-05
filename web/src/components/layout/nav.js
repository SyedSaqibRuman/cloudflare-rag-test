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
    items: [{ id: "dashboard", label: "Dashboard", icon: "dashboard", tip: "Your AI platform at a glance" }],
  },
  {
    section: "AI",
    items: [
      { id: "ingestion", label: "Knowledge", icon: "book", tip: "Add your content so your AI can answer questions" },
      { id: "assistants", label: "Assistants", icon: "bot", tip: "Create AI assistants with custom knowledge and behavior" },

      { id: "ask", label: "Test AI", icon: "chat", tip: "Ask questions and see how your AI responds" },
    ],
  },
  {
    section: "Workspaces",
    items: [
      { id: "companies", label: "Companies", icon: "building", tip: "Manage your workspaces and their settings" },
      { id: "config", label: "Settings", icon: "sliders", tip: "Configure your workspace preferences" },
    ],
  },
  {
    section: "Automation",
    items: [
      { id: "workflows", label: "Workflows", icon: "workflow", tip: "Automate tasks with AI-powered workflows" },
      { id: "scheduler", label: "Scheduler", icon: "clock", tip: "Schedule automatic content updates" },
      { id: "webhooks", label: "Notifications", icon: "cloud", tip: "Manage webhook notifications for events" },
    ],
  },
  {
    section: "Insights",
    items: [
      { id: "usage", label: "Usage", icon: "chart", tip: "Track your AI usage and costs" },
    ],
  },
  {
    section: "Advanced",
    items: [
      { id: "cloudflare", label: "Cloud Services", icon: "cloud", tip: "Manage your cloud storage and search indexes" },
      { id: "catalog", label: "AI Providers", icon: "layers", tip: "Connect to AI services like Cloudflare, OpenAI, and more" },
    ],
  },
];

export const PAGE_META = {
  dashboard: { title: "Dashboard", subtitle: "Your AI platform at a glance" },
  ask: { title: "Test AI", subtitle: "Ask questions and see how your AI responds" },
  companies: { title: "Companies", subtitle: "Manage your workspaces and their settings" },
  config: { title: "Settings", subtitle: "Configure your workspace preferences" },
  cloudflare: { title: "Cloud Services", subtitle: "Manage your cloud storage and search indexes" },
  scheduler: { title: "Scheduler", subtitle: "Schedule automatic content updates" },
  logs: { title: "Logs", subtitle: "View system activity and errors" },
  catalog: { title: "AI Providers", subtitle: "Connect to AI services like Cloudflare, OpenAI, and more" },
  ingestion: { title: "Knowledge", subtitle: "Create and manage knowledge bases for your AI" },
  assistants: { title: "Assistants", subtitle: "Create AI assistants with custom knowledge and behavior" },

  workflows: { title: "Workflows", subtitle: "Automate tasks with AI-powered workflows" },
  usage: { title: "Usage", subtitle: "Track your AI usage, tokens, and costs" },
  webhooks: { title: "Notifications", subtitle: "Manage webhook notifications for events" },
};
