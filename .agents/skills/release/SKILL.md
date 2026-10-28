---
name: release
description: Release workflow. Use when preparing a release.
---

# Release procedure

1. Go to `main` and pull the latest changes

2. Read the pending changesets in `.changeset/` to identify the next version:
  - any `major` fragment → major version — except while the version is `0.x`, where breaking changes are `minor`; in that case ask the user whether to release `1.0.0` or rewrite the fragment as `minor`
  - any `minor` fragment → minor version
  - otherwise → patch version
  - there must be at least one pending changeset; if user-visible changes landed without a fragment, write the missing fragments first (ask the user)
  - if unsure, ask the user

3. switch to a dedicated release branch named `release/vX.Y.Z`

4. Fold the changesets: run `npx changeset version` — this bumps the version in `package.json`, folds the fragments into `CHANGELOG.md` and removes the consumed fragment files; verify the resulting version matches step 2

5. Synchronize the lock file (`npm install --package-lock-only`)

6. Commit and push

7. Open a PR with the title `release: vX.Y.Z`

8. Wait for GitHub CI to finish for the PR; the pipeline **must** be green to continue, otherwise halt and ask the user for direction

9. When CI finished, let the user do a final inspection of the PR and merge it

10. When the user has merged the PR, use the `gh` CLI tool to draft a new release (using the tag `vX.Y.Z`)