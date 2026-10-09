// --------------------------
// ONBOARDING WIZARD — guided first-use experience.
// Shows a step-by-step flow: Content → AI Setup → Assistant → Test → Done.
//
// Progress model (v2):
// - Steps 1–3 are verified against REAL workspace state per company
//   (KB exists / provider connection exists / assistant exists) — clicking
//   through is no longer required to complete them.
// - Step 4 (Test AI) stays manual: there is no persisted record of a test
//   conversation, so it completes via click-through or "Mark as done".
// - All state is scoped to the selected company (progress, dismiss, collapse)
//   under namespaced localStorage keys; legacy un-namespaced keys are ignored.
// --------------------------
import { useState, useEffect } from "react";
import { Card, Button, Badge, Spinner } from "./ui";
import { cx } from "../util";
import { useCompanies } from "../context";
import { listKbs, listAssistants, listCredentials, getSetupStatus } from "../api";
import { checkWorkspaceState, checkpointLinkResolver } from "../onboarding-state.js";

const PROGRESS_KEY = "pc_onboarding_progress"; // + :company
const DISMISS_KEY = "pc_onboarding_dismissed"; // + :company
const COLLAPSE_KEY = "pc_onboarding_collapsed"; // + :company

/** Company-scoped localStorage key. No company selected → shared fallback. */
function keyFor(company, base) {
  return company ? `${base}:${company}` : base;
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------
// Step definitions
// ------------------------------------------------------------------
const STEPS = [
  {
    id: "content",
    title: "Add Your Content",
    description: "Create a knowledge base from your website, WordPress, or files.",
    icon: (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    action: { label: "Add Knowledge", route: "ingestion" },
    tip: "Start with your website URL — we'll automatically fetch and index your pages.",
    autoCheck: "kb",
  },
  {
    id: "ai-setup",
    title: "Connect AI Services",
    description: "Link your Cloudflare, OpenAI, or other AI provider credentials.",
    icon: (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    action: { label: "Set Up Providers", route: "catalog" },
    tip: "You need at least one AI provider connected to create an assistant.",
    autoCheck: "credentials",
  },
  {
    id: "assistant",
    title: "Create an Assistant",
    description: "Set up an AI assistant that uses your content to answer questions.",
    icon: (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4" />
      </svg>
    ),
    action: { label: "Create Assistant", route: "assistants" },
    tip: "An assistant combines your knowledge base with an AI model to give smart answers.",
    autoCheck: "assistants",
  },
  {
    id: "test",
    title: "Test Your AI",
    description: "Ask questions and see how your assistant responds.",
    icon: (
      <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    action: { label: "Test AI", route: "ask" },
    tip: "Try asking questions about your content to see the AI in action.",
    autoCheck: null, // manual only — no persisted record of a test run
  },
];

// ------------------------------------------------------------------
// Hook: is onboarding needed for this company?
// ------------------------------------------------------------------
export function useOnboarding() {
  const { company } = useCompanies();
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(localStorage.getItem(keyFor(company, DISMISS_KEY)) !== "1");
  }, [company]);

  return {
    show,
    dismiss: () => {
      localStorage.setItem(keyFor(company, DISMISS_KEY), "1");
      setShow(false);
    },
  };
}

// Real-state probe moved to ../onboarding-state.js (pure ESM, unit-tested).
// Divergence note: these probes detect workspace ARTIFACTS (a credential row
// exists), not config health — a revoked token leaves the wizard green while
// SetupCheckpoints (setup-status) correctly flips to incomplete.

// ------------------------------------------------------------------
// OnboardingWizard component
// ------------------------------------------------------------------
export default function OnboardingWizard({ navigate, onDismiss }) {
  const { company } = useCompanies();
  const [manual, setManual] = useState(() => readJson(keyFor(company, PROGRESS_KEY)));
  const [expanded, setExpanded] = useState(() => localStorage.getItem(keyFor(company, COLLAPSE_KEY)) !== "1");
  const [auto, setAuto] = useState(null); // null = checking workspace
  const [setupStatus, setSetupStatus] = useState(null);

  // Re-read company-scoped state + check real workspace state on company change.
  useEffect(() => {
    setManual(readJson(keyFor(company, PROGRESS_KEY)));
    setExpanded(localStorage.getItem(keyFor(company, COLLAPSE_KEY)) !== "1");
    let alive = true;
    setAuto(null);
    setSetupStatus(null);
    if (!company) {
      setAuto({});
      return;
    }
    checkWorkspaceState({ company, listKbs, listCredentials, listAssistants }).then((state) => {
      if (alive) setAuto(state);
    });
    // Checkpoint status powers the deep-links: overlapping steps point at the
    // authoritative "Finish setting up" bar instead of re-listing guidance.
    // Best-effort — no status just means steps keep their own action buttons.
    getSetupStatus(company)
      .then((d) => alive && setSetupStatus(d))
      .catch(() => alive && setSetupStatus(null));
    return () => {
      alive = false;
    };
  }, [company]);

  const isDone = (stepId) => auto?.[stepId] === true || manual[stepId] === true;
  const completedCount = STEPS.filter((s) => isDone(s.id)).length;
  const allDone = completedCount === STEPS.length;
  const currentStep = STEPS.find((s) => !isDone(s.id)) || STEPS[STEPS.length - 1];
  const currentIdx = STEPS.findIndex((s) => s.id === currentStep.id);
  const checking = auto === null;

  const persistManual = (next) => {
    setManual(next);
    localStorage.setItem(keyFor(company, PROGRESS_KEY), JSON.stringify(next));
  };

  const markComplete = (stepId) => {
    if (!manual[stepId]) persistManual({ ...manual, [stepId]: true });
  };

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem(keyFor(company, COLLAPSE_KEY), next ? "" : "1");
  };

  const handleDismiss = () => {
    localStorage.setItem(keyFor(company, DISMISS_KEY), "1");
    onDismiss?.();
  };

  if (allDone) {
    return (
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
            <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-emerald-300">🎉 You're all set up!</h3>
            <p className="mt-1 text-sm text-slate-400">
              You've completed all the setup steps. Your AI is ready to answer questions.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={handleDismiss}>
            Dismiss
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-indigo-500/20 bg-indigo-500/5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-indigo-300">
              Getting Started — Step {currentIdx + 1} of {STEPS.length}
            </h3>
            <p className="text-xs text-slate-500">
              {checking ? "Checking your workspace…" : `${completedCount}/${STEPS.length} completed`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleExpanded}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800/70 hover:text-slate-300"
            title={expanded ? "Collapse" : "Expand"}
          >
            <svg aria-hidden="true" className={`h-4 w-4 transition-transform ${expanded ? "" : "-rotate-90"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800/70 hover:text-slate-300"
            title="Dismiss"
          >
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-2">
          {STEPS.map((step, idx) => {
            const autoDone = auto?.[step.id] === true;
            const done = isDone(step.id);
            const isCurrent = step.id === currentStep.id && !done && !checking;
            // Deep-link wiring: covered steps point at the matching checkpoint
            // (null when no status / tour-only step → own action button).
            const link = checkpointLinkResolver(setupStatus)(step.id);

            return (
              <div
                key={step.id}
                className={cx(
                  // flex-wrap: on narrow screens the action drops to its own
                  // right-aligned line instead of squeezing the text column
                  // to ~100px (390px viewport audit).
                  "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5 transition-colors",
                  isCurrent && "bg-indigo-500/10 border border-indigo-500/20",
                  done && "opacity-60",
                  !done && !isCurrent && "opacity-40"
                )}
                data-checkpoint-link={link ? link.checkpointId : undefined}
              >
                <div className={cx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold",
                  done
                    ? "bg-emerald-500/20 text-emerald-400"
                    : isCurrent
                      ? "bg-indigo-500/20 text-indigo-400"
                      : "bg-slate-800 text-slate-300"
                )}>
                  {done ? (
                    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <div className="flex-1 min-w-40 sm:min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cx(
                      "text-sm font-medium",
                      done ? "text-slate-400 line-through" : isCurrent ? "text-slate-100" : "text-slate-400"
                    )}>
                      {step.title}
                    </span>
                    {done && autoDone && <Badge tone="green" className="text-[10px]" title="Detected in this workspace">Done · detected</Badge>}
                    {done && !autoDone && <Badge tone="green" className="text-[10px]">Done</Badge>}
                    {isCurrent && <Badge tone="indigo" className="text-[10px]">Current</Badge>}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>
                  {isCurrent && (
                    <p className="text-xs text-indigo-400/70 mt-1 italic">{step.tip}</p>
                  )}
                  {!done && link && link.isNext && (
                    <p className="mt-0.5 text-[10px] uppercase tracking-wider text-indigo-400/60">
                      ↳ Tracked by the setup bar above
                    </p>
                  )}
                </div>
                <div className="flex w-full items-center justify-end gap-1.5 sm:w-auto">
                  {checking ? (
                    <Spinner className="h-3.5 w-3.5 text-slate-500" />
                  ) : (
                    <>
                      {!done && link && link.open && (
                        <Button
                          size="sm"
                          variant={isCurrent ? "primary" : "ghost"}
                          onClick={() => {
                            // Deep-link into the setup-checkpoints bar: it un-dismisses,
                            // highlights the matching checkpoint, and scrolls to itself.
                            // The checkpoint's own route navigation handles the landing page.
                            window.dispatchEvent(
                              new CustomEvent("pc:focus-checkpoint", { detail: { id: link.checkpointId } })
                            );
                            navigate(link.route);
                            markComplete(step.id);
                          }}
                          title={`Guided by the setup bar — ${link.label}`}
                        >
                          {step.action.label}
                        </Button>
                      )}
                      {!done && (!link || !link.open) && (
                        <Button
                          size="sm"
                          variant={isCurrent ? "primary" : "ghost"}
                          onClick={() => {
                            navigate(step.action.route);
                            if (!done) markComplete(step.id);
                          }}
                        >
                          {step.action.label}
                        </Button>
                      )}
                      {!done && step.autoCheck === null && (
                        <button
                          type="button"
                          onClick={() => markComplete(step.id)}
                          className="rounded p-1.5 text-slate-500 hover:text-slate-400"
                          title="Mark as done"
                        >
                          <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
