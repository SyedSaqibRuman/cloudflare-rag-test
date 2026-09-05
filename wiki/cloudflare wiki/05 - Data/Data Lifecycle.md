---
type: data
status: active
area: data
tags: [lifecycle]
related:
  - "[[Data Stores]]"
---

# Data Lifecycle

Entity-by-entity birth → mutation → death paths verified from code.

## Company (tenant)
create (POST companies) → defaults cloned + MySQL environments seeded → config edits hot-applied persist-first → delete soft-deletes MySQL tenant + removes both backends' storage; vector/R2 artifacts remain (manual cleanup).

## Credential/connection
created via gateway (fields encrypted per-value) → rag-sync mirrors CF/Neo4j-relevant fields into config store → verify probes stored as history → rotate re-encrypts + re-syncs → delete recomputes which mirrored keys are still provided by other connections before clearing ([[ADR - Gateway-to-RAG credential mirroring]]).

## Knowledge Base
created Ready → ingest job flips Indexing → success Active(+stats+audit+webhook) / failure Error(+last_error) ; updates to chunk_size bump registry fingerprint forcing full re-ingest next run; archive/pause flags alter UI state derivation only.

## Document content
WordPress modified date drives staleness; unchanged docs skipped, changed ones get fresh chunk set under same deterministic ids (idempotent overwrites); deleted-upstream WP pages simply stop being refreshed — their vectors/chunks linger until manual purge (**no tombstone pass implemented**).

## Registry JSON
grown synchronously per record call; wiped by deleting file (forces full re-ingest); meta block rewritten whenever settings change.

## Answers cache
written post-generation with company tag; evicted lazily at TTL read or FIFO overflow; company-scoped purge on POST /ask/reset; entire map lost on restart.

## Audit logs
append-only inserts; no retention/pruning implemented in reviewed code (**retention Unknown / not confirmed**).

## Secrets
rotate through credential-service bumps blob version marker; master-key loss renders all gcm values undecryptable loudly (decryption errors surface at boot load rather than mid-request when possible).