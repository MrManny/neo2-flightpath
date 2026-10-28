import { expect, it } from 'vitest';

import { hasChangesetFragment, prNeedsChangeset } from '../src/changeset-gate.js';

it.for([
  { name: 'feat', title: 'feat: add thing', want: true },
  { name: 'fix', title: 'fix: correct crash', want: true },
  { name: 'feat with scope', title: 'feat(otel): add tracing', want: true },
  { name: 'fix with scope', title: 'fix(srt): handle blank lines', want: true },
  { name: 'feat breaking', title: 'feat!: drop legacy flag', want: true },
  { name: 'fix scoped breaking', title: 'fix(config)!: rename option', want: true },
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
  { name: 'changeset config only', paths: ['.changeset/config.json'], want: false },
  { name: 'fragment in nested folder', paths: ['.changeset/nested/x.md'], want: false },
  { name: 'changeset folder elsewhere', paths: ['sub/.changeset/x.md'], want: false },
  { name: 'wrong extension', paths: ['.changeset/x.mdx'], want: false },
  { name: 'uppercase extension', paths: ['.changeset/x.MD'], want: false },
])('hasChangesetFragment: $name', ({ paths, want }) => {
  expect(hasChangesetFragment(paths)).toBe(want);
});
