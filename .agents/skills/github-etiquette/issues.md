# Issues

## Templates

Two templates live in `.github/ISSUE_TEMPLATE/`:

- `bug-report.md` - what happened / what should have happened / steps to reproduce / additional context
- `feature-request.md` - problem first (GIVEN/WHEN/THEN is offered as structure), proposed solution, acceptance sketch

The templates are deliberately lean. Fill in every section they do contain; if one does not apply, write `N/A` instead of deleting it. Put whatever else a reader needs — exact command line, versions, logs — under the last section ("Additional context") or the template's closing comment slot.

## Description structure

Issues in this repo use **Goal** (GIVEN/WHEN/THEN), **Why**, **What** (in/out of scope), **Acceptance criteria**, **Notes** (see #1, #3 for examples). Feature requests may put the GIVEN/WHEN/THEN story in **Problem**, per the template.

## Labels

Current taxonomy on the repository:

| Label | Description | When to use |
| --- | --- | --- |
| `bug` | Something isn't working | Applied automatically by `bug-report.md` |
| `enhancement` | New feature or request | Applied automatically by `feature-request.md` |
| `documentation` | Improvements or additions to documentation | Doc-only work (README, AGENTS.md, templates) |
| `maintenance` | Chores, refactors, and code hygiene | No user-visible behavior change |
| `accessibility` | Barrier affecting people with disabilities | Whenever the report concerns accessibility |
| `question` | Further information is requested | More of a question than a defect or feature |
| `duplicate` | This issue or pull request already exists | After pointing at the original |
| `wontfix` | This will not be worked on | Maintainer decision only |
| `dependencies` | Pull requests that update a dependency file | Stamped on dependabot PRs (npm and github-actions updates) |
| `javascript` | Pull requests that update javascript code | Companion label for JS dependency bumps |

Notes:

- `bug` and `enhancement` come from the template front matter; the reporter does not need to add them.
- `dependencies` / `javascript` belong to automated dependency PRs (see `.github/dependabot.yml`, monthly npm and github-actions updates); do not hand them out to other PRs.
- `duplicate` and `wontfix` resolve an issue: apply them only together with a comment pointing at the original / briefly explaining the decision.

## Planning

Planning happens in the GitHub Project **"MrManny's Flight Path Recorder"** (#3, <https://github.com/users/MrManny/projects/3>), not in milestones. It tracks issues and pull requests alike.

- Newly filed issues will be added to the project automatically.
- Project commands need extra OAuth scopes: `gh auth refresh -s read:project` to read, add `write:project` to add or edit items.

Project management belongs to the humans. Don't change anything in the project unless explicitly asked to by a human.

## Refining an existing issue

Discuss the wording first, then apply it with `gh issue edit <n> --body-file <file>`.
