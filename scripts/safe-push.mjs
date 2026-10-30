#!/usr/bin/env node
// safe_push: verify the current branch, then push it to origin.
// Use instead of a bare `git push`; open-pr.mjs runs this first.
// Runs `npm run lint`, `npm test`, `npm run build` and prints "lint ok",
// "tests okay", "build okay" as each passes, then pushes the current branch.
// On the first failure the full command output goes to stderr and nothing
// is pushed. No parameters.
// Part of the agent tooling in scripts/; not shipped in the app or bundle.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ERROR_PREFIX, errorMessage } from '../src/errors.ts';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const steps = [
  ['lint ok', npm, ['run', 'lint']],
  ['tests okay', npm, ['test']],
  ['build okay', npm, ['run', 'build']],
];

function run(command, args) {
  // npm is a .cmd shim on Windows, which Node only spawns via a shell.
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: command === npm,
  });
  if (result.error) {
    console.error(`${ERROR_PREFIX}could not run '${command}': ${errorMessage(result.error)}`);
    return false;
  }
  if (result.status !== 0) {
    // Captured so success stays quiet while failure still shows everything.
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    return false;
  }
  return true;
}

export function runSafePush() {
  for (const [ok, command, args] of steps) {
    if (!run(command, args)) return 1;
    console.log(ok);
  }
  return run('git', ['push', '-u', 'origin', 'HEAD']) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runSafePush();
}
