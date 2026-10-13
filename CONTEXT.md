# CONTEXT

Entry point for agent/human understanding of the PopularCert RAG API domain.
Deep engineering docs live in the Obsidian vault:
[`wiki/cloudflare wiki/00 - Home/Home.md`](<wiki/cloudflare wiki/00 - Home/Home.md>) —
start with its Documentation Map. This file stays thin by design: summary here, depth there.

## What this product is

A multi-tenant RAG backend (Express 5, Node ESM) answering visitor questions per company
using Cloudflare Workers AI + Vectorize + R2, plus an optional MySQL "AI Gateway" platform
(provider catalog, encrypted credentials, Knowledge Bases, Assistants) and a built-in
React admin portal served from the same process.

## Terminology

Canonical glossary: [`wiki/cloudflare wiki/09 - Reference/Glossary.md`](<wiki/cloudflare wiki/09 - Reference/Glossary.md>).
Key terms: Company/Tenant, KB, Assistant, Connection (credential), Resource,
Ask Pipeline fast path, Gateway. Use these names consistently everywhere.

### Retrieval & storage terms (settled 2026-08-27 grilling session)

- **Askable KB** — a Knowledge Base whose embedding provider and vector store support
  query-path resolution, so its documents can ground `/ask` answers. Before the multi-provider
  work only Cloudflare-backed KBs were askable.
- **Retrieval binding** — the mechanism selecting which index and embedding model a request
  uses: the assistant's primary KB, falling back to company-level config. Sole selection axis;
  no per-request overrides exist by design.
- **Content doctrine** — where chunk *text* lives relative to vectors. Target state:
  **vendor-payload doctrine** — each vector record carries `{text,title,url,type,slug,chunkIndex}`
  so any store can serve answers from its own payloads. Cloudflare's historical R2-mirror
  arrangement is transitional-canonical during the phased migration.
- **Dual-mode adapter** — a vector-store adapter exposing ensure/upsert/query over one
  credential set, used symmetrically by ingestion and ask-time retrieval.

## Invariants (never break silently)

1. Tenant isolation keys off `x-company-name` / company-scoped repositories — never cross tenants.
2. Secrets exist in plaintext only in memory; at rest they are AES-256-GCM blobs (`gcm:` prefix).
3. All SQL lives in `mysql/repositories/*` behind the lazy pool; all Cloudflare I/O goes
   through `services/cloudflare_ai.js` / per-company clients in `client.js`.
4. Pipeline stage order is contractual ([[Data Flow]] page); changes require updating tests + wiki.
5. The wiki is persistent context, source code is current truth; on conflict update the wiki
   (see the Golden Rule flow in the vault's Home).

## Decisions

- Historical ADRs (11): [`wiki/cloudflare wiki/08 - Decisions/ADR Index.md`](<wiki/cloudflare wiki/08 - Decisions/ADR Index.md>)
- New ADRs land in `docs/adr/` — consumer rules in [`docs/agents/domain.md`](docs/agents/domain.md).