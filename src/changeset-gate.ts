// Strict Conventional Commits prefixes: lowercase `feat`/`fix` with optional
// scope and breaking marker. Broader spellings stay exempt on purpose.
const PR_TITLE_NEEDS_CHANGESET = /^(feat|fix)(\([^)]+\))?!?:/;

// A fragment is a top-level .changeset/*.md file; README.md documents the
// convention and never counts as a change entry.
const CHANGESET_FRAGMENT_PATH = /^\.changeset\/(?!README\.md$)[^/]+\.md$/;

export function prNeedsChangeset(prTitle: string): boolean {
  return PR_TITLE_NEEDS_CHANGESET.test(prTitle);
}

export function hasChangesetFragment(changedPaths: readonly string[]): boolean {
  return changedPaths.some((path) => CHANGESET_FRAGMENT_PATH.test(path));
}
