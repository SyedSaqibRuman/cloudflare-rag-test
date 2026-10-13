---
id: kb-resource-binding/001
title: KB cards show no vector index / storage names when a live Cloudflare resource was selected
status: open
labels: [ready-for-agent]
---

## Problem

On the Knowledge Bases page (`#ingestion`) and the KB detail page, the
**Vector Store** / **Object Storage** entries show the fallback ("Default" /
"Company default", or nothing for storage) even though the user picked a real
vector index and bucket in the KB wizard (e.g. `max-test-index` /
`max-test-data`). Editing the KB and re-picking the resources does not fix it.

Repro:
1. Create/edit a KB; in the wizard's Storage & Search step enable Advanced
   mode and pick resources from the dropdowns (options marked "(live)" —
   actual Cloudflare Vectorize indexes / R2 buckets).
2. Save. The card's architecture row (Embedding · Vector · Storage) shows
   `Default` and no storage badge.
3. The Configuration tab's Infrastructure card shows "Company default" for
   both.

## Evidence

Display chain reads JOINed resource columns that are NULL:

- `web/src/pages/IngestionList.jsx:376` — `vectorIndex = kb.vector_external_id || kb.vector_resource_name || "Default"`; `storageLabel()` (~line 699) — `kb.storage_external_id || kb.storage_resource_name || null` (hides the row when null).
- `web/src/pages/KbDetail.jsx:455-456` — same fields with "Company default" fallback.
- `mysql/repositories/kb.js:9-17` — `KB_SELECT` LEFT JOINs `provider_resources` on `k.vector_resource_id` / `k.storage_resource_id`; both `*_resource_name` and `*_external_id` come from that row.

Root cause — the wizard binds **live** resources to a name-shaped `<option>`
value but the submit only ever sends a numeric resource id:

- `web/src/components/kb-modal.jsx:300-313` — registry options get
  `value: String(r.id)`, but live options get `value: r.name`
  (`const key = r.name || r.id; ... push({ value: key, ... })`).
- `web/src/components/kb-modal.jsx:246-247` — submit sends
  `vectorResourceId: numOrUndef(form.vectorResourceId)`; for a live selection
  `Number("max-test-index")` is `NaN`, and `JSON.stringify` drops NaN keys →
  the field arrives `undefined`.
- `mysql/services/kb-service.js:62-65, 142-144` — `validateKbInput` has no
  field for a live name; `vectorResourceId` normalizes to `null`, so
  `KbRepository.create/update` stores `vector_resource_id = NULL`
  (`mysql/repositories/kb.js:60-97, 101-134`).

The DB therefore has no link to any `provider_resources` row, so the display
JOIN returns NULLs and the card falls back.

Downstream impact: ingestion resolves the index as
`kb.vector_external_id || getVectorIndex(req.company.company_key)`
(`mysql/routes/kbs.js:496`) — a KB created this way silently ingests into the
company-config default index instead of its own.

Note: selecting a **registry** row (Providers page → provisioned resource)
works — the bug is only the live-resource path.

## Task

Smallest clean change:

1. `mysql/services/kb-service.js` — accept optional
   `vectorExternalId` / `storageExternalId` strings (validate against
   `RESOURCE_NAME_RE` from `shared/patterns.js`, 3–63 chars). In the writers,
   resolve each name to the company's existing `provider_resources` row of the
   matching type (`external_resource_id = name`) and store its id; if no row
   exists, auto-provision one (resource_key/name = the live name) so the JOIN
   has something to bind to. When both id and name are sent, the explicit id
   wins.
2. `web/src/components/kb-modal.jsx` — track live selections distinctly from
   registry ids (e.g. prefix live option values, or a separate
   `vectorExternalId` form field) and send `vectorExternalId` /
   `storageExternalId` for live picks instead of forcing them through
   `numOrUndef`.
3. Tests in `mysql/__tests__/kb-service.test.js`: validation accepts/rejects
   the new fields; `saveKb`/`updateKb` resolve a live name to the owned
   resource row and persist its id; unknown name → auto-provisioned row.
4. Update `docs/openapi.js` (POST /gateway/kbs properties +
   `KnowledgeBaseInput` schema) and the KB body example in
   `docs/architecture.md`.
