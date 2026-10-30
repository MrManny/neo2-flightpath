import { pathToFileURL } from 'node:url';

// The gate imports the TypeScript source directly: Node >= 24 strips the
// types, so CI needs no build and the gate cannot test stale compiled output.
import { evaluateGate, prNeedsArtifact } from '../src/changeset-gate.ts';
import { execOrThrow } from './lib/exec.mjs';
import { ERROR_PREFIX, errorMessage } from '../src/errors.ts';

function listChangedFiles(baseSha, headSha) {
  // -z keeps non-ASCII and space-bearing paths unquoted; ACMR drops pure
  // deletions so removing a stale fragment never counts as having one.
  const output = execOrThrow(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', '-z', `${baseSha}...${headSha}`],
  );
  return output.split('\0').filter(Boolean);
}

export function runCheck(env, deps) {
  const { listChanged = listChangedFiles, log = console.error } = deps ?? {};
  const { PR_TITLE, BASE_SHA, HEAD_SHA } = env;
  if (!PR_TITLE || !BASE_SHA || !HEAD_SHA) {
    log(`${ERROR_PREFIX}PR_TITLE, BASE_SHA and HEAD_SHA must be set`);
    return 1;
  }
  try {
    const changed = prNeedsArtifact(PR_TITLE) ? listChanged(BASE_SHA, HEAD_SHA) : [];
    const outcome = evaluateGate(PR_TITLE, changed);
    log(outcome.ok ? outcome.note : `${ERROR_PREFIX}${outcome.error}`);
    return outcome.ok ? 0 : 1;
  } catch (cause) {
    log(`${ERROR_PREFIX}could not list changed files: ${errorMessage(cause)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCheck(process.env);
}
