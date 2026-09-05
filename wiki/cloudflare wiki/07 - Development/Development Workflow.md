---
type: development
status: active
area: dev
tags: [workflow]
related:
  - "[[Coding Standards]]"
---

# Development Workflow

## Observed contribution pattern (from git history)

Direct commits to a single branch, Conventional-Commit flavored subjects (`feat:`, `fix:`, `docs:`, `chore:`), sizable feature commits (gateway buildout example d4eb11f). No PR/CI automation present (**absence confirmed**) — local gates below are the safety net.

## The working loop (aligns with project Golden Rule)

1. **Context**: open relevant wiki pages first (Documentation Map picks them by task).
2. **Inspect code** at the files the pages point to.
3. **Impact sketch** for non-trivial work: modules→files→APIs→data→tests→docs.
4. Implement smallest clean change following existing patterns ([[Coding Standards]]).
5. Validate: `npm test`, targeted lint `npm run lint`, portal build when web touched.
6. Update wiki pages touched + [[Change Log]] entry for significant changes.
7. Re-verify sync (code↔wiki↔ADR) before finishing.

## Where changes typically land

| Task type | Touch points |
|---|---|
| New ask behavior | query/* step module + constants table in [[Data Flow]] + route tests |
| New admin endpoint | routes/… or mysql/routes/<entity> + Routes Map/API Reference + openapi.js spec note |
| New config key | schema lists (backend+portal re-export), validation, docs table |
| New provider integration | catalog seed/importer + probes + optional executor/adapter |
| Pipeline stage change | retrieval/scoring/reranker + README-style contract comments at top of retrieval.js |

## Commit hygiene

Banner-comment sections, emoji logs and test-first seams make reviews cheap; keep unrelated refactors out of behavioral commits per history style.

## Definition of done

Tests pass locally (suite count quoted in [[Testing]]), lint clean, wiki consistent, no new debt item undocumented (add to [[Technical Debt]] if introduced deliberately).