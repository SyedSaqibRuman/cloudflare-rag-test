# ADR - Per-company multi-tenant isolation

## Status
Accepted

## Context
Multiple certification businesses share one deployment but require independent personas, knowledge, credentials, resources, and cost attribution — plus a single admin surface to operate them.

## Decision
Everything tenant-scoped keys off a company entity: request header selection for public API, explicit company_id FKs in MySQL platform tables, isolated SQLite file or company_config rows for settings, separate vector indexes/buckets provisioned per tenant, per-company cached SDK clients keyed by credential fingerprint.

## Rationale
Verified seams (companyFromRequest, repositories' companyId-first signatures, rag-sync ownership checks) implement isolation uniformly across layers instead of shared-schema-per-row ad hoc filtering — the code consistently re-checks ownership at service level too. Intent beyond this pattern is not recorded in-repo.

## Consequences
### Positive
Strong blast-radius containment; straightforward CORS/domain derivation (<company>.com); clear audit actor scoping.
### Negative
No cross-company sharing primitives (models duplicated if needed); deletes leave cloud artifacts (manual cleanup); single admin role means "tenant" trust is coarse.

## Alternatives
Namespace-in-one-config-key approach (weaker integrity), full schema-per-tenant DBs (heavier ops) — neither reflected anywhere in current code.

## Related Code
`config/company.js`, `utils/request-context.js`, company/kb/resource/credential modules under `mysql/repositories/`, `routes/cloudflare/companies.js`.

## Related Documentation
[[Multi-Tenancy & Company Config]], [[Authorization Flow]], [[Security Model]].