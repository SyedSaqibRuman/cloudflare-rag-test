---
type: data
status: active
area: data
tags: [vectorize, r2]
related:
  - "[[Document Processing & Chunking]]"
---

# Vector Data & Chunk Files

## Vector point shape (Vectorize)

| Field | Value |
|---|---|
| id | `<sha256(r2Prefix/slug)[0..48]>-<chunkIndex>` — stable across re-ingests; r2Prefix embeds KB scope so ids never collide across KBs/company site prefix |
| values | embedding float array (dims must equal company `EMBEDDING_DIMENSIONS`; index metric cosine) |
| metadata | `{r2_key, title, url, type, slug, chunkIndex}` — the six fields also declared as **metadata indexes** at creation for filtering/perf |

Upsert batching: NDJSON lines grouped 100/request via SDK w/ `unparsable-behavior:error`; single-record validation requires id+r2_key+text. Query uses topK=10 `returnMetadata:"all"` + values.

Dimension coupling chain: EMBEDDING_MODEL→EMBEDDING_DIMENSIONS map→index creation dims→runtime validation error "Invalid embedding detected" when mismatched (recreate/re-ingest required) — the guard rails noted in [[Common Problems]].

## R2 chunk JSON layout

```
site/<type>/<pageSlug>/chunk-N.json        legacy company-wide ingestion
kb/<kbKey>/<type>/<pageSlug>/chunk-N.json  KB-scoped ingestion
```

JSON contents (as consumed downstream): `{content, title, url, ...}` where `buildContext` reads `.content` + `.title`; slug/chunkIndex metadata mirror vector side.

## Retrieval-time read pattern

`matches[].metadata.r2_key` → parallel `getChunk(key)` fan-out (null-safe) → sanitize + budget-trim into `[Source N]` blocks ≤4000 chars total ([[Data Flow]]).

## Lifecycle hooks

Deleting a KB/provider resource row does **not** delete its vectors/objects in the reviewed code — cleanup is manual operator work or future endpoint work (**confirmed absence**). countVectors exists as best-effort status helper reading `vectorCount`.