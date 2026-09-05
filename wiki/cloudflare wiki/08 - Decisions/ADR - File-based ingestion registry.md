# ADR - File-based ingestion registry

## Status
Accepted

## Context
Re-running ingestion must not re-pay embeddings/storage for unchanged WordPress documents, yet no DB table existed in the pure-file era, and KB settings changes must invalidate derived artifacts deterministically.

## Decision
JSON registries `processed-<company>[-<kbKey>].json` map registry key (`<type>-<slug>`) → last modified date, with an optional `__metaFingerprint` block (currently chunkSize). `isStale()` returns true on: never-recorded / fingerprint mismatch / recorded<modified. Writes are synchronous full-file dumps after each successful doc. Count helpers exclude dunder keys.

## Rationale
Plan-doc tags (F13 fingerprint, F14 unique vector ids via r2Prefix hashing) appear verbatim in implementation comments tying registry design to re-ingest correctness. Alternative storage discussions absent from repo (**Unknown / Not confirmed** beyond what's coded).

## Consequences
### Positive
Zero-infrastructure idempotency; deleting file = full refresh escape hatch; KB-scope prevents cross-KB skip collisions.
### Negative
Sync writes serialize ingest IO slightly; crash mid-run leaves partial-run recorded entries consistent but uncommitted ones rework next run (acceptable); registries are local-disk state — containerized ephemeral FS would break skipping unless volume-mounted ([[Deployment]]).

## Alternatives
DB-backed job ledger possible post-gateway but never built; vector-store native upsert-diffing insufficient (no modified-date source).

## Related Code
`ingest/registry.js`, callers in `ingest/pipeline.js`, fingerprints from `ingest.js main`.

## Related Documentation
[[Ingestion]], [[Data Lifecycle]], [[Vector Data & Chunk Files]].