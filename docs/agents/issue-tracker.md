# Issue tracker

## Tracker

Local markdown. Issues live as git-tracked files in this repository under `.scratch/<feature>/`.

## Conventions

- One directory per feature/epic: `.scratch/<feature-slug>/`
- Filenames: `NNN-short-title.md` (zero-padded, incrementing within the dir)
- Each issue is one standalone markdown file with YAML frontmatter:

```yaml
---
id: <feature-slug>/001
title: Short imperative title
status: open        # open | done
labels: []          # triage labels — see docs/agents/triage-labels.md
---
```

Body sections expected by the skills:

```markdown
## Problem
What is wrong or missing (symptoms, reproduction steps).

## Evidence
File paths, log lines, failing test output.

## Task
Smallest clean change that resolves it.
```

- Creating an issue = writing one of these files. Closing = flip `status: done`.
- No external CLI, nothing to authenticate; works fully offline/solo. History lives in git
  (delete `status: done` files whenever you like).
- Skills consuming this tracker: `to-tickets` (writes), `triage` (applies labels),
  `to-spec` / `implement` (read tasks), `grill-with-docs` / `handoff` (context linking).

## PRs as a request surface

Not applicable (local tracker, no external system).