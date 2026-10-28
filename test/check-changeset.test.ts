import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { runCheck } from '../scripts/check-changeset.mjs';

const FULL_ENV = { PR_TITLE: 'feat: add thing', BASE_SHA: 'base', HEAD_SHA: 'head' };

interface RunResult {
  code: number;
  lines: string[];
}

function run(env: Record<string, string | undefined>, changed: string[] | Error): RunResult {
  const lines: string[] = [];
  const listChanged = (): string[] => {
    if (changed instanceof Error) {
      throw changed;
    }
    return changed;
  };
  const code = runCheck(env, { listChanged, log: (line: string) => lines.push(line) });
  return { code, lines };
}

it.for([
  {
    name: 'missing environment',
    env: {},
    changed: [],
    code: 1,
    message: '[neo2-flightpath] ERROR: PR_TITLE, BASE_SHA and HEAD_SHA must be set',
  },
  {
    name: 'exempt title',
    env: { PR_TITLE: 'chore: tidy up', BASE_SHA: 'base', HEAD_SHA: 'head' },
    changed: [],
    code: 0,
    message: "changeset: 'chore: tidy up' requires no changelog artifact",
  },
  {
    name: 'feat with fragment',
    env: FULL_ENV,
    changed: ['.changeset/funny-lions-jump.md'],
    code: 0,
    message: "changeset: fragment found for 'feat: add thing'",
  },
  {
    name: 'feat without fragment',
    env: FULL_ENV,
    changed: ['src/render.ts'],
    code: 1,
    message:
      "[neo2-flightpath] ERROR: 'feat: add thing' must add a .changeset/*.md fragment (see .changeset/README.md)",
  },
  {
    name: 'release with changelog',
    env: { PR_TITLE: 'release: v0.2.0', BASE_SHA: 'base', HEAD_SHA: 'head' },
    changed: ['CHANGELOG.md'],
    code: 0,
    message: "changeset: CHANGELOG.md updated for 'release: v0.2.0'",
  },
  {
    name: 'release without changelog',
    env: { PR_TITLE: 'release: v0.2.0', BASE_SHA: 'base', HEAD_SHA: 'head' },
    changed: [],
    code: 1,
    message: "[neo2-flightpath] ERROR: 'release: v0.2.0' must change CHANGELOG.md",
  },
  {
    name: 'git failure',
    env: FULL_ENV,
    changed: new Error('bad revision'),
    code: 1,
    message: '[neo2-flightpath] ERROR: could not list changed files: bad revision',
  },
])('runCheck: $name', ({ env, changed, code, message }) => {
  const result = run(env, changed);
  expect(result.code).toBe(code);
  expect(result.lines).toEqual([message]);
});

it('does not list changed files for exempt titles', () => {
  const lines: string[] = [];
  const listChanged = (): string[] => {
    throw new Error('must not be called');
  };
  const code = runCheck(
    { PR_TITLE: 'chore: tidy up', BASE_SHA: 'base', HEAD_SHA: 'head' },
    { listChanged, log: (line: string) => lines.push(line) },
  );
  expect(code).toBe(0);
  expect(lines).toEqual(["changeset: 'chore: tidy up' requires no changelog artifact"]);
});

it('entrypoint exits 1 when environment variables are missing', () => {
  const script = fileURLToPath(new URL('../scripts/check-changeset.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, PR_TITLE: '', BASE_SHA: '', HEAD_SHA: '' },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('[neo2-flightpath] ERROR: PR_TITLE, BASE_SHA and HEAD_SHA must be set');
});
