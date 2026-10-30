#!/usr/bin/env node
// open_pr <title> <body_path> [base]: verify, push and open a pull request.
// Runs safe_push first, then fails fast when a feat:/fix: title would open
// without a new .changeset/*.md fragment. The PR gets the labels of the first
// issue the body references ("Refs #42" / "Closes #42" / "Fixes #42"), and
// that issue moves to "In review" ("Issue 42 set to 'in review'") when your
// gh login can edit this repo's GitHub project; otherwise that step is
// skipped silently. [base] defaults to main; pass a branch to target it.
// Part of the agent tooling in scripts/; not shipped in the app or bundle.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hasChangesetFragment, prNeedsChangeset } from '../src/changeset-gate.ts';
import { setIssueStatus } from './lib/project.mjs';
import { exec, execOrThrow } from './lib/exec.mjs';
import { ERROR_PREFIX, errorMessage } from '../src/errors.ts';

const ISSUE_REFERENCE = /\b(?:refs?|close[sd]?|fix(?:es|ed)?)\s+#(\d+)\b/i;

function listChanged(base) {
  const output = execOrThrow(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', '-z', `${base}...HEAD`],
  );
  return output.split('\0').filter(Boolean);
}

function issueLabels(issue) {
  const json = execOrThrow('gh', ['issue', 'view', issue, '--json', 'labels']);
  return JSON.parse(json).labels.map((label) => label.name);
}

export function runOpenPr(argv) {
  const [title, bodyPath, base = 'main'] = argv;
  if (!title || !bodyPath) {
    console.error(`${ERROR_PREFIX}usage: node scripts/open-pr.mjs <title> <body_path> [base]`);
    return 1;
  }
  const push = exec(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'safe-push.mjs')], {
    stdio: 'inherit',
  });
  if (push.status !== 0) return 1;

  try {
    // The gate runs after safe_push so a missing fragment fails before any
    // half-written PR exists.
    if (prNeedsChangeset(title) && !hasChangesetFragment(listChanged(base))) {
      console.error(`${ERROR_PREFIX}'${title}' must add a .changeset/*.md fragment (see .changeset/README.md)`);
      return 1;
    }
    const issue = ISSUE_REFERENCE.exec(readFileSync(bodyPath, 'utf8'))?.[1];
    const args = ['pr', 'create', '--title', title, '--body-file', bodyPath, '--base', base];
    for (const label of issue ? issueLabels(issue) : []) args.push('--label', label);
    execOrThrow('gh', args, { stdio: 'inherit' });
    if (issue && setIssueStatus(issue, 'In review')) {
      console.log(`Issue ${issue} set to 'in review'`);
    }
    return 0;
  } catch (error) {
    console.error(`${ERROR_PREFIX}${errorMessage(error)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runOpenPr(process.argv.slice(2));
}
