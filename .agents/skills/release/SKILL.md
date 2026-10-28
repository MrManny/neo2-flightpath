---
name: release
description: Release workflow. Use when preparing a release.
---

# Release procedure

1. Go to `main` and pull the latest changes

2. Look at which version was tagged previously, and identify what kind of changes happened since then. The process follows semantic commits:
  - any breaking changes (e.g. `feat!`) **and** our version is **not** `0.x` → major version
  - non-breaking feature changes (e.g. `feat: ...`) → minor version
  - otherwise → patch version
  - if unsure, ask the user

3. switch to a dedicated release branch named `release/vX.Y.Z`

4. Bump the version in `package.json`

5. Synchronize the lock file (`npm install --package-lock-only`)

6. Commit and push

7. Open a PR with the title `release: vX.Y.Z`

8. Wait for GitHub CI to finish for the PR; the pipeline **must** be green to continue, otherwise halt and ask the user for direction

9. When CI finished, let the user do a final inspection of the PR and merge it

10. When the user has merged the PR, use the `gh` CLI tool to draft a new release (using the tag `vX.Y.Z`)