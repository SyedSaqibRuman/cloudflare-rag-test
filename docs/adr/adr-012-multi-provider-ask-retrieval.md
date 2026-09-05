# ADR - Multi-provider ask-time retrieval

## Status
Accepted — scope decided 2026-08-27 (grilling session, user-approved ledger); implementation pending.

## Context
The gateway platform already promises multi-provider vector infrastructure: the seeded catalog carries a visible "Vector Databases" admin section with **Pinecone** fully specified (provider + capabilities + `vector_index` resource type), **Qdrant** capabilities-only, and **Weaviate** as a bare stub (`migrations/004_seed_catalog.sql`, `006`). Embeddings ride as capability/model rows on OpenAI/Cohere/Jina/Voyage/etc., and ingestion resolves them provider-agnostically through `ingest/resolve.js` → `mysql/adapters/{embedding,vector}`.

Ask-time is Cloudflare-only, and worse than merely "not askable": query embeddings are *always* generated from the company's Workers-AI `EMBEDDING_MODEL`, so KBs ingested with other embedding models are searched in a mismatched vector space — **silent semantic corruption rather than an error** (`services/cloudflare_embeddings.js`, `query/retrieval.js`). No read/query code exists outside Vectorize; every non-CF adapter is write-only and tests currently assert that others throw (`mysql/adapters/vector/factory.js`).

A latent companion bug compounds this regardless of provider: the answer-cache key `md5(company : assistantKey : question)` omits the retrieval binding, so changing a company's embedding model/index (or binding an assistant whose primary KB embeds differently under overlapping question text) can serve stale answers across incompatible spaces (`query/cache.js`).

## Decision
Phased build, preserving the CF fast-path beside a new KB-driven resolver:

1. **Phase 1 — Binding integrity**: answer-cache key gains a binding fingerprint (resolved embedding model + store/index id). CF behavior otherwise unchanged.
2. **Phase 2 — Query resolution**: request-path retrieval binding resolved like ingestion (assistant primary-KB → storage/vector/embedding credentials → dual-mode adapter); non-CF *embeddings* become query-capable against Vectorize, then non-CF *vector stores* gain read modes, **Pinecone first**, Qdrant then Weaviate behind the identical interface.
3. **Content doctrine = vendor-payload everywhere**: every vector record's normalized payload `{text,title,url,type,slug,chunkIndex}` becomes the canonical chunk source at ask time; CF's historical R2 chunk-mirror arrangement is demoted to *transitional-canonical* and migrates to vendor-payload eventually (single-doctrine end-state, dual doctrine documented as interim).
4. Adapter shape: **fat dual-mode interfaces** (`ensureIndex/upsert/query`) over one credential set, shared by ingest and retrieval; lazy-imported into the query path to preserve zero-dependency test loading; fake-injectable per house test idiom.
5. Failure posture: unresolvable/incompatible bindings degrade gracefully — canned "KB unavailable" answer plus server-side warning (consistent with GraphRAG/cache philosophy).
6. Selection stays **implicit**: assistant primary-KB ↓ company config fallback; no override axis until a concrete need appears.

## Rationale
Full parity was chosen over mirror-canonical text (chunks stay in R2, vectors point at them) because the catalog and portal already present multi-vector-provider capability to admins, and a single content doctrine eliminates forever-the split-brain question "where does the answer text live?" The α alternative would have been less work today but institutionalized permanent dualism between store families. Phasing honors the repo's smallest-reversible-change style while vendor-payload-for-CF-later avoids writing throwaway resolution logic for the interim. Original strategic intent behind seeding Pinecone/Qdrant/Weaviate metadata without read paths could not be recovered from history; this ADR records the intent going forward.

## Consequences
### Positive
Every ingested KB becomes genuinely answerable; mismatched-space corruption class eliminated (both at query and cache layers); vendor SDK-free raw-fetch seams keep supply chain lean consistent with `services/cloudflare_ai.js`; sources/hybrid-scoring inputs standardize on the payload contract.
### Negative
Two content doctrines coexist during the transition (documented, time-boxed by the CF migration); hybrid keyword scoring degrades silently where vendors cannot return title/preview metadata (accepted, graceful); new-store onboarding now requires implementing three verbs rather than two; vendor payload-size limits become an operational parameter (current ≤1000-char chunks fit comfortably).

## Alternatives
**(α)** Mirror-canonical reads — rejected: permanent dual doctrine. **(β′)** Immediate full unification including CF internals — rejected: exceeds phased risk appetite for zero near-term user value. **(γ)** Record asymmetry as intentional constraint, build nothing — rejected: discards working ingestion investment and leaves silent-corruption bug live.

## Related Code
`ingest/resolve.js`, `mysql/adapters/{embedding,vector}/factory.js`, `mysql/services/provider-connection-resolver.js`, `query/retrieval.js`, `query/cache.js`, `query/answer.js`, `services/vectorize.js`.

## Related Documentation
Glossary terms *Askable KB*, *Retrieval binding*, *Content doctrine*, *Dual-mode adapter* in root `CONTEXT.md`.
Vault: [[Knowledge Bases]], [[Data Flow]], [[Technical Debt]] (`wiki/cloudflare wiki/`).