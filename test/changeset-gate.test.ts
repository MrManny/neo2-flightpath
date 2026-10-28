import { expect, it } from 'vitest';

import {
  evaluateGate,
  hasChangesetFragment,
  hasChangelogUpdate,
  prNeedsArtifact,
  prNeedsChangeset,
  prNeedsChangelogUpdate,
} from '../src/changeset-gate.js';

it.for([
  { name: 'feat', title: 'feat: add thing', want: true },
  { name: 'fix', title: 'fix: correct crash', want: true },
  { name: 'feat with scope', title: 'feat(otel): add tracing', want: true },
  { name: 'fix with scope', title: 'fix(srt): handle blank lines', want: true },
  { name: 'feat breaking', title: 'feat!: drop legacy flag', want: true },
  { name: 'fix scoped breaking', title: 'fix(config)!: rename option', want: true },
  { name: 'whitespace-padded', title: '  feat: add thing  ', want: true },
  { name: 'chore', title: 'chore: tidy up', want: false },
  { name: 'docs', title: 'docs: explain defaults', want: false },
  { name: 'refactor', title: 'refactor: restructure code base', want: false },
  { name: 'test', title: 'test: relax assertion', want: false },
  { name: 'ci', title: 'ci: speed up pipeline', want: false },
  { name: 'release', title: 'release: v0.2.0', want: false },
  { name: 'feat synonym', title: 'feature: add thing', want: false },
  { name: 'fix synonym', title: 'bugfix: correct crash', want: false },
  { name: 'uppercase type', title: 'Feat: add thing', want: false },
  { name: 'space before colon', title: 'feat : add thing', want: false },
  { name: 'missing colon', title: 'feat add thing', want: false },
  { name: 'type not at start', title: 'big feat: add thing', want: false },
  { name: 'empty title', title: '', want: false },
])('prNeedsChangeset: $name', ({ title, want }) => {
  expect(prNeedsChangeset(title)).toBe(want);
});

it.for([
  { name: 'release', title: 'release: v0.2.0', want: true },
  { name: 'release with scope', title: 'release(next): v0.2.0', want: true },
  { name: 'whitespace-padded', title: ' release: v0.2.0 ', want: true },
  { name: 'feat', title: 'feat: add thing', want: false },
  { name: 'fix', title: 'fix: correct crash', want: false },
  { name: 'released', title: 'released: v0.2.0', want: false },
  { name: 'missing colon', title: 'release v0.2.0', want: false },
  { name: 'uppercase type', title: 'Release: v0.2.0', want: false },
  { name: 'empty title', title: '', want: false },
])('prNeedsChangelogUpdate: $name', ({ title, want }) => {
  expect(prNeedsChangelogUpdate(title)).toBe(want);
});

it.for([
  { name: 'feat', title: 'feat: add thing', want: true },
  { name: 'fix scoped breaking', title: 'fix(config)!: rename option', want: true },
  { name: 'release', title: 'release: v0.2.0', want: true },
  { name: 'chore', title: 'chore: tidy up', want: false },
  { name: 'empty title', title: '', want: false },
])('prNeedsArtifact: $name', ({ title, want }) => {
  expect(prNeedsArtifact(title)).toBe(want);
});

it.for([
  { name: 'single fragment', paths: ['.changeset/funny-lions-jump.md'], want: true },
  {
    name: 'fragment among source files',
    paths: ['src/render.ts', '.changeset/funny-lions-jump.md', 'README.md'],
    want: true,
  },
  { name: 'multiple fragments', paths: ['.changeset/a.md', '.changeset/b.md'], want: true },
  { name: 'no fragment', paths: ['src/render.ts', 'README.md'], want: false },
  { name: 'empty list', paths: [], want: false },
  { name: 'changeset readme only', paths: ['.changeset/README.md'], want: false },
  { name: 'lowercase changeset readme', paths: ['.changeset/readme.md'], want: false },
  { name: 'changeset config only', paths: ['.changeset/config.json'], want: false },
  { name: 'fragment in nested folder', paths: ['.changeset/nested/x.md'], want: false },
  { name: 'changeset folder elsewhere', paths: ['sub/.changeset/x.md'], want: false },
  { name: 'wrong extension', paths: ['.changeset/x.mdx'], want: false },
  { name: 'uppercase extension', paths: ['.changeset/x.MD'], want: false },
])('hasChangesetFragment: $name', ({ paths, want }) => {
  expect(hasChangesetFragment(paths)).toBe(want);
});

it.for([
  { name: 'changelog changed', paths: ['CHANGELOG.md'], want: true },
  { name: 'changelog among files', paths: ['src/render.ts', 'CHANGELOG.md'], want: true },
  { name: 'nothing changed', paths: [], want: false },
  { name: 'lowercase name', paths: ['changelog.md'], want: false },
  { name: 'nested changelog', paths: ['docs/CHANGELOG.md'], want: false },
])('hasChangelogUpdate: $name', ({ paths, want }) => {
  expect(hasChangelogUpdate(paths)).toBe(want);
});

it.for([
  {
    name: 'feat with fragment',
    title: 'feat: add thing',
    paths: ['.changeset/funny-lions-jump.md'],
    outcome: { ok: true, note: "changeset: fragment found for 'feat: add thing'" },
  },
  {
    name: 'fix scoped with fragment',
    title: 'fix(map): correct trail',
    paths: ['src/render.ts', '.changeset/funny-lions-jump.md'],
    outcome: { ok: true, note: "changeset: fragment found for 'fix(map): correct trail'" },
  },
  {
    name: 'feat without fragment',
    title: 'feat: add thing',
    paths: ['src/render.ts'],
    outcome: {
      ok: false,
      error: "'feat: add thing' must add a .changeset/*.md fragment (see .changeset/README.md)",
    },
  },
  {
    name: 'readme is not a fragment',
    title: 'feat: add thing',
    paths: ['.changeset/readme.md'],
    outcome: {
      ok: false,
      error: "'feat: add thing' must add a .changeset/*.md fragment (see .changeset/README.md)",
    },
  },
  {
    name: 'release with changelog',
    title: 'release: v0.2.0',
    paths: ['CHANGELOG.md', 'package.json'],
    outcome: { ok: true, note: "changeset: CHANGELOG.md updated for 'release: v0.2.0'" },
  },
  {
    name: 'release without changelog',
    title: 'release: v0.2.0',
    paths: ['package.json', 'package-lock.json'],
    outcome: { ok: false, error: "'release: v0.2.0' must change CHANGELOG.md" },
  },
  {
    name: 'exempt title',
    title: 'chore: tidy up',
    paths: [],
    outcome: { ok: true, note: "changeset: 'chore: tidy up' requires no changelog artifact" },
  },
  {
    name: 'title is trimmed before reporting',
    title: '  feat: add thing  ',
    paths: ['.changeset/funny-lions-jump.md'],
    outcome: { ok: true, note: "changeset: fragment found for 'feat: add thing'" },
  },
])('evaluateGate: $name', ({ title, paths, outcome }) => {
  expect(evaluateGate(title, paths)).toEqual(outcome);
});
