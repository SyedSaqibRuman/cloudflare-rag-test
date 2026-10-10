// --------------------------
// SETUP CHECKPOINTS BANNER
// Horizontal sequential stepper for the company configuration process:
//   1 Workspace → 2 AI Provider → 3 Vector Index → 4 Document Storage →
//   5 Ingest Content → 6 Test Chat.
// Rendered at the top of every page ONLY while the selected company's setup
// is incomplete, so the user can configure in exactly that order. Dismissal
// is in-memory only — a reload brings the banner back while setup remains
// unfinished. When every checkpoint is done, the banner disappears.
// --------------------------
import { useEffect, useState } from "react";
import { getSetupStatus } from "../api";
import { useCompanies } from "../context";
import { cx } from "../util";
import { Button } from "./ui";

// ------------------------------------------------------------------
// Step visuals
// ------------------------------------------------------------------
function StepIcon({ step, index, isNext }) {
  if (step.done) {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400" title={step.description}>
        <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }
  if (isNext) {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white shadow-[0_0_0_4px] shadow-indigo-500/20"
        title={step.description}
      >
        {index + 1}
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-xs font-medium text-slate-500" title={step.description}>
      {index + 1}
    </span>
  );
}

// ------------------------------------------------------------------
// The banner
// ------------------------------------------------------------------
export default function SetupCheckpoints({ navigate }) {
  const { company } = useCompanies();
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false); // in-memory only
  const [focusedId, setFocusedId] = useState(null); // deep-link highlight

  useEffect(() => {
    let alive = true;
    if (!company) {
      setStatus(null);
      return undefined;
    }
    setDismissed(false); // switching company re-shows the banner
    // Re-check whenever the company changes; a light poll keeps the banner in
    // sync when the user completes steps in other tabs.
    const load = () => {
      getSetupStatus(company)
        .then((d) => alive && setStatus(d))
        .catch(() => alive && setStatus(null));
    };
    load();
    const id = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [company]);

  // Deep-link target: the onboarding wizard's overlapping steps fire
  // pc:focus-checkpoint instead of duplicating this bar's guidance — un-dismiss,
  // highlight the checkpoint, and scroll it into view. The wizard already
  // navigated to the checkpoint's route, so this runs on the landing page.
  useEffect(() => {
    const onFocus = (e) => {
      const id = e.detail?.id;
      if (!id) return;
      setDismissed(false);
      setFocusedId(id);
      const t = setTimeout(() => {
        const el = document.querySelector(`[data-checkpoint-id="${id}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 80);
      const clear = setTimeout(() => setFocusedId(null), 3500);
      return () => {
        clearTimeout(t);
        clearTimeout(clear);
      };
    };
    window.addEventListener("pc:focus-checkpoint", onFocus);
    return () => window.removeEventListener("pc:focus-checkpoint", onFocus);
  }, []);

  if (!company || !status || status.complete || dismissed) return null;

  const { steps, next, doneCount, total } = status;

  return (
    <div
      role="region"
      aria-label="Setup checkpoints"
      className="mb-5 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.04] px-4 py-3"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-medium text-indigo-300">
              Finish setting up <span className="font-semibold">{company}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {doneCount} of {total} steps complete
              {next ? (
                <>
                  {" "}— next up: <span className="font-medium text-slate-300">{next.label}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 lg:shrink-0">
          {next && (
            <Button size="sm" onClick={() => navigate?.(next.route)}>
              Continue setup
            </Button>
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded p-1 text-slate-500 transition-colors hover:text-slate-400"
            title="Dismiss for this session"
            aria-label="Dismiss setup checkpoints"
          >
            <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Horizontal stepper — sequential order, left to right */}
      <ol className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-3 lg:grid-cols-7 lg:gap-x-1">
        {steps.map((step, i) => {
          const isNext = next?.id === step.id;
          return (
            <li key={step.id} className="min-w-0" data-checkpoint-id={step.id}>
              <button
                type="button"
                onClick={() => navigate?.(step.route)}
                className={cx(
                  "group flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
                  focusedId === step.id
                    ? "border-indigo-400 bg-indigo-500/20 ring-2 ring-indigo-500/30" // deep-link highlight pulse
                    : isNext
                      ? "border-indigo-400/40 bg-indigo-500/10 hover:bg-indigo-500/15"
                      : step.done
                        ? "border-transparent hover:border-slate-700/60 hover:bg-slate-800/40"
                        : "border-transparent hover:border-slate-700/60 hover:bg-slate-800/40"
                )}
                title={step.description}
              >
                <StepIcon step={step} index={i} isNext={isNext} />
                <span className="min-w-0">
                  <span
                    className={cx(
                      "block truncate text-xs font-medium",
                      isNext ? "text-indigo-300" : step.done ? "text-slate-300" : "text-slate-500"
                    )}
                  >
                    {step.label}
                  </span>
                  {step.detail ? (
                    <span className="block truncate text-[10px] text-slate-500">{step.detail}</span>
                  ) : null}
                </span>
                {/* sequential connector — hides on the last item */}
                {i < steps.length - 1 && (
                  <span aria-hidden="true" className="ml-auto hidden h-px w-3 shrink-0 bg-slate-700 lg:block" />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
