---
type: frontend
status: active
area: frontend
tags: [components]
related:
  - "[[Frontend Overview]]"
---

# Component Architecture

## Directory shape (confirmed)

```
web/src/components/
  Layout.jsx              shell: sidebar(NAV)+header(PAGE_META)+content slot+theme toggle
  layout/{nav.js,icons.jsx}
  company-select.jsx      tenant switcher bound to CompanyProvider
  theme-toggle.jsx        light/dark/system persistence (pc_theme) via ui Popover
  ui.jsx                  shared buttons/badges/inputs baseline
  ui/                     feedback.jsx form.jsx helpers.js layout.jsx overlay.jsx
                          pagination.jsx index.js ScrollToTop.jsx   (component kit)
  Markdown.jsx            safe-ish markdown renderer for answers
  kb-modal.jsx            KB create modal reused by ingestion pages
pages/
  catalog/                list.jsx detail.jsx wizard.jsx wizard/{helpers,steps,inline-editor}.jsx
                          modals.jsx modals/{add-compatible-model...etc per file}
                          connections-card.jsx models-card.jsx cloudflare-resources-card.jsx
                          useCatalog.js constants.js utils.js icons.jsx components.jsx
                          chunk-error-boundary.jsx switcher? (switcher utils)
  credentials/            use-credential-modal.js modals.jsx cards.jsx fields.jsx helpers.js icons.jsx
  config/                 AskApiKeyCard.jsx ChatPlaygroundCard.jsx
```

## Structural conventions

1. **Page + colocated module folder** pattern for complex domains (catalog, credentials): a `page/detail` orchestrator plus composable child components and one hook extracting data state (`useCatalog.js`).
2. **One modal = one file** inside domain folders (catalog/modals/*), each exporting named component through local barrel.
3. **Shared kit first:** before creating a widget, extend `components/ui/*`; kit exports consolidated at `ui/index.js`.
4. **Cross-portal logic lives in helpers** (`catalog/utils.js` imports server-shared error tagging via #shared alias so Test Results coloring matches backend diagnoses).

## State lifting example — provider wizard

wizard steps call useCatalog mutations; inline-editor handles nested model rows; completion triggers registry refresh on catalog page. Ownership boundaries keep wizard reusable for both create & edit flows (steps receive mode prop).

## Error boundary strategy

Top-level PageErrorBoundary resets per route key; catalog adds its own finer-grained boundary (`chunk-error-boundary.jsx`) around lazy chunk consumers to retry section loads without losing form input.

## Adding a new page checklist

1. Create pages/<Name>.jsx with useToast/notify integration.
2. Add NAV item (+PAGE_META), wire icon.
3. Lazy import into App PAGES map.
4. Use api.js exported wrappers only; add wrapper when new endpoint exists.
5. Extend kits instead of bespoke CSS where possible ([[UI Patterns]]).