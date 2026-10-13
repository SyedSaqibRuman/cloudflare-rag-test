---
type: adr
status: index
area: decisions
tags: [adr]
related:
  - "[[Home]]"
---

# ADR Index

Architecture Decision Records — what the system does, why it plausibly does so, and where reasoning could **not** be confirmed from source (never invented).

| # | Decision | Status |
|---|---|---|
| 1 | [[ADR - Cloudflare Workers AI as the runtime AI provider]] | Accepted |
| 2 | [[ADR - Per-company multi-tenant isolation]] | Accepted |
| 3 | [[ADR - Dual config store with CONFIG_STORE switch]] | Accepted |
| 4 | [[ADR - AES-256-GCM encryption at rest]] | Accepted |
| 5 | [[ADR - Gateway-to-RAG credential mirroring]] | Accepted |
| 6 | [[ADR - Provider-agnostic adapter layer]] | Accepted |
| 7 | [[ADR - Frozen v5 schema and checksummed migrations]] | Accepted |
| 8 | [[ADR - Opt-in admin auth via HMAC session tokens]] | Accepted |
| 9 | [[ADR - Hybrid scoring and gated reranking]] | Accepted |
| 10 | [[ADR - Transport-owned SSE streaming contract]] | Accepted |
| 11 | *(numbering hand-off)* — new-format ADRs continue in repo `docs/adr/`, starting at 012 | — |
| 12 | [Multi-provider ask-time retrieval — in-repo `docs/adr/adr-012…`](../../../docs/adr/adr-012-multi-provider-ask-retrieval.md) | Accepted — phased scope |

## conventions

Statuses used: Proposed / Accepted / Superseded by <link>. Historical context beyond code comments is marked explicitly; original human intent remains **Unknown / Not confirmed from the codebase** wherever stated.

Related tracking: [[Change Log]] records *what changed when*; ADRs record *why the shape is as it is*.