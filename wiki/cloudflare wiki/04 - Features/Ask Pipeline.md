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
| intent fast-path | query/intent.js | greeting/name/identity/contact/discovery/office/help/blocked/vague canned replies; vague detection bypassed for non-ASCII scripts |
| assistant overrides | query/assistant.js | lazy MySQL resolve; runnable-model gate only allows @cf/@cloudflare prefixes ([[Assistant Personas]]) |
| rewrite | query/llm.js rewriteFollowup | skipped when history empty; INVALID/error → original question preserved |
| cache | query/cache.js | key md5(company:assistantKey:question); TTL 60m; FIFO cap200; company-tagged purge via /ask/reset |
| retrieve+rank | query/retrieval.js + scoring.js + reranker.js | thresholds documented; reranker parallel fan-out w/ per-item fallback to hybrid |
| context build | query/context.js buildContext/sanitizeText | char budget stops *before* adding a section that would overflow |
| graph step | query/graph.js | see [[GraphRAG]] |
| prompt assembly | query/prompts.js getSystemMessage + variables templating | template = assistant override ?? company SYSTEM_PROMPT |

## API endpoint semantics

Request validation ensures trimmed non-empty string question & array history else 400 (`routes/ask.js`). Response always `{success:true,...result}` where result carries pipeline contract fields. Errors inside pipeline return graceful text rather than HTTP failure except transport-level failures.

## Cache behavior specifics

Cache stores full result object including sources/matches/graph meta — subsequent hits replay identical citations. Assistant switching invalidates by design because assistantKey participates in cache key. POST /ask/reset returns `{success:true, cleared:n}`.

## Important files index

- query/{answer,intent,llm,cache,retrieval,scoring,reranker,context,prompts}.js
- services/cloudflare_ai.js (LLM call), cloudflare_embeddings.js, vectorize.js(vectorQuery), r2.js(getChunk)
- routes/ask.js middleware chain; web/src/pages/AskConsole.jsx client.

## Related features / architecture / limitations

Links: [[Multi-Tenancy & Company Config]], [[Knowledge Bases]], [[GraphRAG]].
Known limitations listed at [[Technical Debt]] TD-3 (cache persistence) & TD-9 (fast-path vs persona ordering nuance).