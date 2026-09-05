---
type: backend
status: active
area: backend
tags: [repositories, mysql]
related:
  - "[[MySQL Gateway Schema]]"
  - "[[Repositories]]"
---

# Repositories

Scope: **MySQL gateway layer only** (`mysql/repositories/*.js`). The RAG config store has no repository pattern — it's key/value persistence behind `config/*`.

## Composition

One file per entity; barrel `mysql/repositories.js` re-exports everything so import sites stay stable:

| Repository | Covers tables |
|---|---|
| company.js | companies (+ ensureDefaultEnvironments seeding Production/Staging/Development) |
| credential.js | credentials, credential_model_access, usage-log joins |
| provider.js / model.js / endpoint.js / pricing.js | global catalog entities |
| resource.js | provider_resources (find/list/create/update/delete) |
| kb.js | knowledge_bases join columns + status/stats setters |
| assistant.js | assistants rows + variable arrays |
| audit.js | audit_logs insert/list |
| catalog-import.js | bulk import transactions with child-table reconciliation |
| helpers.js | row mappers (`mapRow`) and snake_case column helpers |

## Patterns enforced

1. **All SQL lives here** — routes/services contain zero SQL strings.
2. **snake_case rows mapped at boundary** — callers receive camelCase objects shaped explicitly (no generic ORM).
3. **Soft-delete aware** — filters include `deleted_at IS NULL` where schema supports it (companies/resources…), while delete paths set timestamps rather than DELETE rows.
4. **Ownership by company_id** — list/find methods take companyId first parameter where tenant-scoped.
5. Pool access strictly through `getPool()`; transient drop retry happens transparently via Proxy pool wrapper (`mysql/pool.js withRetry`).

## Testing approach

Repositories are exercised through route/service tests using `_usePoolForTests(fakePool)` injection or repository-level fake connections (e.g., `mysql/__tests__/catalog-importer-replace.test.js` passes a fake pool implementing getConnection). No MySQL daemon required for the suite — one reason tests total 663.

## Adding a table

Workflow observed in history: new migration file `00X_*.sql` → repository file addition → export from barrel → service-level validators → router wiring → redaction pass on responses. Keep encrypted fields inside `encrypted_credentials` blobs rather than columns ([[Security Model]]).