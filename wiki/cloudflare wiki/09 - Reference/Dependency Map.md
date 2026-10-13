---
type: reference
status: active
area: reference
tags: [dependencies, coupling]
related:
  - "[[Codebase Index]]"
---

# Dependency Map

## Module layering (imports verified)

```mermaid
flowchart TD
    APP[app.js] --> REQCTX & CFG & QIDX[query/index] & GWBAR[mysql/gateway-router] & CRONR & AUTHM & LOGR & STREAMT & HEALTH & MIGR
    QIDX --> ANSWER[query/answer.js]
    ANSWER --> INTENT & LLM & CACHEQ & RETRIEVAL & CTXQ & PROMPTSQ & GRAPHE & ASSIST & STREAMC
    RETRIEVAL --> EMB[services/embeddings] & VEC[services/vectorize] & R2S[services/r2]
    LLM & GRAPHE & RER --> CFAI[services/cloudflare_ai]
    ALLCF[CLOUDFLARE-touching modules] --> CLI[client.js per-company clients] --> CR[config/index resolveCreds]
    CR --> STORE[config/store] --> SQLITE & MYSTORE[mysql-store] & POOL[mysql/pool]
    MYSTORE --> REPOS[mysql/repositories barrel]
    GWR[routes/gateway routers] --> SVCS[mysql/services] --> REPOS --> POOL
    INGJ[ingest.js] --> PIPELINE & REGISTRY & RESOLVE & SRCS & WEBHOOKS & REPOS
    RESOLVE --> FACTORIES[mysql/adapters factories] & CONNRES & CREDSVC
    RAGSYNC --> CFG & REPOS & CREDSVC
```

## Deliberate acyclicity islands (must preserve)

| Rule | Reason recorded |
|---|---|
| `config/store.js` never imports `config/index.js` or higher | prevents import-cycle TDZ (file header history) |
| `query/assistant.js`, `query/graph.js` lazy `await import()` repos/driver | zero-dep loadability of query tests |
| Routes compose via barrels (`mysql/routes/index.js`, `repositories.js`, `cloudflare.js`) | import sites frozen during clean-architecture splits |

Strongest fan-out hubs: `web/src/api.js` (degree ~80 per PROJECT_CONTEXT metrics), `mysql/pool getPool()` (~19), schema SQL nodes.

## Shared code duplicated-on-purpose-free zones

`shared/*` consumed by BOTH server and portal (#shared alias) — changes must keep node --test compat (no deps rule) enforced by existing tests importing them directly.

## Package↔feature map highlights

express→everything HTTP · mysql2→pool/migrations/stores · cloudflare SDK→client seam consumers · aws-sdk-s3→r2 services+storage adapter · node-cron→lifecycle · pdf-parse+mammoth+cheerio+turndown→sources/cleaner · p-limit→concurrency · neo4j-driver→lazy graph · swagger-ui-*→docs mount.

## Findings register (details → [[Technical Debt]])

- **Unexpected/dead deps:** `axios` declared but no runtime import located (verify then drop); `wrangler` carries platform tooling weight though app never calls it.
- **Critical single points:** `node:sqlite` builtin pins Node floor; `undici override` pins audit-clean state.
- **No circular domain loops detected** in this pass; guard rules above exist because two were fixed historically (comments cite TDZ incident).
