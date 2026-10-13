# ADR - Dual config store with CONFIG_STORE switch

## Status
Accepted

## Context
Company settings started as one SQLite file per tenant (zero-dep, test-friendly, `node:sqlite` builtin raising the Node floor to 22.5). The AI Gateway platform introduced MySQL as catalog truth; scattering settings between "gateway DB" and side files caused a mirror problem (credentials entered twice).

## Decision
Keep **both** backends behind identical load/save/list/delete contracts selected by `CONFIG_STORE` env: `sqlite` default legacy path writing `db/<company>.db`; `mysql` mapping onto `companies` + `company_config` rows (002 migration) including one-time auto-lift of SQLite data when MySQL companies table is empty and deletion housekeeping on both sides.

## Rationale
Store module comments explicitly frame SQLite as compatibility/test backend while MySQL is canonical for v5 flow; deleteCompanyDb's dual-backend cleanup prevents resurrection-on-boot bugs documented in code comments. Original migration strategy deliberation not recorded beyond this.

## Consequences
### Positive
Test suite runs without any DB server for most groups; incremental adoption for existing installs; single codec keeps encryption parity.
### Negative
Two persistence code paths to maintain; boot-time sync semantics differ (sync vs awaited init); confusion risk around which backend is active when warnings appear ([[Common Problems]]).

## Alternatives
SQLite-only with sync-to-MySQL exporter rejected (drift risk); MySQL-only hard cutover would break test ergonomics embedded deeply in suite design.

## Related Code
`config/store.js`, `config/sqlite.js`, `config/mysql-store.js`, `mysql/migrate.js`, `migrations/002_company_config.sql`.

## Related Documentation
[[Configuration]], [[Config Store Schema]], [[Data Stores]].