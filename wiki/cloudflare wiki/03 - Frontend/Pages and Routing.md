---
type: frontend
status: active
area: frontend
tags: [routing, navigation]
related:
  - "[[Frontend Overview]]"
---

# Pages and Routing

## Hash routing core (`web/src/hooks.js useHashRoute`)

State = `location.hash.slice(1)` defaulting to "dashboard"; listener on hashchange only — zero history API usage. Detail segments split on "/": first segment selects page; remainder passed to the page as its own mini-path (e.g. `#catalog/cloudflare` → Catalog page receives path to open provider detail).

```mermaid
flowchart LR
    Hash["#segment/sub"] --> Hook[useHashRoute] --> Gate{"useAuth.authed?"}
    Gate -->|no| Login[LoginPage]
    Gate -->|yes| CP[CompanyProvider wraps Layout]
    CP --> SEG{PAGES seg lookup}
    SEG -->|unknown| DASH[Dashboard]
    SEG -->|match| PAGE[Lazy(page)+PageErrorBoundary+Suspense]
```

## Registry & code splitting (`App.jsx`)

```js
const PAGES = { dashboard, ask, companies, config, cloudflare, scheduler, logs, catalog, assistants, ingestion }
```
All lazy-imported; `PageErrorBoundary` detects chunk-load failures specifically (`ChunkLoadError` regexes) and offers keyed remount retry. Auth gate renders before any admin layout mounts.

## Sidebar definition (`components/layout/nav.js`)

NAV groups render icons from `layout/icons.jsx`; sections: Overview(dashboard) · AI(ask, ingestion=Knowledge Bases label, assistants) · Companies(companies, config) · Infrastructure(cloudflare?, scheduler) · Gateway(catalog="Providers").

Runtime filtering rule: the cloudflare item is removed unless selected company has Cloudflare credentials (comment + implementation detail recorded here as read).

`PAGE_META` supplies title/subtitle strings consumed by Layout header. The Logs page exists with PAGE_META but has no NAV entry — reachable deep-link (#logs); flag for intentional hidden tool or future nav restoration (**verified absence, intent unknown**).

## In-page sub-navigation examples

- Catalog detail manages tabs internally via `path` prop (connections card, models card, resources card...).
- Ingestion page toggles between list view and KB detail using its own local state rather than nested hashes.

## Implications when adding pages

Add lazy import + PAGES entry + NAV/PAGE_META row simultaneously to avoid dead-end deep links; keep hash ids lowercase ASCII since they surface in localStorage errors/console tag lines elsewhere.