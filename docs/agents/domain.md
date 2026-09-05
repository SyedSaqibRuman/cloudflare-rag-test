# Domain docs

## Layout

Single-context.

- Root `CONTEXT.md` — always-read-first summary of product domain, terminology, invariants.
- `docs/adr/` — Architecture Decision Records, one numbered file per decision.

Status at setup time: both exist as starters. Keep them thin; depth belongs in the vault.

## Consumer rules

1. Before implementing anything non-trivial, read `CONTEXT.md` (if present), then any ADR
   touching the affected area.
2. Architecturally significant decisions (new data store/provider/pattern, auth changes,
   pipeline-stage reordering) become a NEW numbered ADR in `docs/adr/`. Never rewrite an
   accepted ADR — supersede it with a newer one.
3. Historical decisions recorded in the Obsidian vault (`wiki/cloudflare wiki/
   08 - Decisions/`) stay there; new ADRs land in `docs/adr/` and the vault's
   [[ADR Index]] gains a pointer to them. Two homes, one linked graph — never duplicate bodies.
4. Don't inline domain knowledge into specs/prompts when linking `CONTEXT.md` or an ADR works.
5. If behavior contradicts documented domain rules, fix code or docs immediately —
   divergence is itself a bug.