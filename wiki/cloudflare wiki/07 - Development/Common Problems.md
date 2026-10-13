---
type: development
status: active
area: dev
tags: [troubleshooting]
related:
  - "[[Local Setup]]"
---

# Common Problems

Field-tested gotchas; each links the deeper page.

| Problem | Cause | Fix / pointer |
|---|---|---|
| 400 `Company 'x' not found` on ask/config/index calls | tenant never created or name mismatch incl case | create via Companies page first ([[Multi-Tenancy & Company Config]]) |
| 401 loops in portal after restart | ADMIN_SECRET unset ⇒ sessions die each boot | set explicit secret |
| Portal blank / SPA fallback HTML everywhere after deploy | web/dist missing at boot (hasWeb snapshot) | rebuild portal then restart process |
| "Invalid embedding detected" upserts | index dims ≠ EMBEDDING_DIMENSIONS for model | recreate index or re-run lift guidance; model change auto-sets dims but not existing indexes |
| Rate-limit 429 storms despite few users | trust proxy default true lets XFF rotation forge keys | set TRUST_PROXY properly **after TD-1 fix**; until then throttle at proxy |
| Vectorize batch fails "Invalid embedding detected"/dim error same as above but during ingest | KB embedding adapter dims vs index provisioning mismatch | align KB embedding_model + provisioned index |
| MariaDB migrate fails FK+PARTITION | engine limitation | runner auto-strips; if manual run, strip clause like runner does |
| Editing applied migration errors checksum | guard by design | add new migration file instead |
| Bare `node --test` explodes on scripts | ad-hoc dev scripts match test glob & need .env/net | always use npm test or explicit globs ([[Testing]]) |
| Scheduler empty after restart | in-memory maps only | re-start schedules post-deploy; persistence is roadmap TD-3 |
| Graph context never appears | missing NEO4J_* trio or assistant gate off or graph empty | check company creds + enable_graph_context flag; failures silent by design |
| Ask answers feel stale across assistant switch | cache key includes assistantKey so should differ — real staleness implies direct runtimeConfig edit outside API while server running | use API writes only; restart picks DB state |
| Webhook payloads look generic JSON | Slack/Discord formatter bug TD-2 | patch buildPayload URL passthrough |
| `getChunk` null though vector exists | bucket name changed / r2_key prefix era mismatch (site vs kb/<key>) | confirm bucket binding matches ingestion source generation |

Add new entries as they're confirmed reproducible; link fixes back into feature pages.