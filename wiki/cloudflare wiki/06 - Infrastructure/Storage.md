---
type: infrastructure
status: active
area: infra
tags: [storage]
related:
  - "[[Data Stores]]"
---

# Storage

## Object storage (R2) — role in pipeline

- Chunk JSONs are the answer-time source text; vectors only point at `r2_key`.
- Bucket ops: existence-checked uploads (HeadObject 404 gate), paginated clears (1000/page), delete cascades clear-first. Per-company endpoint derived from account id; bucket name from config or KB binding.
- Client reuse: per-company S3 client cached with credential fingerprint (see [[Services Layer]] for the `client.js` behavior summary).

## Local filesystem responsibilities (relative to process cwd)

| Path | Writer/reader | Persistence need |
|---|---|---|
| db/*.db | SQLite config store + presets | durable (config truth for sqlite mode) |
| processed-*.json | ingestion registries | durable (skips work otherwise) |
| content/<company>/… | cleaned markdown + upload staging copies | semi-durable cache; safe to purge |
| logs/*.log | logger | operational |
| web/dist | build output served statically | required at boot for portal |
| backup/, archive-*/, scratch files | developer artifacts | ignore |

## Vector storage notes recap

dims-locked indexes, six metadata fields, id determinism — full detail [[Vector Data & Chunk Files]].

## Sizing/scale observations (evidence-labeled)

No TTL/cleanup jobs exist for R2/markdown/log rotation beyond single-session trim (**Recommendation** candidate); object counts grow linearly with re-ingests of unchanged slugs since keys overwrite but stale-page removal never happens after upstream deletions.
