---
type: feature
status: active
area: backend
tags: [feature, gateway, catalog]
related:
  - "[[Repositories]]"
  - "[[MySQL Gateway Schema]]"
---

# AI Gateway Platform

## Purpose

A MySQL-backed control plane (mounted `/gateway`) that lets an admin: define **providers** and their auth forms/endpoint catalogs/models/pricing, create company-scoped **credentials** ("connections") with live verification & rotation, provision **resources**, assemble **knowledge bases** and **assistants**, execute real provider calls through stored credentials, and audit everything. Heritage comments reference "9Router" parity for executors/probes/error tagging.

## Layering (verified)

```
HTTP routers (mysql/routes/*.js — one per resource + helpers/pagination/shared-helpers)
      ↓ wrap()/gate()/requireGatewayCompany
Domain services (mysql/services/*)  ← pure validation, ownership, audits; no SQL
      ↓
Repositories (mysql/repositories/*) ← ALL SQL, snake_case mappers
      ↓
Lazy pool (mysql/pool.js)           ← keepalive tuning, one-retry transient handling, test seam
```

## Capability map

| Area | Highlights |
|---|---|
| Provider catalog | CRUD, nested models CRUD, auth-form endpoint, import JSON definitions (two shapes normalized, child rows reconciled transactionally), delete with referential care |
| Credentials | list/create/update/delete, verify (probe), rotate (re-encrypt), model-access grants, verification history; blobs are per-field gcm JSON ([[Security Model]]) |
| Resources | provision rows by type (`vector_index`, `object_bucket`, `graph_database`, …), type-aware live listing via Cloudflare APIs feeding portal cards |
| KBs / Assistants | see dedicated feature pages |
| Execute | `/execute/chat` + `/execute/embeddings` through `provider-executor` translating any wire format into OpenAI-style results; always audited; resolution by credentialId or providerKey(+keys/env) |
| Health | DB ping + registry auto-load trigger hook |

## Probes (`mysql/routes/probes.js`)

Hand-written probes win over a **schema-driven generic probe**: cloudflare token-verify body-aware; OpenAI-compatible generic builder from registry base/auth-header/key-field; Anthropic-style family reused for minimax/glm/kimi; Gemini query-param style. Results classify to ok/warning/hard-fail mapping 401/403 semantics ([[Error Handling]] tag vocabulary mirrors).

## Registry caching

Provider metadata cached in-memory (`provider-registry.js`) invalidated on every catalog mutation; health route can trigger periodic reload. Dynamic portal forms render straight from cached auth schemas.

## 503 gating contract

When MYSQL_* env unset: app boots fine, every gateway call returns typed ServiceUnavailableError instructing setup+migrate (inner `gate`), while outer requireAdmin still applies first when auth enabled.

Seed data history lives in migrations 003/004/006 rather than runtime code — reproducible installs get the full catalog ([[MySQL Gateway Schema]]).

Related: [[ADR - Frozen v5 schema and checksummed migrations]], [[Dependency Map]].