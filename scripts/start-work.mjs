#!/usr/bin/env node
// start_work <branch>: start work on the issue a branch name points at.
// Branch names follow <type>/<issue-number>-<slug>, e.g. fix/42-truth-aint-it.
// Assigns the issue to you ("Assigned issue 42"), creates and switches to the
// branch ("Creating branch `fix/42-truth-aint-it`"), and — only when your gh
// login can edit this repo's GitHub project — moves it to "In progress"
// ("Issue 42 set to 'in progress'"); without project access that step is
// skipped silently. One parameter: the branch name.
// Part of the agent tooling in scripts/; not shipped in the app or bundle.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { setIssueStatus } from './lib/project.mjs';
import { ERROR_PREFIX, errorMessage } from '../src/errors.ts';

export function runStartWork(argv) {
  const branch = argv[0];
  const issue = branch ? /^[\w.-]+\/(\d+)-/.exec(branch)?.[1] : undefined;
  if (!issue) {
    console.error(`${ERROR_PREFIX}usage: node scripts/start-work.mjs <branch> with branch <type>/<issue-number>-<slug>`);
    return 1;
  }
  try {
    execFileSync('gh', ['issue', 'edit', issue, '--add-assignee', '@me']);
    console.log(`Assigned issue ${issue}`);
    console.log(`Creating branch \`${branch}\``);
    execFileSync('git', ['switch', '-c', branch]);
    if (setIssueStatus(issue, 'In progress')) {
      console.log(`Issue ${issue} set to 'in progress'`);
    }
    return 0;
  } catch (error) {
    console.error(`${ERROR_PREFIX}${errorMessage(error)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runStartWork(process.argv.slice(2));
}
