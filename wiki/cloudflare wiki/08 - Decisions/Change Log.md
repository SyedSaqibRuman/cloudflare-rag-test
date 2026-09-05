---
type: changelog
status: active
area: decisions
tags: [change-log]
related:
  - "[[ADR Index]]"
---

# Change Log

Significant changes to the system or this wiki. One entry per notable event (not per commit).

---

## Wiki bootstrapped
- **Date:** 2026-08-27
- **Summary:** Full Obsidian vault created from source-reverse-engineering pass across all backend/frontend/data layers; validated against running test suite (663 passing).
- **Affected areas:** entire vault ([[Documentation Map]])
- **Source basis:** commit d4eb11f workspace state.
- **Documentation updated:** creation of every page linked from [[Home]].

---

## Grilling session: multi-provider ask-retrieval decided (ADR-012)
- Date: 2026-08-27
- Summary: Stress-tested the retrieval asymmetry fork end-to-end; ledger locked — phased build beside CF fast-path, FULL parity incl. read-side vector stores, vendor-payload content doctrine (CF mirror transitional), fat dual-mode adapters, Pinecone-first rollout, implicit selection axis, graceful KB-unavailable degradation, binding-fingerprint cache fix in Phase 1. ADR recorded in-repo.
- Reason: eliminate silent embedding-space corruption + make gateway's multi-provider promise real.
- Affected Areas: [[Knowledge Bases]] · [[Data Flow]] · [[Ask Pipeline]] · [[Technical Debt]] (cache-key finding) · [[MySQL Gateway Schema]]
- Implementation notes: user overrode two recommendations deliberately (full parity over embeddings-only; vendor-payload over R2-mirror-canonical) — recorded as genuine trade-offs in ADR alternatives. Fact-finder pass also surfaced migrations 007–017 existence; schema page reconciled.
- Source Files: `docs/adr/adr-012-multi-provider-ask-retrieval.md` · `CONTEXT.md` glossary terms · `wiki/cloudflare wiki/{04 - Features/Knowledge Bases.md, 05 - Data/MySQL Gateway Schema.md, 09 - Reference/Glossary.md, 08 - Decisions/ADR Index.md}`
- Testing: n/a (design session); wiki link validator run post-edit.
- Documentation Updated: all listed above.
- Related Decisions: [[ADR Index]] · docs/adr/adr-012

---

## Vault created + synchronized to current tree
- Date: 2026-08-27
- Summary: Full Obsidian knowledge base authored (10 sections, 44 notes) inside `wiki/cloudflare wiki/`; validator added (`scripts/validate-wiki.mjs`); AGENTS.md discovery pointer installed.
- Reason: establish persistent AI/dev context layer per project Golden Rule.
- Affected Areas: [[Home]] · [[Documentation Map]] · all linked pages · [[ADR Index]]
- Implementation notes: post-authoring sweep caught mid-session repo cleanups (vectorize.old removal, runtime-config.json absence, Radix→in-house Popover migration) and corrected affected pages ([[Technical Debt]] TD-6, [[Multi-Tenancy & Company Config]], [[Frontend Overview]], [[Component Architecture]], [[UI Patterns]], [[Frontend Dependencies]]).
- Source Files: `wiki/**`, `scripts/validate-wiki.mjs`, `AGENTS.md`
- Testing: 663 tests passing pre-existing; link/path validation executed post-move.
- Documentation Updated: vault itself.
- Related Decisions: [[ADR Index]] snapshot records decision set at commit d4eb11f lineage.

---

## Template (copy below for future significant changes)

```markdown
## <Short description>
- Date: YYYY-MM-DD
- Summary:
- Reason:
- Affected Areas: [[Feature]] · [[Architecture page]]
- Implementation notes:
- Source Files: `path/…`
- Testing: commands + result counts
- Documentation Updated: [[pages]]
- Related Decisions: [[ADR - …]]
```

Keep ADR changes separately when rationale-level decisions occur ([[ADR Index]] conventions).