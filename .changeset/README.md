# Changesets

Every user-visible change ships with a small markdown fragment in this
directory; the fragments are folded into `CHANGELOG.md` when a release is cut.

## Adding a changeset

Run `npm run changeset`, or hand-write a `<name>.md` file:

```md
---
"neo2-flightpath": minor
---

Describe the change as a user would notice it, in one or two sentences.
```

The bump level in the front matter (`major`, `minor`, `patch`) says how the
change affects the version:

- `major` — breaking changes
- `minor` — new features and other behavior changes
- `patch` — fixes

While the major version is `0`, breaking changes are authored as `minor`
(semver treats `0.x` minors as possibly breaking). The release process asks
before turning a `major` fragment into a `1.0.0` release.

Pull requests titled `feat:`/`fix:` must add a fragment, and pull requests
titled `release:` must change `CHANGELOG.md`; CI enforces both. Pull requests
titled `chore:`, `docs:`, `refactor:`, `test:` or `ci:` need no fragment.
