---
type: infrastructure
status: active
area: infra
tags: [config-facade]
related:
  - "[[Multi-Tenancy & Company Config]]"
---

# Configuration

## The facade rule

Import config ONLY from `config/index.js`: schema/constants, store sync reads (`getCompanyConfig`,`runtimeConfig`,`initConfig`), validation, prompt variable resolution, company CRUD (`getConfig,listCompanies,getCompany,createCompany,updateCompany,deleteCompany,setCompanyApiKey,applyConfigPatch,applyModelDimensions`), write path (`updateConfig,resetPrompt,resetCompanyConfig,resetConfig`), creds (`resolveCreds,generateApiKey`). Store internals stay hidden to preserve the fixed import order that avoids ESM TDZ circularity (**store.js imports only schema+encryption+backends**).

## Boot init contract

`initConfig()` awaited before app.listen / cli loop: MySQL path lifts SQLite once-if-empty then fills singleton; failures abort server startup (exit 1). After boot everything sync.

## Runtime semantics

- Reads: instantaneous dict access.
- Writes: async persist-first helpers returning `{error}` on failure without mutating memory; success mutates singleton then returns fresh config.
- Hot-swap: models/resources/prompt changes reflect next request with zero restarts.

## Prompt variable resolution

`resolvePromptVariables(template, config, {assistantName, variables})` replaces `{{KEYS}}` from **custom variables only** — there are **no built-in variables**. Two tiers, later wins:

| Tier | Source | Managed at |
|---|---|---|
| 1. company | `config.PROMPT_VARIABLES` (array of `{key,value}`) | Config → Prompt → Default System Prompt |
| 2. assistant | `assistant.assistant_variables` | Assistants → Prompt tab |

`assistantName` is still accepted for call-site symmetry but is NOT injected — define an `ASSISTANT_NAME` variable to use it. A placeholder with no matching pair is returned **literal** (never blanked) and reported in the route's `missing[]`; the Config page flags unresolved placeholders red.

Rules live in `shared/prompt-variables.js` (`PROMPT_VARIABLE_KEY_RE` `[A-Z][A-Z0-9_]*` ≤64, ≤50 variables, values ≤2000 chars, case-insensitive match, last-write-wins dedupe) and are imported by BOTH the server and the portal, so the preview cannot drift from the ask path. `getPromptVariableMap(config, assistantVars)` is the `{KEY:value}` shape returned by `GET /cloudflare/prompt`.

> **Migration:** the removed built-ins were `CONSULTANT_NAME`, `COMPANY_NAME`, `CONTACT_US_URL`, `LOCATIONS_URL`, `SERVICES_URL`, `BASE_URL`, `COMPANY_WEBSITE`, `ASSISTANT_NAME`, `CURRENT_DATE`, `CURRENT_YEAR`. `scripts/backfill-prompt-variables.mjs` (dry run by default, `--apply`) materializes each tenant's former built-ins from their own config so prompts resolve byte-identically. `CURRENT_DATE`/`CURRENT_YEAR` are deliberately NOT seeded (a stored date goes stale).

`SYSTEM_PROMPT` + `PROMPT_VARIABLES` are returned by `GET /cloudflare/config` under the `PROMPT` section. `applyConfigPatch` has an **array branch** for `PROMPT_VARIABLES` — without it the array would fall through the string/number branches and be silently dropped.

## Reset matrix

| Call | Scope |
|---|---|
| resetPrompt | SYSTEM_PROMPT template only |
| resetCompanyConfig | tenant keys back to DEFAULT_COMPANY (+name) |
| resetConfig | nukes all company DBs + recreates default Popularcert-style entry (danger) |

## Test seams worth knowing

Route tests chdir into tmp dirs isolating db/; pipeline accepts step overrides incl cache/retrieval/responses; pool injectable for repos. Compose new features testably following these idioms.