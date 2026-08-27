---
type: reference
status: active
area: overview
tags: [navigation, reading-order]
related:
  - "[[Home]]"
---

# Documentation Map

How to navigate the wiki depending on what you are trying to do.

## I'm new to the repo

1. [[Project Overview]] — what exists, stack, layout
2. [[System Architecture]] — boundaries and layers
3. [[Application Flow]] — one request through Express middleware
4. [[Data Flow]] — what happens inside an ask call (stage-by-stage)
5. [[Local Setup]] then [[Testing]]

## Before changing the ask/RAG behavior

Read in this order: [[Ask Pipeline]] → [[Answer Streaming]] → [[Data Flow]] → [[Assistant Personas]] → [[GraphRAG]]. Then inspect `query/answer.js runPipeline()` (source of truth) and `query/__tests__/pipeline.test.js` for the step contract.

## Before touching companies/tenants

[[Multi-Tenancy & Company Config]] → [[Config Store Schema]] → [[Configuration]] → [[Authorization Flow]] → [[Ask API Keys]].

## Before adding provider/model support

[[AI Gateway Platform]] → [[Repositories]] → [[External Services]] → [[ADR - Provider-agnostic adapter layer]]. Note: pipeline execution currently runs only `@cf/` and `@cloudflare/` model prefixes (`query/assistant.js isRunnableModel`).

## Before changing ingestion

[[Ingestion]] → [[Knowledge Bases]] → [[Vector Data & Chunk Files]] → [[ADR - File-based ingestion registry]] → [[Scheduler]].

## Credentials / secrets work

[[Security Model]] → [[ADR - AES-256-GCM encryption at rest]] → [[ADR - Gateway-to-RAG credential mirroring]] → [[Storage]].

## Finding things fast

- Endpoint lookup → [[Routes Map]], deep detail in [[API Reference]]
- File responsibility lookup → [[Codebase Index]]
- Terminology → [[Glossary]]
- What couples to what → [[Dependency Map]]

## Prose docs in docs/ (secondary context)

These predate or drift from code; prefer the wiki/source when they disagree:

| Doc | State observed 2026-08-27 |
|---|---|
| `docs/architecture.md` | Broadly current (gateway flow, CORS, limits) — checked line-by-line against code during wiki creation |
| `docs/AI_API_REFERENCE.md` | Useful endpoint catalog; recheck route prefixes/mounts against [[Routes Map]] before relying on it |
| `docs/getting-started.md` | Refreshed Aug 25: CONFIG_STORE model is correct; verify snippets against `.env.example` |
| `docs/openapi.js` | Serves `/api-docs`; keep in sync when routes change (repo convention) |
| `docs/providers.md`, `docs/credentials.md`, `docs/models.md` | Feature-level guides; partially superseded by [[AI Gateway Platform]] |
| `docs/plans/*.md`, `docs/platform-buildout.md`, `INGESTION_PIPELINE_PLAN.md`, `PROJECT_CONTEXT.md` | Historical planning artifacts — good for intent archaeology, not current truth |

## Maintenance rules (project law)

- Significant changes update affected wiki pages ([[Change Log]] records them).
- Source code outranks wiki on conflict; fix the wiki immediately after discovery.
- Don't duplicate explanations across pages — link the canonical page instead.