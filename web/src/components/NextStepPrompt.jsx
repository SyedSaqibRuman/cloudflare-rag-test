// --------------------------
// NEXT STEP PROMPT — post-action guidance banners.
// Shows contextual "What should I do next?" prompts after completing major actions.
// --------------------------
import { useState, useEffect } from "react";
import { Button } from "./ui";
import { cx } from "../util";

const STORAGE_KEY = "pc_next_step_dismissed";

function loadDismissed() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveDismissed(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

// ------------------------------------------------------------------
// Prompt definitions — keyed by context
// ------------------------------------------------------------------
const PROMPTS = {
  "kb-created": {
    title: "Knowledge base created! 🎉",
    description: "Now import your content so your AI can learn from it.",
    actions: [
      { label: "Import Content", route: "ingestion", variant: "primary" },
      { label: "Skip for now", dismiss: true },
    ],
  },
  "kb-ingested": {
    title: "Content imported successfully!",
    description: "Your knowledge base is ready. Now create an assistant to use it.",
    actions: [
      { label: "Create Assistant", route: "assistants", variant: "primary" },
      { label: "Skip for now", dismiss: true },
    ],
  },
  "assistant-created": {
    title: "Assistant created! 🤖",
    description: "Test it to make sure it answers questions correctly.",
    actions: [
      { label: "Test in Console", route: "ask", variant: "primary" },
      { label: "Skip for now", dismiss: true },
    ],
  },
  "provider-connected": {
    title: "AI provider connected! ✅",
    description: "Now create an assistant to start using this provider.",
    actions: [
      { label: "Create Assistant", route: "assistants", variant: "primary" },
      { label: "Skip for now", dismiss: true },
    ],
  },
  "workflow-created": {
    title: "Workflow created! ⚡",
    description: "It will run on its schedule. Check the scheduler to monitor it.",
    actions: [
      { label: "View Scheduler", route: "scheduler", variant: "primary" },
      { label: "Skip for now", dismiss: true },
    ],
  },
};

// ------------------------------------------------------------------
// NextStepPrompt component
// ------------------------------------------------------------------
export default function NextStepPrompt({ context, navigate }) {
  const [dismissed, setDismissed] = useState(loadDismissed);
  const prompt = PROMPTS[context];

  if (!prompt || dismissed.includes(context)) return null;

  const handleDismiss = () => {
    const next = [...dismissed, context];
    setDismissed(next);
    saveDismissed(next);
  };

  const handleAction = (action) => {
    if (action.dismiss) {
      handleDismiss();
    } else if (action.route) {
      navigate(action.route);
    }
  };

  return (
    <div
      role="status"
      className={cx(
        "rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3",
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
          <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-indigo-300">{prompt.title}</p>
          <p className="text-xs text-slate-400 mt-0.5">{prompt.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-11 sm:ml-0">
        {prompt.actions.map((action, idx) => (
          <Button
            key={idx}
            size="sm"
            variant={action.variant || "ghost"}
            onClick={() => handleAction(action)}
          >
            {action.label}
          </Button>
        ))}
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded p-1 text-slate-600 hover:text-slate-400"
          title="Dismiss"
        >
          <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Helper: trigger a next-step prompt (call after a successful action)
// ------------------------------------------------------------------
export function triggerNextStep(context) {
  // This is a simple event-based system — components can listen for these
  // and show the appropriate prompt.
  window.dispatchEvent(new CustomEvent("next-step", { detail: { context } }));
}
