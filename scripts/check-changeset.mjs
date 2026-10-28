// scripts/check-changeset.mjs - CI gate: feat/fix PRs must add a .changeset fragment.
import { execFileSync } from 'node:child_process';

import { hasChangesetFragment, prNeedsChangeset } from '../dist/changeset-gate.js';
import { errorMessage } from '../dist/errors.js';

const ERROR_PREFIX = '[neo2-flightpath] ERROR: ';

function changedFiles(baseSha, headSha) {
  const output = execFileSync('git', ['diff', '--name-only', `${baseSha}...${headSha}`], {
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function fail(message) {
  console.error(`${ERROR_PREFIX}${message}`);
  process.exitCode = 1;
}

function main() {
  const { PR_TITLE, BASE_SHA, HEAD_SHA } = process.env;
  if (!PR_TITLE || !BASE_SHA || !HEAD_SHA) {
    fail('PR_TITLE, BASE_SHA and HEAD_SHA must be set');
    return;
  }
  if (!prNeedsChangeset(PR_TITLE)) {
    console.error(`changeset: '${PR_TITLE}' does not require a changeset fragment`);
    return;
  }
  try {
    if (hasChangesetFragment(changedFiles(BASE_SHA, HEAD_SHA))) {
      console.error(`changeset: fragment found for '${PR_TITLE}'`);
      return;
    }
  } catch (cause) {
    fail(`could not list changed files: ${errorMessage(cause)}`);
    return;
  }
  fail(`'${PR_TITLE}' must add a .changeset/*.md fragment (see .changeset/README.md)`);
}

main();
