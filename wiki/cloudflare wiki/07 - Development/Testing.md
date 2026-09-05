---
type: development
status: active
area: dev
tags: [tests]
related:
  - "[[Debugging]]"
---

# Testing

## Runner reality

Built-in `node:test` + `node:assert/strict`; **no Jest/Vitest/mocking libs**. One glob command runs everything:

```bash
npm test   # config, query, cron, ingest, routes, mysql __tests__ + web/src/** tests
```

Verified passing state while writing this wiki: **663 tests / 64 suites / 0 fail** (~12 s).

## Per-group characteristics

| Group | Needs node_modules? | Technique |
|---|---|---|
| query modules incl stream-contract, graph, assistant, pipeline | no | pure ESM, step-injection overrides on runPipeline |
| config crypto/validation | no | direct function assertions |
| cron lifecycle | yes (dotenv via ingest import) | timer-free guard tests |
| ingest pipeline/kb/resolve/scope/v5 | yes | adapter fakes implementing contract; p-limit real |
| routes ask/auth/logs | yes | express app built per test w/ injected fake pipeline; process.chdir(tmp) isolates db/ |
| mysql services/repositories/gateway routers | no | `_usePoolForTests(fake)` + wrap-level error asserts |
| web catalog gating etc. | no | plain ESM imports of helper modules |

## Conventions when adding tests

- Colocate under nearest `__tests__`, name `*.test.js`.
- Never rely on network/live CF creds; simulate upstreams at service seams (e.g., probes builder unit-tested pure).
- Each file independent process-safe (chdir trick) so ordering can't leak state.

## Running subsets safely

```bash
node --test "query/__tests__/*.test.js"      # single group OK (explicit glob)
node scripts/test.js                          # MySQL connectivity helper script only
```

⚠️ **Never bare `node --test`** — it recurses into scripts/* dev tools named like tests requiring .env/network and will fail loudly (documented gotcha).

## Gaps (honest)

No coverage tooling wired; portal has minimal component tests (logic-modules only); SSE client parser exercised through backend contract tests rather than jsdom UI tests.