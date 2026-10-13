---
type: frontend
status: active
area: frontend
tags: [styling, tailwind]
related:
  - "[[Component Architecture]]"
---

# UI Patterns

## Styling approach

Tailwind 4 utility classes exclusively; theme tokens implicit in Tailwind defaults with slate palette dominant; dark-mode-first components with explicit dark: variants retained for the light theme toggle path.

## Theme switching

- `web/index.html` blocks render pre-boot reading localStorage **pc_theme** (values light/dark/system default system), resolving against matchMedia(prefers-color-scheme) toggling `.dark` class on root.
- Header `theme-toggle.jsx` opens an in-house Popover (`components/ui`) offering the same triad; writes pc_theme and updates class live.
- CSS includes custom utilities `@utility menu-enter/menu-exit` animating dropdown mounts; global reduced-motion media query disables them.
Menu/popover behavior is implemented by hand inside `components/ui` (overlay primitives) — zero external UI dependencies; the enter/exit animation utilities respect the global reduced-motion query.

## Forms & validation UX

Forms rely on html-native inputs styled by kit; client-side checks import shared regexes/patterns (#shared/patterns.js) and enum arrays from models.js/models sections mirrors (single source of truth promise). Server errors mapped into field hints using ValidationErrorMap joins inside api.js.

## Feedback

- Success/failure surfaced through unified toast top-right via useToast; tones green/red drive badge styling automatically (tone strings align with shared/status.js statusTone vocabulary).
- Long-running operations show inline progress or skeleton rows; polling handled by usePoll rather than websockets (absence confirmed).
- Streaming answer area uses spinner → "Thinking..." placeholder replaced upon __start frame carrying sources/matches/graph metadata ([[API Integration]]).

## Empty & error states conventions

Every list view defines empty-state copy inline (e.g., catalog empty prompts creation CTA) and expects api() thrown Errors as message source; no global toaster outside hook.

## Accessibility observations (not exhaustive)

Interactive primitives delegate to native elements/Radix parts; focus rings appear via Tailwind ring utilities consistently in reviewed files.

**Not confirmed / not audited:** full WCAG compliance, keyboard nav coverage across all custom widgets beyond documented Radix usage, lighthouse scoring.