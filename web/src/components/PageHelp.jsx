// --------------------------
// PAGE HELP — contextual help modal for every page
// Shows a feature guide when the user clicks the "?" help button in the header.
// --------------------------
import { useState, useEffect } from "react";
import { Modal } from "./ui";

// ------------------------------------------------------------------
// Help content per page — written for non-technical end users.
// Each page has a title, intro, and an array of features.
// ------------------------------------------------------------------
const HELP_DATA = {
  dashboard: {
    title: "Dashboard",
    intro: "Your command center. See everything at a glance and get started quickly.",
    features: [
      { icon: "📊", name: "Quick Stats", desc: "See your Knowledge Bases, Assistants, and Provider connections at a glance." },
      { icon: "🚀", name: "Getting Started", desc: "A step-by-step guide to set up your AI. Follow the checklist to go from zero to a working AI assistant." },
      { icon: "⚡", name: "Quick Actions", desc: "One-click buttons to create a Knowledge Base, add an Assistant, or test your AI." },
      { icon: "🔄", name: "Refresh", desc: "Reload the dashboard to see the latest data." },
    ],
  },

  ingestion: {
    title: "Knowledge Bases",
    intro: "Knowledge Bases store your content so your AI can answer questions about it. Think of it as your AI's library.",
    features: [
      { icon: "➕", name: "Create Knowledge Base", desc: "Set up a new KB. Give it a name, choose where your content comes from (website URL, WordPress, or file upload), and configure how it processes text." },
      { icon: "🔗", name: "Content Sources", desc: "Connect your website (URL), WordPress site, or upload files directly. The system will crawl and process your content automatically." },
      { icon: "📊", name: "Stats Cards", desc: "See how many Knowledge Bases you have, how many are active, and total documents processed." },
      { icon: "▶️", name: "Ingest", desc: "Start processing your content. This reads your website or files, splits them into chunks, and stores them for AI search." },
      { icon: "📝", name: "Q&A Tab", desc: "Add custom question-and-answer pairs. These are used first when someone asks a matching question — perfect for FAQs." },
      { icon: "🤖", name: "Graph Database", desc: "Optional: Connect a Neo4j graph database to give your AI deeper understanding of relationships between concepts." },
      { icon: "🔍", name: "Search & Filter", desc: "Find specific Knowledge Bases quickly by name." },
    ],
  },

  assistants: {
    title: "Assistants",
    intro: "Assistants are the 'brains' behind your AI. Each one combines a language model, your knowledge, and custom instructions.",
    features: [
      { icon: "➕", name: "Create Assistant", desc: "Set up a new AI assistant. Choose which Knowledge Base it uses, what model powers it, and write custom instructions." },
      { icon: "🧠", name: "System Prompt", desc: "Write instructions that tell your AI how to behave — its personality, tone, and rules." },
      { icon: "📚", name: "Knowledge Base Link", desc: "Connect your assistant to a Knowledge Base so it can answer questions from your content." },
      { icon: "🔧", name: "Model Selection", desc: "Choose which AI model to use (e.g., Cloudflare LLaMA, GPT). Different models have different strengths." },
      { icon: "🌡️", name: "Temperature", desc: "Control how creative vs. precise your AI is. Lower = more factual, Higher = more creative." },
      { icon: "💡", name: "Graph Context", desc: "Optional: Enable graph database integration for richer, relationship-aware answers." },
      { icon: "📋", name: "Duplicate", desc: "Copy an existing assistant as a starting point for a new one." },
    ],
  },

  ask: {
    title: "Test AI",
    intro: "Try out your AI by asking questions. This is where you see how well your Knowledge Base and Assistant work together.",
    features: [
      { icon: "💬", name: "Ask a Question", desc: "Type any question related to your content and get an AI-generated answer with source citations." },
      { icon: "📜", name: "Conversation History", desc: "Your chat history is preserved. Ask follow-up questions — the AI remembers what you've discussed." },
      { icon: "🔄", name: "Switch Assistant", desc: "Choose which Assistant to test. Try different ones to compare their responses." },
      { icon: "📝", name: "Sources", desc: "Every answer shows which documents it used. Click to see the original content." },
      { icon: "⌨️", name: "Keyboard Shortcuts", desc: "Press Ctrl+K to search, Enter to send, and more." },
    ],
  },

  companies: {
    title: "Companies",
    intro: "Manage your workspaces. Each company has its own Knowledge Bases, Assistants, and settings.",
    features: [
      { icon: "➕", name: "Create Company", desc: "Add a new workspace for a different client, department, or project." },
      { icon: "✏️", name: "Edit Company", desc: "Change the company name, website URL, or other settings." },
      { icon: "🗑️", name: "Delete Company", desc: "Remove a workspace. This is permanent — all its data will be lost." },
      { icon: "🔑", name: "API Key", desc: "Generate or revoke an API key for programmatic access to this company's AI." },
      { icon: "🔄", name: "Refresh", desc: "Reload the list to see the latest companies." },
    ],
  },

  config: {
    title: "Settings",
    intro: "Configure your workspace's AI models, prompts, and preferences.",
    features: [
      { icon: "🤖", name: "Model Settings", desc: "Choose which AI model to use for questions (LLM) and embeddings (how text is converted to numbers for search)." },
      { icon: "📝", name: "System Prompt", desc: "Write the default instructions for your AI — how it should behave, what tone to use, and rules to follow." },
      { icon: "🔗", name: "URLs", desc: "Set your website URL, WordPress URL, and other endpoints." },
      { icon: "🔑", name: "Ask API Key", desc: "Generate a key to protect your Ask API. When enabled, only requests with this key can use your AI." },
      { icon: "📐", name: "Chunk Settings", desc: "Control how documents are split for AI processing — larger chunks give more context, smaller chunks give more precision." },
    ],
  },

  workflows: {
    title: "Workflows",
    intro: "Automate repetitive tasks by chaining AI actions together. Like having a personal assistant that runs tasks on schedule.",
    features: [
      { icon: "➕", name: "Create Workflow", desc: "Build a new automation. Give it a name, choose a trigger, and add steps." },
      { icon: "▶️", name: "Run", desc: "Execute a workflow immediately to test it." },
      { icon: "🟢", name: "Activate / Pause", desc: "Turn a workflow on or off. Active workflows can run on schedule." },
      { icon: "📜", name: "History", desc: "See past executions — what ran, when, and whether it succeeded." },
      { icon: "📝", name: "Step Editor", desc: "Add steps like: Ask AI, Send HTTP request, Ingest content, Send notification, Wait, or Branch on conditions." },
      { icon: "🔗", name: "Triggers", desc: "Choose when the workflow runs: manually, on a schedule (cron), via webhook, or on an event." },
    ],
  },

  scheduler: {
    title: "Scheduler",
    intro: "Set up recurring tasks that run automatically — like nightly content updates or periodic health checks.",
    features: [
      { icon: "➕", name: "Create Job", desc: "Schedule a task to run at a specific time or interval (e.g., every day at 2 AM)." },
      { icon: "▶️", name: "Run Now", desc: "Execute a scheduled job immediately without waiting for the next scheduled time." },
      { icon: "⏸️", name: "Pause / Resume", desc: "Temporarily stop a job from running without deleting it." },
      { icon: "🗑️", name: "Delete", desc: "Remove a scheduled job permanently." },
      { icon: "📊", name: "Status", desc: "See which jobs are running, completed, or failed." },
    ],
  },

  webhooks: {
    title: "Notifications",
    intro: "Get notified when things happen. Webhooks send alerts to external services (like Slack) when events occur.",
    features: [
      { icon: "➕", name: "Add Webhook", desc: "Set up a new notification. Enter the URL where alerts should be sent and choose which events trigger it." },
      { icon: "🧪", name: "Test", desc: "Send a test notification to verify your webhook URL works correctly." },
      { icon: "📋", name: "Logs", desc: "See delivery history — when notifications were sent and whether they succeeded." },
      { icon: "✏️", name: "Edit", desc: "Change the webhook URL, events, or secret." },
      { icon: "🗑️", name: "Delete", desc: "Remove a webhook notification." },
      { icon: "📡", name: "Events", desc: "Choose which events trigger notifications: ingestion completed, workflow finished, credentials rotated, etc." },
    ],
  },

  usage: {
    title: "Usage",
    intro: "Track how much your AI is being used and what it costs. Monitor tokens, requests, and spending.",
    features: [
      { icon: "📊", name: "Usage Charts", desc: "Visual breakdown of AI requests, tokens used, and costs over time." },
      { icon: "📈", name: "Trends", desc: "See if usage is going up or down compared to previous periods." },
      { icon: "💰", name: "Cost Tracking", desc: "Monitor how much you're spending on AI models and storage." },
      { icon: "🔄", name: "Refresh", desc: "Reload to see the latest usage data." },
    ],
  },

  cloudflare: {
    title: "Cloud Services",
    intro: "Manage your Cloudflare resources — storage buckets and vector search indexes used by your AI.",
    features: [
      { icon: "🗄️", name: "Storage Buckets", desc: "R2 buckets where your document chunks are stored. Each Knowledge Base gets its own bucket." },
      { icon: "🔍", name: "Vector Indexes", desc: "Search indexes that let your AI find relevant content. Each Knowledge Base uses one index." },
      { icon: "➕", name: "Create Index", desc: "Set up a new vector search index for a Knowledge Base." },
      { icon: "🗑️", name: "Delete", desc: "Remove a storage bucket or index you no longer need." },
    ],
  },

  catalog: {
    title: "AI Providers",
    intro: "Connect to AI services. Providers give you access to language models, embeddings, and other AI capabilities.",
    features: [
      { icon: "➕", name: "Add Provider", desc: "Connect a new AI service (Cloudflare, OpenAI, etc.) by entering your API credentials." },
      { icon: "🔑", name: "Credentials", desc: "Manage API keys and tokens for each provider. These are encrypted and stored securely." },
      { icon: "🤖", name: "Models", desc: "See which AI models are available from each provider and configure them for use." },
      { icon: "✅", name: "Verify Connection", desc: "Test that your API credentials work before using them." },
      { icon: "🔄", name: "Rotate Keys", desc: "Replace an old API key with a new one without losing your configuration." },
      { icon: "📊", name: "Provider Catalog", desc: "Browse available providers and their capabilities." },
    ],
  },
};

