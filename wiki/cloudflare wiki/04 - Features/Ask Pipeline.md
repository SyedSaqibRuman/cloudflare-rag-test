---
type: feature
status: active
area: backend
tags: [feature, rag]
related:
  - "[[Data Flow]]"
  - "[[Answer Streaming]]"
---

# Ask Pipeline

## Purpose

Turn a natural-language question (+ optional conversation history) into a grounded answer using the tenant's vectorized content, optionally augmented with graph data and persona overrides.

## User flow (visitor)

```
Site widget → POST /ask {question, history[]} + x-company-name
→ immediate JSON: answer(markdown), sources[{title,score}], matches[], possibleQuestions[], cached, graph?
```

## Architecture & processing order

Single source of truth `query/answer.js runPipeline()` — stage list with exact ordering is diagrammed in [[Data Flow]]; do not duplicate here. Supporting modules:

| Step | Module | Contract notes |
|---|---|---|
| intent fast-path | query/intent.js | greeting/name/identity/contact/discovery/office/help/blocked/vague canned replies; vague detection bypassed for non-ASCII scripts. Contact regex requires a person-role word after "who is" ("who is the author of this book" stays a content question — fixed 2026-09-17). Blocked patterns are CONFIGURABLE (2026-09-25): the veto set resolves per ask through `shared/blocked-patterns.js` — assistant `blocked_patterns` > company `BLOCKED_PATTERNS` config > built-ins; a set fully replaces the tier above it (a recipes persona ships its own set so "recipe" isn't vetoed). The anchored test-string gate (test/asdf/foo…) and company `BLOCKED_TOPICS` substring vetoes always apply on top. Line format: literal phrase (case-insensitive, escaped) or `/regex/` |
| assistant overrides | query/assistant.js | resolved **before** the fast-path so identity answers use the assistant's name; lazy MySQL resolve; runnable-model gate only allows @cf/@cloudflare prefixes ([[Assistant Personas]]) |
| KB-driven retrieval | query/kb-retrieval.js | when the company's `VECTOR_INDEX` resolves to a KB bound to a non-CF vector resource (Qdrant/Pinecone/Weaviate/OpenAI), retrieval runs through the KB's adapter stack per [[ADR Index]] ADR-012 Phase 2; resource-config `collection_name`/`class_name` fallback included |
| rewrite | query/llm.js rewriteFollowup | skipped when history empty; INVALID/error → original question preserved |
| cache | query/cache.js | key md5(company:assistantKey:question); TTL 60m; FIFO cap200; company-tagged purge via /ask/reset |
| retrieve+rank | query/retrieval.js + scoring.js + reranker.js | thresholds documented; reranker parallel fan-out w/ per-item fallback to hybrid |
| context build | query/context.js buildContext/sanitizeText | char budget stops *before* adding a section that would overflow |
| graph step | query/graph.js | see [[GraphRAG]] |
| prompt assembly | query/prompts.js getSystemMessage + variables templating | template = assistant override ?? company SYSTEM_PROMPT |

## API endpoint semantics

Request validation ensures trimmed non-empty string question & array history else 400 (`routes/ask.js`). Response always `{success:true,...result}` where result carries pipeline contract fields. Errors inside pipeline return graceful text rather than HTTP failure except transport-level failures.

## Model-access gate (assistant credential)

`checkModelAccess` runs **only when the assistant's catalog model is the one the pipeline will actually execute** (`assistantModelExecutes()` — a Workers AI key, **or** a non-CF catalog key bound to the assistant's own credential via the `execution` block, which routes the call through the gateway provider executor). A non-CF model with no credential binding falls back to the company's configured `LLM_MODEL` via `assistantModel()`, so gating that fallback would deny an ask whose model is never called. Denial itself is **grants-aware**: a credential with zero `credential_model_access` rows is unmanaged (everything allowed) — explicit grants deny a model only when present but disabled/quota-exhausted, or when grants exist and the model is not among them. Denials are returned with `denied: true` so callers never derive follow-up suggestions from the error string.

## Follow-up suggestions

`query/llm.js generatePossibleQuestions` is grounded **only in the answer text** — no vertical is hardcoded, so an assistant bound to any KB (a Java textbook, a certification site, …) gets on-topic follow-ups. The tenant's `BLOCKED_TOPICS` still filters the list; empty/refusal/error answers yield `[]`. Starter chips for the empty state are separate: `query/suggestions.js generateStarterQuestions` retrieves the bound index and asks the small LLM for first-visit questions.

## Cache behavior specifics

Cache stores full result object including sources/matches/graph meta — subsequent hits replay identical citations. Assistant switching invalidates by design because assistantKey participates in cache key. POST /ask/reset returns `{success:true, cleared:n}`.

## Important files index

- query/{answer,intent,llm,cache,retrieval,scoring,reranker,context,prompts}.js
- services/cloudflare_ai.js (LLM call), cloudflare_embeddings.js, vectorize.js(vectorQuery), r2.js(getChunk)
- routes/ask.js middleware chain; web/src/pages/AskConsole.jsx client.

## Related features / architecture / limitations

Links: [[Multi-Tenancy & Company Config]], [[Knowledge Bases]], [[GraphRAG]].
Known limitations listed at [[Technical Debt]] TD-3 (cache persistence). TD-9 (fast-path vs persona ordering) was resolved 2026-09-17: assistant overrides resolve before the intent fast-path, so identity questions answer with the assistant persona.