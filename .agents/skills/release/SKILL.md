---
name: release
description: Release workflow. Use when preparing a release.
---

# Release procedure

1. Go to `main` and pull the latest changes

2. Fold the changesets: run `npm run changeset:version` on the freshly pulled `main` — this derives the next version from the pending `.changeset/` fragments, folds them into `CHANGELOG.md`, removes the consumed fragment files and synchronizes the version in `package-lock.json`
  - there must be at least one pending changeset; if user-visible changes landed without a fragment, write the missing fragments first (ask the user)

3. Confirm the target version number with the user — they may request a different one depending on the scope of the changes; if it differs from the derived version, adjust `package.json` and the new `CHANGELOG.md` heading
  - while the version is `0.x`, a `major` fragment would mean a `1.0.0` release; say so explicitly when asking

4. Synchronize the lock file (`npm install --package-lock-only`)

5. switch to a dedicated release branch named `release/vX.Y.Z`

6. Before committing, review the new `CHANGELOG.md` section: lead with the user-facing changes and rank technical changes with no real user impact lower — they are less interesting to users

7. Commit with the subject `release: vX.Y.Z` and push

8. Open a PR with the title `release: vX.Y.Z`

9. Wait for GitHub CI to finish for the PR; the pipeline **must** be green to continue, otherwise halt and ask the user for direction

10. When CI finished, let the user do a final inspection of the PR and merge it

11. When the user has merged the PR, use the `gh` CLI tool to draft a new release (using the tag `vX.Y.Z`); take the new `CHANGELOG.md` section for `vX.Y.Z` as the change description (e.g. extract it to a file and pass it via `gh release create vX.Y.Z --draft --notes-file <file>`)