---
type: backend
status: active
area: backend
tags: [api, design]
related:
  - "[[Routes Map]]"
  - "[[API Reference]]"
---

# API Architecture

## Conventions (consistent across all routers)

1. **JSON envelope:** success → `{ success:true, ...payload }`; typed failure → `{ success:false, error, code?, errors? }` (see [[Error Handling]]).
2. **Company scoping:** header `x-company-name` primary on RAG/admin-config paths; gateway uses path params (`/gateway/companies/:key/...`) plus repositories keyed by company_id. Helper precedence order is documented in `utils/request-context.js` (header → `?company=` → `body.company`, first non-empty wins where supported).
3. **Idempotent-ish CRUD:** soft deletes on tenants/resources rows where the v5 schema defines `deleted_at`; unique keys enforced with 409 conflicts rather than upserts.
4. **Pagination:** gateway list endpoints share `parsePagination`/`paginate` helpers (`mysql/routes/pagination.js`); classic admin lists return arrays.
5. **Auth metadata:** every protected mount chain appears twice by design — outer `requireAdmin` (auth) and inner guards where needed (e.g. `gate` 503) — never merge them silently.

## Route grouping architecture

```mermaid
flowchart LR
    APP[app.js] --> GATE[/gateway/] & CFADM[/cloudflare/] & ASK[/ask,/ask-stream,/ask\/reset/] & AUTHR[/auth/] & LOGS[/logs/] & DOCS[/api-docs/] & HLT[/_health,/]
    subgraph cloudflare mounts
        G2[routes/cloudflare.js<br/>companies | companies/:name/apikey | indexes | buckets | config | prompt] 
        C1[routes/cron.js<br/>presets CRUD · job/start·stop · cron/start·stop · jobs · jobs/running · status]
    end
    CFADM --> G2 & C1
```

The **/cloudflare namespace** holds both resource provisioning (vector indexes, buckets) and scheduler endpoints — historical naming preserved intentionally; scheduler docs reference `/scheduler/*` are stale ([[Technical Debt]] TD-5).

## Gateway platform layering

HTTP (`mysql/routes/<entity>.js` each exporting a Router) → shared helpers `wrap/gate/requireGatewayCompany/paginate` → services (pure validation + audits) → repositories (all SQL). This is Clean-Architecture-by-directory comments; barrels keep import paths stable (`mysql/routes/index.js`, `mysql/repositories.js`).

Live-execution endpoints (`execute/chat`, `execute/embeddings`) sit outside CRUD and always write audit entries including provider/model used.

## Versioning stance

None — single evolving surface guarded by checksummed schema migrations and additive-only key whitelists ([[Config Store Schema]]). Breaking client-visible changes have so far been avoided by keeping legacy shims (`legacy` return shapes in `config/write.js`, stream sentinel token retained "for backwards compat").

Where the full endpoint catalog lives: [[Routes Map]] (map), [[API Reference]] (per-endpoint detail).