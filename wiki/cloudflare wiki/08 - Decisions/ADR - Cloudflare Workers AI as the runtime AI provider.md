# ADR - Cloudflare Workers AI as the runtime AI provider

## Status
Accepted

## Context
The ask pipeline needs chat generation, embeddings, and cross-encoder reranking with per-company billing isolation, multi-tenant model allow-listing, and serverless-style ops without GPU management. A parallel gateway layer later added multi-provider catalog/credential UX ("9Router parity" comments), raising the question of which execution path answers visitors.

## Decision
All runtime inference (`query/*`) executes through Cloudflare **except generation for assistants bound to another provider**: `services/cloudflare_ai.js` SDK seam for completion/rerank, REST fetch for streaming, Vectorize for storage/search, R2 for text. Model ids constrained to `ALLOWED_MODELS` (@cf/... families); an assistant whose catalog model is a non-CF key executes through the gateway provider executor (`mysql/services/provider-executor.js streamChat`) with its own credential — OpenAI-compatible SSE and Command Code NDJSON stream incrementally, other wire formats deliver at completion. Multi-provider capability also exists at the gateway execute/test surface and ingestion embedding adapters.

## Rationale
Code comments and module boundaries treat CF as the single AI seam; credential mirroring maps exactly this provider set into tenant config. The implementation indicates this choice deliberately kept hot-path latency/coupling minimal while the catalog matured separately — but the original strategic rationale could not be confirmed from the codebase.

## Consequences
### Positive
One auth scheme, per-company tokens in config store, simple ops, predictable SSE format, catalog-independent stability of QA path.
### Negative
Vendor lock on runtime; non-CF ingested KBs are not askable ([[Knowledge Bases]] caveat); assistant.model silently falls back outside prefixes.

## Alternatives
Route ask through gateway executors universally; add Ollama/self-host fallback. Rejected-by-evidence: runnability gate exists precisely to refuse non-CF models today.

## Related Code
`query/answer.js`, `services/cloudflare_ai.js`, `client.js`, `query/assistant.js`, `config/schema.js ALLOWED_MODELS`.

## Related Documentation
[[Ask Pipeline]], [[AI Gateway Platform]], [[Integration Architecture]].