---
type: frontend
status: active
area: frontend
tags: [portal, overview]
related:
  - "[[Pages and Routing]]"
  - "[[API Integration]]"
---

# Frontend Overview

## Purpose

A single-page **admin portal** bundled by Vite into `web/dist`, served by the Express process itself. It manages companies, providers/credentials, knowledge bases/assistants, config, scheduler, logs, and hosts an Ask Console with live streaming.

## Tech profile (verified)

React 18 + Vite 6 + Tailwind 4 (`@tailwindcss/vite` plugin; no PostCSS config), JSX without TypeScript, **no component/state/UI libraries** — menus and popovers are in-house primitives under `components/ui`. Tests are pure-ESM colocated (`web/src/**/__tests__`) executed through the root `npm test` glob — no Jest/Vitest.

Build pipeline highlights from `web/vite.config.js`:

- alias `#shared` → repo-root `shared/` so error-tag/patterns/enums are shared source-of-truth modules.
- dev server proxies `/_health /cloudflare /ask /auth` → :3000 and allows host `*.monkeycode-ai.live`.
- `ANALYZE=true npm run build` emits rollup visualizer treemap.
- Lazy pages via `React.lazy` (comment: initial bundle ~886 KB → ~428 KB).

## Page inventory

| Hash route | File(s) | Role |
|---|---|---|
| #dashboard | pages/Dashboard.jsx | overview stats/live state |
| #ask | AskConsole.jsx | streaming QA playground (SSE parser) |
| #companies | Companies.jsx | tenant CRUD |
| #config (+config/) | Config.jsx, config/AskApiKeyCard.jsx, config/ChatPlaygroundCard.jsx | per-company config sections |
| #cloudflare | Cloudflare.jsx | index/bucket lists — nav item hidden unless company has CF creds |
| #scheduler | Scheduler.jsx | jobs/cron/presets/ingest triggers |
| #logs | Logs.jsx | file viewer/clear/download (**no sidebar item currently**) |
| #catalog | Catalog.jsx + catalog/* | Providers catalog wizard/detail; embeds credentials module |
| #assistants | Assistants.jsx | persona builder incl KB/graph bindings |
| #ingestion | Ingestion.jsx (+ IngestionList.jsx) | Knowledge Bases list/detail hub |

Legacy/remnant files kept in tree but not routed: KbList.jsx/KbDetail.jsx/SourcePagePicker.jsx/Credentials.jsx/Credentials page — the active ingestion page owns KB UX and connections live inside catalog detail (`web/src/pages/catalog/connections-card.jsx` consuming `pages/credentials/*` helpers). Confirmed from App.jsx import graph.

## UX conventions

- Every destructive action asks inline confirmation modals.
- Toast system unified via `useToast` hook → also mirrored to server UI log ([[Logging & Audit]]).
- Dark-first palette with `pc_theme` switcher ([[UI Patterns]]).