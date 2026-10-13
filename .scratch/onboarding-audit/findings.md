---
id: onboarding-wizard-audit/001
title: Visual test of onboarding steps — results and gaps
status: open
labels: [ready-for-agent]
date: 2026-09-15
---

## Scope

Visual end-to-end pass of the Dashboard onboarding wizard
(`web/src/components/OnboardingWizard.jsx`): 4 steps — Content → AI Setup →
Assistant → Test — with localStorage progress (`pc_onboarding_progress`) and
dismiss flag (`pc_onboarding_dismissed`). Tested in the live portal (dark mode,
Maxicert workspace, 1280px viewport) via agent-browser.

## Test results (all verified live)

| Behavior | Result |
|---|---|
| Initial render: "Step 1 of 4", current step highlighted with tip, others dimmed | ✅ |
| Step 1 button navigates to `#ingestion` + marks complete | ✅ (after fix below) |
| Step 2 → `#catalog`, Step 3 → `#assistants`, Step 4 → `#ask` | ✅ |
| Header counter advances ("Step 2 of 4"), Done badge + strikethrough | ✅ |
| Collapse/Expand toggle | ✅ |
| Progress persists across reload | ✅ |
| "Mark as done" (skip) checkmark | ✅ |
| All-done celebration card ("🎉 You're all set up!") | ✅ |
| Dismiss hides wizard and survives reload | ✅ |
| No horizontal overflow / row overflow at 1280px | ✅ |
| Console errors during the whole pass | ✅ none |

## Bug found & fixed during the test

**Step buttons navigated to `#undefined`.** `OnboardingWizard` called
`navigate(step.route)` but the route lives at `step.action.route` — every step
button marked itself complete and then sent the user to a dead hash. Fixed in
`web/src/components/OnboardingWizard.jsx` (navigate now uses
`step.action.route`); rebuilt and re-verified live. Lint + build green.

## Gaps (open, minor — by design or low impact)

1. **Completion is click-based, not verification-based.** Marking a step done
   only records the click; nothing checks a KB/provider/assistant actually
   exists. Acceptable for simplicity, but the wizard can show "all set" on an
   empty workspace (verified: it does, if you click through all 4 steps).
2. **No way to un-complete a step.** Once marked (accidentally or via skip),
   the only resets are full dismiss + clearing localStorage by hand. A small
   "reset" affordance on done rows would help demos/retests.
3. **Collapse state does not persist.** `expanded` is component state
   initialized `true`; after reload the card re-expands. Auto-expand-when-
   incomplete intentionally overrides, but remembering manual collapse would
   be a one-line localStorage addition.
4. **Progress is per-browser, not per-company or per-user.** localStorage is
   not scoped to the selected company — completing onboarding for Maxicert
   marks it done for every workspace on that browser. A `pc_onboarding_` +
   company key would scope it.
5. **Dismissed is forever.** A dismissed wizard never re-shows, even if new
   steps ship later. If steps change, bumping the STORAGE_KEY (v2) would
   re-engage users.
6. **Mobile widths untested.** Verified 1280px only; below 640px the step rows
   stack buttons under text (`hidden sm:inline` labels in StepBar are for the
   KB wizard, not this one) — spot-check on a real phone viewport before
   calling it fully responsive.

## Suggested priority

- Ship now: the `#undefined` fix (done).
- Nice-to-have: #3 (persist collapse) and #4 (per-company progress) — both tiny.
- Defer: #1, #2, #5, #6 unless users report confusion.

---

## UPDATE 2026-09-15 (later session): gaps closed + wizard v2

**Resolved in `web/src/components/OnboardingWizard.jsx` (rebuilt + verified live):**

- **#1 (click-based completion) → real-state verification.** Steps 1–3 now
  auto-complete from the workspace: KB exists (`GET /gateway/kbs`), provider
  credential exists (`GET /gateway/companies/:key/credentials`), assistant
  exists (`GET /gateway/assistants`). Detected steps show "Done · detected";
  completion survives even if localStorage is cleared. Step 4 (Test AI) stays
  manual — there is no persisted record of a test run.
- **#3 (collapse persistence)** — collapse state stored per company under
  `pc_onboarding_collapsed:<company>`, restored on load/reload.
- **#4 (per-company scoping)** — progress, dismiss, and collapse keys are all
  namespaced `:<company>`. Verified live: maxicert shows 3/4 detected, the
  empty `test` workspace shows 0/4 on the same browser. Legacy un-namespaced
  keys are ignored (fresh start, no migration needed).
- **#6 (mobile)** — spot-checked at 390×844: no horizontal scroll, steps stack,
  no clipped buttons; "Mark as done" hit area bumped 22→26px (was under the
  24px minimum).

**Still open:** #2 (no un-complete affordance), #5 (dismissed stays dismissed
across wizard-shape changes — moot until steps change; the v2 key namespacing
acts as a re-engagement bump this time).
