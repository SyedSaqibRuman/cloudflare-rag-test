---
id: kb-resource-binding/002
title: Edit KB wizard does not pre-fill previously saved vector/storage/model selections
status: open
labels: [ready-for-agent]
---

## Problem

Opening the Edit wizard for an existing KB (Knowledge Bases page → Edit, or
the KB detail page → edit) can show empty Vector Store / Object Storage /
Embedding Model dropdowns even though the KB was saved with them. The user
cannot tell what is configured, and re-saving from this state silently keeps
or clears the previous binding.

Two independent defects:

1. **Open-race on the KB detail page.** The form is only populated on the
   closed→open transition. If the modal opens while the KB row is still
   loading (`row` is `null`), the form initializes empty and is never
   re-populated when the row arrives.
2. **No persisted binding to show.** For KBs created/edited with a *live*
   Cloudflare resource, `vector_resource_id` / `storage_resource_id` are NULL
   in the DB (see `kb-resource-binding/001`), so there is genuinely nothing to
   pre-fill — the dropdowns correctly fall back to "Company default (config)".
   Fixing 001 removes this case; this issue tracks the modal-side defects.

## Evidence

- `web/src/components/kb-modal.jsx:168-198` — reset effect is guarded by
  `if (open && !wasOpen.current)` and ends with `wasOpen.current = open`, so a
  `row` change while already open never re-populates the form. Deps are
  `[open, row, company]` but the guard eats the re-run.
- `web/src/pages/KbDetail.jsx:824-830` — `<KbModal open={editOpen} row={kb} …>`
  where `kb` comes from an async `loadKb()`; `editOpen` can be true while
  `kb` is still `null` (initial render, refetch after save).
- `web/src/components/kb-modal.jsx:171-174` — pre-fill maps
  `row.vector_resource_id` → `String(id)`; the `<select>` renders blank until
  `getKbOptions()` resolves (async, fired inside the same effect). If that
  call fails (caught at line 209, only `console.error`), the dropdowns stay
  empty with no user-visible hint, and the saved id can never be displayed.
- Cross-ref: `mysql/repositories/kb.js:9-17` JOIN is the source of the
  pre-fill fields; NULL ids (issue 001) → empty pre-fill.

## Task

Smallest clean change in `web/src/components/kb-modal.jsx`:

1. Re-populate the form whenever the modal is open and the effective row
   identity changes — replace the `open && !wasOpen.current` guard with an
   "open transition OR row changed while open" condition (keep the create-mode
   defaults when `row` is null).
2. Surface `getKbOptions()` failure in the modal (small warning line near the
   selectors, same pattern as `resourcesNote` on `web/src/pages/Config.jsx`)
   instead of only logging to the console.
3. Optional guard: while `row` is set but the KB detail row is still loading,
   delay rendering the modal body (or show a skeleton) so the user never sees
   a half-empty edit form.

Test note: the portal has no component-test harness for the modal; verify
manually via the wizard (create → edit → re-save) and keep the pure-ESM test
suite green (`npm test`).