// ------------------------------------------------------------------
// PageHelpButton — the "?" icon in the header
// ------------------------------------------------------------------
export function PageHelpButton({ pageId }) {
  const [open, setOpen] = useState(false);
  const data = HELP_DATA[pageId];

  // Listen for ? keyboard shortcut
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-page-help", handler);
    return () => window.removeEventListener("open-page-help", handler);
  }, []);

  // Hide on pages with crowded headers (Test AI has too many controls)
  if (!data || pageId === "ask") return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Help — learn what you can do on this page"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
      </button>

      {open && (
        <PageHelpModal data={data} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

// ------------------------------------------------------------------
// PageHelpModal — the full-page feature guide
// ------------------------------------------------------------------
function PageHelpModal({ data, onClose }) {
  return (
    <Modal open={true} onClose={onClose} title={`📖 ${data.title} — Quick Guide`} wide>
      <div className="space-y-5">
        <p className="text-sm text-slate-300 leading-relaxed">{data.intro}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          {data.features.map((f, i) => (
            <div key={i} className="flex gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
              <span className="text-xl shrink-0">{f.icon}</span>
              <div>
                <h4 className="text-sm font-semibold text-slate-100">{f.name}</h4>
                <p className="text-xs text-slate-400 leading-relaxed mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
          <p className="text-xs text-indigo-300">
            💡 <strong>Tip:</strong> You can press <kbd className="mx-0.5 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px]">?</kbd> anywhere to open this guide, or use the <kbd className="mx-0.5 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px]">Ctrl+K</kbd> shortcut to search.
          </p>
        </div>
      </div>
    </Modal>
  );
}
