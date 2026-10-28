// Strict Conventional Commits: lowercase feat/fix only; broader spellings
// stay exempt on purpose.
const PR_TITLE_NEEDS_CHANGESET = /^(feat|fix)(\([^)]+\))?!?:/;

// Release PRs carry the version fold, so CHANGELOG.md must change there.
const PR_TITLE_NEEDS_CHANGELOG = /^release(\([^)]+\))?:/;

// A fragment is a top-level .changeset/*.md file; the README documents the
// convention and never counts as a change entry.
const CHANGESET_FRAGMENT_PATH = /^\.changeset\/([^/]+)\.md$/;

const CHANGELOG_PATH = /^CHANGELOG\.md$/;

export type GateOutcome = { ok: true; note: string } | { ok: false; error: string };

export function prNeedsChangeset(prTitle: string): boolean {
  return PR_TITLE_NEEDS_CHANGESET.test(prTitle.trim());
}

export function prNeedsChangelogUpdate(prTitle: string): boolean {
  return PR_TITLE_NEEDS_CHANGELOG.test(prTitle.trim());
}

// The shell skips git entirely for ungated titles: an exempt PR must never go
// red because listing changed files failed.
export function prNeedsArtifact(prTitle: string): boolean {
  return prNeedsChangeset(prTitle) || prNeedsChangelogUpdate(prTitle);
}

export function hasChangesetFragment(changedPaths: readonly string[]): boolean {
  return changedPaths.some((path) => {
    const match = CHANGESET_FRAGMENT_PATH.exec(path);
    return match !== null && match[1].toLowerCase() !== 'readme';
  });
}

export function hasChangelogUpdate(changedPaths: readonly string[]): boolean {
  return changedPaths.some((path) => CHANGELOG_PATH.test(path));
}

export function evaluateGate(prTitle: string, changedPaths: readonly string[]): GateOutcome {
  const title = prTitle.trim();
  if (prNeedsChangeset(title)) {
    return hasChangesetFragment(changedPaths)
      ? { ok: true, note: `changeset: fragment found for '${title}'` }
      : {
          ok: false,
          error: `'${title}' must add a .changeset/*.md fragment (see .changeset/README.md)`,
        };
  }
  if (prNeedsChangelogUpdate(title)) {
    return hasChangelogUpdate(changedPaths)
      ? { ok: true, note: `changeset: CHANGELOG.md updated for '${title}'` }
      : { ok: false, error: `'${title}' must change CHANGELOG.md` };
  }
  return { ok: true, note: `changeset: '${title}' requires no changelog artifact` };
}
