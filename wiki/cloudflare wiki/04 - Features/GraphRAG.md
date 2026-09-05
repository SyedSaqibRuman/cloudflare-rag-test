---
type: feature
status: active
area: backend
tags: [feature, neo4j, knowledge-graph]
related:
  - "[[Ask Pipeline]]"
  - "[[External Services]]"
---

# GraphRAG

## Purpose

Augment vector-RAG answers with **relationship facts** from a company-owned Neo4j graph: the ask pipeline generates a read-only Cypher query from the question, executes it, and injects formatted results as a `[Graph Knowledge]` context block beside regular chunks.

## When it activates

`retrieveGraphContext(question, companyName, { database, enabled })` runs only when all of:

1. Not disabled by caller (`enabled:false` from assistant with graph context off),
2. Company config holds `NEO4J_URI` + `NEO4J_USERNAME` + `NEO4J_PASSWORD` (optional `NEO4J_DATABASE`),
3. An assistant-selected `graph_database` resource's `config.database_name` overrides the stored DB name when present,
4. The graph reports non-empty labels/relationshipTypes.

Any failure (bad config, LLM hiccup, network, unsafe Cypher, empty result, timeout) yields **null → pipeline silently proceeds without graph context**. Never errors an ask. Timeout budget: 15 s per Cypher run; output capped GRAPH_MAX_ROWS=20 / GRAPH_MAX_CHARS=2500.

## Safety design (defense in depth)

| Layer | Mechanism |
|---|---|
| Driver | `session.executeRead` access-mode — server refuses write txns |
| Blacklist regex | rejects CREATE/MERGE/DELETE/DETACH/SET/REMOVE/DROP/FOREACH/CALL/LOAD CSV anywhere |
| Structural | rejects second statement after a semicolon; requires MATCH/WITH/WHERE/RETURN/ORDER/LIMIT/UNWIND/OFFSET/OPTIONAL MATCH start vocabulary |
| Resources | fresh short-lived driver per call; lazy `import("neo4j-driver")` keeps module loadable without deps |
| Output | sanitizeText over flattened rows |

Generated queries always parameterize the question as `$q`.

## Where results surface

- `buildUserMessage` receives `context + "\n" + graph.context`.
- The structured `__start` SSE frame carries the `graph` metadata object `{context, cypher}` so the portal can display which Cypher ran (sources panel "Knowledge Graph" framing on start sends).
- Cached answers include graph output — cache invalidates naturally on question changes (same key space).

## Known boundaries

Pipeline ordering fixed at vector-context success: an empty vector retrieval short-circuits to `noContext` **before** graph injection (verified control-flow in `runPipeline`). Non-WAIF model companies unaffected — graph generation uses SMALL_LLM/default with company config either way; generation model = `getLlmModel` unless assistant overrides.

Implementation: `query/graph.js` only; enabled implicitly whenever creds exist (no explicit toggle in company config besides assistant gate). Tests: `query/__tests__/graph-modules.test.js`. Related: [[Integration Architecture]].