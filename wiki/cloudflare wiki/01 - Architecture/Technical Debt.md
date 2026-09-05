---
type: architecture
status: active
area: architecture
tags: [debt, risks]
related:
  - "[[Security Model]]"
  - "[[Technical Debt]]"
---

# Technical Debt

Each item labeled **Confirmed issue** / **Potential issue** / **Recommendation**, with evidence. Codebase crawled 2026-08-27 @ commit d4eb11f.

## TD-1 · `TRUST_PROXY` is parsed but never defined — Confirmed issue
- **Evidence:** `app.js:35-48` reads `env.TRUST_PROXY`; `env.js` frozen object defines PORT/NODE_ENV/CONFIG_STORE/ADMIN_*/MYSQL_* but **no TRUST_PROXY key**; `.env.example` documents the variable.
- **Impact:** operator sets `TRUST_PROXY=1` in production, has zero effect; app silently stays `trust proxy=true`, letting clients rotate `X-Forwarded-For` to defeat rate limits and misattribute IPs.
- **Risk:** high (security-relevant), trivial fix (add property to `env.js`).
- **Files:** `env.js`, `app.js`.

## TD-2 · Slack/Discord webhook formatting unreachable — Confirmed issue
- **Evidence:** `ingest/webhooks.js:62-63` builds payload by testing regexes against `stats._webhookUrl || ""`, but the URL lives on `opts.webhookUrl`; `stats` never carries `_webhookUrl`.
- **Impact:** all ingestion notifications send the generic JSON body; special Slack blocks/Discord embeds dead code.
- **Fix:** pass `webhookUrl` into `buildPayload`.
- **Files:** `ingest/webhooks.js`.

## TD-3 · Single-process statefulness — Potential issue (design)
- **Evidence:** answer cache `Map` (`query/cache.js`), standaloneJobs/cronSchedulers Maps (`cron/lifecycle.js`), express-rate-limit memory store, provider registry in-memory cache.
- **Impact:** horizontal scaling loses dedupe of schedules (double-cron), cache hit rates, limiter counts; restart wipes warm caches and running job state.
- **Suggested:** extract scheduler to dedicated worker/queue before scaling out; document single-instance constraint.

## TD-4 · Reset helpers mutate memory before persistence resolves — Potential issue
- **Evidence:** `config/write.js resetPrompt/resetCompanyConfig` assign into `runtimeConfig` then `await saveConfig(...)`; unlike `updateCompany`, a failed persist leaves memory already changed and route returns error.
- **Risk:** low; drift between "persist-first" rule documented elsewhere and these two legacy functions.

## TD-5 · Docs drift risk across `docs/`
- **Evidence:** README maps Scheduler docs to `/scheduler/*` while routes mount under `/cloudflare/*` (`routes/cloudflare.js`, `routes/cron.js`); AGENTS.md still describes the pre-gateway layout — the standalone/scheduler/state/status cron modules (now consolidated into `cron/lifecycle.js`) and a standalone credentials page (now embedded in catalog detail).
- **Impact:** new contributors/AI agents follow stale instructions.
- **Recommendation:** treat this wiki as canonical; periodically re-run verification checklist in [[Documentation Map]].

## TD-6 · Dead/duplicated remnants — Confirmed, cosmetic
- Stale duplicate service file vectorize.old.js sat beside services/vectorize.js historically; **removed** while authoring this wiki (absence verified).
- Root contains scratch artifacts (`fix_imports.py`, stray processed JSON variants); none imported by runtime.

## TD-7 · Vectorize dimension fallback hardcoded 768 — Potential issue
- **Evidence:** `services/vectorize.js DIMENSIONS = 768` fallback if company lacks `EMBEDDING_DIMENSIONS`; embeddings model map allows 384/1024 models.
- **Impact:** upsert failure "Invalid embedding detected" surfaces instead of earlier guard when config incomplete; already partially mitigated by auto-set on model change (`config/company.js applyModelDimensions`).

## TD-8 · Sparse structured progress for long ingestions — Recommendation
- `mysql/routes/ingestion.js GET /gateway/ingest/status/:companyName` comments admit documentCount/vectorCount placeholders ("we would need to store this"); KB detail gets stats persisted post-completion instead. Consider streaming progress events via registry/pipeline hook (`setProgress` exists end-to-end but isn't surfaced).

## TD-9 · Fast-path ordering vs assistant persona — Potential nuance, not defect
- `runPipeline` computes fast-path canned replies *before* resolving assistant overrides; greeting/identity copy uses company defaults. Documented behavior of record: [[Data Flow]].

## Positive debt-prevention patterns worth keeping

Typed AppError taxonomy + `wrap()`; checksummed migrations forbidding edits; `_usePoolForTests`/step-injection seams enabling 663 dependency-free tests; shared modules (`shared/*`) preventing server↔portal drift.