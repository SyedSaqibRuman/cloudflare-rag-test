# Triage label vocabulary

The `triage` skill applies exactly these strings. Label equals role name; no overrides
are configured, so triage must never invent near-duplicates (e.g. no `bug:triage`).

| Role | Label string |
|---|---|
| Untriaged intake | `needs-triage` |
| Blocked on reporter input | `needs-info` |
| Safe for an agent to implement | `ready-for-agent` |
| Requires human judgment/action | `ready-for-human` |
| Deliberately not doing | `wontfix` |

Labels go into the `labels:` array of each `.scratch/<feature>/NNN-*.md` issue's
frontmatter (see `docs/agents/issue-tracker.md` for the file format). An issue may carry
one role label at a time; `wontfix` closes the conversation for good.