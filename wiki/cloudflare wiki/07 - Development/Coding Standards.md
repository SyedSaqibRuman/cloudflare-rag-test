---
type: development
status: active
area: dev
tags: [standards]
related:
  - "[[Development Workflow]]"
---

# Coding Standards

Derived from existing code (eslint.config.js + pervasive conventions). Follow these before introducing new patterns.

## Language & layout

- Node ESM only (`"type":"module"`); explicit file extensions in imports.
- 2-space indentation; double quotes; semicolons.
- Banner comments `// ------` demarcate logical sections; file-top block comment states ownership/contract.
- Emoji-prefixed console logs (✅ ❌ ⚠️ ℹ️ 🚀 🗑 🔹 …) as house style for scan-ability.

## Naming & functions

- camelCase fns/vars, UPPER_SNAKE constants, kebab-case filenames, PascalCase React components/classes.
- JSDoc on every exported helper (params/returns), including `@param {AbortSignal|null}` style.
- Unused bindings intentionally prefixed `_` — eslint configured with varsIgnorePattern (never re-enable noise rules ad hoc).

## Error & async conventions

Throw typed AppError subclasses from domain code ([[Error Handling]]); routes map via wrap(); best-effort wrappers try/catch with comment explaining swallow rationale. Prefer AbortController threading over timers where cancellation matters; use helpers `retry/sleep/checkAbort` from utils.

## SQL discipline

All SQL inside mysql/repositories/*; parameterized only; snake_case→camelCase mapping at boundary; new DDL → migrations file never edits old ones.

## React/portal

Function components + hooks; colocated hooks per domain folder (`useCatalog.js`, `use-credential-modal.js`); one modal per file; shared primitives extended before custom CSS; eslint react-hooks exhaustive-deps left warn w/ targeted disables + justification comment.

## Tests placement

`__tests__/` siblings; pure-ESM constraint honored for query/web groups; fake injection seams preferred over mocking libs (none installed).

## Explicitly avoid

Default exports sprinkling (routers/pages use default barrels intentionally — don't mix more), console debug without NODE_ENV gate additions to hot paths, env-based company config additions, regex-light security filters for new attacker-controlled inputs (reuse shared/patterns.js first).
