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

`resolvePromptVariables(template, config, {assistantName, variables})`: replaces {{KEYS}} from company config, assistant-provided variable array last-write-wins, assistant name overrides CONSULTANT_NAME slot; used identically for system message + static responses.

## Reset matrix

| Call | Scope |
|---|---|
| resetPrompt | SYSTEM_PROMPT template only |
| resetCompanyConfig | tenant keys back to DEFAULT_COMPANY (+name) |
| resetConfig | nukes all company DBs + recreates default Popularcert-style entry (danger) |

## Test seams worth knowing

Route tests chdir into tmp dirs isolating db/; pipeline accepts step overrides incl cache/retrieval/responses; pool injectable for repos. Compose new features testably following these idioms.