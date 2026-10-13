# ADR - Frozen v5 schema and checksummed migrations

## Status
Accepted

## Context
Platform DDL needed a canonical reference ("v5") plus an execution mechanism safe for real ops: hand-run mysql clients, remote managed hosts, MariaDB quirks, statement-level failures mid-file.

## Decision
`schema/v5.sql` is frozen documentation-grade truth never edited. Evolution happens exclusively through additive files `migrations/NNN_*.sql`. The runner checksums each file (SHA-256), refuses edits post-application, parses DELIMITER blocks itself, auto-applies pending at boot under CONFIG_STORE=mysql (also standalone CLI with dry-run), records versions in `schema_migrations`, pins MySQL 8+ but shims MariaDB by stripping PARTITION clauses that conflict with FKs, and pinpoints failing statements.

## Rationale
Runner comments encode lessons learned (checksum edit guard, statement pinpointing, dry-run pool leak fix). Seed-data strategy evolved live: 003 endpoints/pricing no-op → 004 full catalog → 006 child-row backfill, each preserving idempotent INSERT…WHERE NULL patterns with "NEVER edit after applying" headers.

## Consequences
### Positive
Reproducible installs incl. catalog seeds; loud drift detection; deploy-time auto-upgrade safely re-runnable.
### Negative
No downgrade path; failures leave partial DDL requiring manual cleanup message-guided; DBA-ish discipline required (new file per change).

## Alternatives
ORM migrations rejected implicitly (no ORM present); manual SQL console applying v5 wholesale abandoned after 003/004 history above.

## Related Code
`mysql/migrate.js`, `schema/v5.sql`, `migrations/*.sql`.

## Related Documentation
[[MySQL Gateway Schema]], [[Deployment]].