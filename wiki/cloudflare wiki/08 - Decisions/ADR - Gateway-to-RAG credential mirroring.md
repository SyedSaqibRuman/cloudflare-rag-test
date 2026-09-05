# ADR - Gateway-to-RAG credential mirroring

## Status
Accepted

## Context
After the gateway layer landed, users would otherwise enter Cloudflare tokens twice: once as encrypted connections (platform UX) and again into the RAG config store that resolveCreds actually consumes. Two stores needed reconciliation semantics without making runtime reads async or cross-DB joined.

## Decision
One-way **sync bridge** (`mysql/services/rag-sync.js`): gateway connection create/update/rotate/deletes and graph resource changes translate mapped fields into a config-store patch applied through the standard persist-first write path. Field map intentionally minimal (only keys runtime consumes); neo4j mappings scoped by provider key; deletions clear mirrored keys only when no remaining connection still provides them; a `backfillRagCredentials` recomputes full state idempotently for pre-sync tenants/tests.

## Rationale
Module header states purpose plainly ("user enters credentials once… best-effort"). Mapping exactness guards against syncing keys nothing reads (R2_TOKEN_VALUE excluded deliberately). No evidence of alternative designs debated elsewhere.

## Consequences
### Positive
Single credential-entry UX; runtime resolve stays synchronous memory-only; deletes safe against multi-connection providers (cloudflare vs cloudflare_r2 case coded).
### Negative
Eventual-consistency window (mirror failure only warns — sync never blocks gateway writes); two-place truth requires the liveness recompute correctness relied upon by clear logic; direct API writes bypassing gateway still possible for exotic keys by design.

## Alternatives
Live decryption join at resolveCreds rejected (breaks sync read contract/perf model); nightly reconcile job unnecessary given event hooks plus backfill.

## Related Code
`mysql/services/rag-sync.js` (all), callers in credentials/resources routers, tests `mysql/__tests__/rag-sync.test.js`.

## Related Documentation
[[AI Gateway Platform]], [[Multi-Tenancy & Company Config]], [[Security Model]].