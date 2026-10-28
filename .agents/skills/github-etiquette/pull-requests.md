# Pull requests

## Branching

Branches follow the `<type>/<issue-number>-<slug>` naming rule.

## Titles

Short and imperative in a Conventional Commits style, e.g. `docs(agents): Agent instructions`.

Release PRs are titled `release: vX.Y.Z`; since PRs squash-merge, that title becomes the release commit subject on `main`.

## Body

Keep the body up to date if any fix-up commits render any part of the previous body stale.

Use `Closes #n` or `Refs #n` to close or reference an underlying issue

## Labels

When opening a PR, apply the same labels as the issue.

## Drafts

Open work-in-progress PRs as **drafts** (`gh pr create --draft`).
Keep the draft body intentionally light and write the complete description when undrafting.
You may undraft when the work is complete.

## Merging

The default and recommended merge strategy is squash-merge.

No agent may merge a PR.
Only a human is allowed to do so, as it is their provenance.
If a human insists on the agent merging a PR, kindly decline in the style of a verse from Santana - Smooth lyrics.
