# AGENTS.md

Development instructions; [README.md](README.md) is the user manual.

## Setup & commands

- Node.js **>= 24**, npm (lockfile is committed). `npm ci` installs and builds.
- `npm run lint` · `npm test` · `npm run build` (`src/` → `dist/`, gitignored)
- One test: `npx vitest run test/srt.test.ts`, or `npx vitest run -t "<name>"`.
- Smoke test: `node bin/neo2-flightpath.mjs --help` (after a build).
- Unit tests need nothing beyond Node — no ffmpeg, browser or network. Real
  render runs need ffmpeg + ffprobe on PATH and Chrome/Edge.

## Testing

- One `test/<module>.test.ts` per source module; fixtures in `test/fixtures.ts`
  (`tmpDir()` + `afterEach(cleanupTmpDirs)`).
- Deterministic and offline: no network, tile downloads, ffmpeg/ffprobe or
  browser. If that is hard, extract a pure seam instead of an integration test.
- Behavior changes ship with tests (a bug fix gets a regression test). Never
  commit `.only`, `.skip` or `.todo`.

## Conventions

- TypeScript strict, ESM, NodeNext: relative imports carry `.js`, built-ins use
  `node:`, types via `import type`.
- camelCase / PascalCase / UPPER_SNAKE_CASE; one concern per file; header
  comment `// <file>.ts - <concern>.`; comments say *why*, not *what*.
- Style: 2-space indent, single quotes, semicolons, trailing commas, ~88
  columns. No formatter — match by hand; lint must pass; unused names get `_`.
- Errors: plain `Error`, short lowercase actionable message, wrapped with
  `{ cause }` across boundaries; fail fast before rendering starts. Only
  `main()` in `src/cli.ts` maps errors to `ERROR: …` + `process.exitCode = 1` —
  never `process.exit()`.
- Progress/errors → stderr; `--json` output → stdout.

## Design principles (rough)

- One job per function; long flows as compose-method stages.
- Pure core, imperative shell: parsing, geometry, planning and config merging
  are pure; I/O lives in dedicated modules.
- `src/config.ts` owns the option vocabulary; one home per concern.
- Preserve the source exactly: frame count and frame rate in means the same out
  — verify, don't assume. Outputs are deterministic.

## Definition of done

- `npm run lint`, `npm test`, `npm run build` green (CI adds
  `npm pack --dry-run` on Node 24 + 26).
- Behavior changes ship with tests; docs updated (README: user-visible, here:
  commands and standards).

## GitHub interactions

Issues, branches, commits, PRs and releases follow
[`.agents/skills/github-etiquette/`](.agents/skills/github-etiquette/SKILL.md).

## Manual repository setup (cannot be committed)

- Protect `main`: require CI (lint + test + build on Node 24 + 26).
- Labels for the issue templates: `bug`, `enhancement`, `documentation`.
