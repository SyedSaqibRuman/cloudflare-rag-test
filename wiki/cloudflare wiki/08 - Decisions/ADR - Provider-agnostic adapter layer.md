# ADR - Provider-agnostic adapter layer

## Status
Accepted

## Context
Legacy ingestion was hardwired to Cloudflare (WP→chunks→R2→Vectorize with company-config creds). The gateway platform introduced multi-provider resources/models and KB rows binding them, demanding source/storage/embedding/vector swappability without polluting pipeline logic.

## Decision
Ingestion became **composition-root + pure loop**: `ingest.js` resolves adapters — per-KB via `resolveKbAdapters` (resource connections → credential decryption → factory in `mysql/adapters/{storage,embedding,vector}`) or legacy cloudflare defaults from company config — then runs `runIngestion` whose only I/O surface is the adapter contract `{fetchPost/fetchPage/fetchWpByIds}`, `store.{ensureBucket,saveContent,uploadChunk}`, `index.{ensureIndex,upsert}`, `registry.{isStale,record}`. Source adapters likewise normalized to WP-shaped items.

## Rationale
Pipeline header documents the contract and testability intent explicitly; dedicated suites (`ingest/__tests__`) run entirely on fakes proving the seam. Roadmap-level reasoning beyond this is unconfirmed.

## Consequences
### Positive
100% unit-testable ingestion w/o network; new providers are factory entries only; chunk/prefix/id semantics centralized; webhooks/status/audit stay provider-neutral.
### Negative
Ask-side retrieval did NOT adopt adapters yet (Workers-AI-only), producing asymmetric capability ([[Knowledge Bases]] caveat); embedding-adapter dims must match provisioned vector indexes manually.

## Alternatives
Abstracting query path too (future work candidate); direct SDK calls per-provider in pipeline rejected by the historical refactor commit e9b4fd1 lineage.

## Related Code
`ingest/resolve.js`, `mysql/adapters/*`, `ingest/pipeline.js`, `ingest/sources/*`, tests `ingest/__tests__/resolve.test.js`.

## Related Documentation
[[Ingestion]], [[Document Processing & Chunking]], [[ADR - File-based ingestion registry]].