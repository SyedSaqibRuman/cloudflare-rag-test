# ADR - Hybrid scoring and gated reranking

## Status
Accepted

## Context
Pure vector similarity over-weights semantic neighbors without term grounding; reranking every candidate costs a model call per match. Constants needed to balance recall, precision and spend.

## Decision
Deterministic multi-stage funnel in `query/retrieval.js` + `scoring.js` + `reranker.js`:

1. vectorQuery top **10**
2. keep matches with score ≥ **75% of top** AND ≥ **0.5 absolute**
3. hybrid = clamp01(**0.85·vector + 0.15·keyword-overlap**) where keyword term-frequency capped at 3 per query term
4. dedupe by post_id/url/r2_key/id keeping best hybrid
5. cross-encoder rerank **only when ≥4 candidates** (parallel calls; per-item failure falls back to hybrid)
6. final top **5** → R2 chunk fetch → 4000-char context budget.

## Rationale
Contract comments in retrieval.js document ordering preconditions as load-bearing (hybrid set before dedupe etc.). The specific numeric tunings appear empirically derived for bge scoring ranges — exact tuning experiments are Unknown / Not confirmed from the codebase.

## Consequences
### Positive
Cheap short-answer path avoids reranker entirely (MIN_RERANK_MATCHES gate); clamped hybrid keeps downstream threshold math stable; dedup dominates duplicated-section content typical of cert pages.
### Negative
Tuned for current embedding scale — swapping embedding families may require retune; keyword component is naive TF (no IDF); magic numbers centralized only in two modules (documented constants table mitigates).

## Alternatives
Post-vector BM25 library (adds dep), always-rerank with batched scoring API — neither implemented nor referenced.

## Related Code
`query/retrieval.js`, `query/scoring.js`, `query/reranker.js`, tests `query/__tests__/query-modules.test.js`.

## Related Documentation
[[Data Flow]] (constants table), [[Ask Pipeline]].