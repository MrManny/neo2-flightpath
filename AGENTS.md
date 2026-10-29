# AGENTS.md

Development instructions; [README.md](README.md) is the user manual.

## Setup & commands

- Node.js 24 or 26, npm. Use `npm ci` to install dependencies.
- `npm run build` compiles the CLI (`dist/`) and builds the UI export
  (`ui/out/`); `npm run app` starts the Electron desktop app against it
  (packaging uses `electron-builder`).
- `npm run app:dev` runs the UI with hot reload (`next dev`) inside Electron.
  The UI builds with webpack (`--webpack`): Turbopack cannot resolve the
  shared renderer's NodeNext `.js` specifiers.
- When adding a new dependency, pin it to a patch-level range (i.e. `~1.2.3`);
  new dependencies **must not** have high or critical security issues on
  Snyk. Check `https://security.snyk.io/package/npm/<package_name>`.
- Unit tests need nothing beyond Node — no ffmpeg, browser or network. Real
  render runs need ffmpeg + ffprobe on PATH and Chrome/Edge.

## Testing

- One `test/<module>.test.ts` per source module; fixtures in `test/fixtures.ts`
  (`tmpDir()` + `afterEach(cleanupTmpDirs)`).
- Deterministic and offline: no network, tile downloads, ffmpeg/ffprobe or
  browser.
- New behaviors need suitable testing: sunny case, as well as common rainy cases.
- Use parameterized tests with `describe.for`/`describe.each` for "bulk" testing.
- Behavior changes ship with tests (a bug fix gets a regression test).
  Never commit `.only`, `.skip` or `.todo`.

## Conventions

- Use American English language, not British English. Nothing against the Brits though;
  would love to see you come back into the European Union.
- TypeScript strict, ESM, NodeNext: relative imports carry `.js`, built-ins use
  `node:`, types via `import type`.
- camelCase / PascalCase / UPPER_SNAKE_CASE; one concern per file;
  comments say *why*, not *what*. Do not add any comments where it contributes
  no value beyond what's clearly visible whatsoever.
- Progress/errors → stderr; `--json` output → stdout.
- Errors: throw plain `Error` with a lowercase message; when catching and
  rethrowing, wrap the original with `{ cause }` instead of dropping it.
- Top-level failures report `[neo2-flightpath] ERROR: <message>` on stderr and
  set `process.exitCode` — never call `process.exit()` mid-flow.

## Design principles

- One job per function; long flows as compose-method stages.
- Pure core, imperative shell: parsing, geometry, planning and config merging
  are pure; I/O lives in dedicated modules.
- `src/config.ts` owns the option vocabulary; one home per concern.
- Outputs must be deterministic and idempotent.

## Definition of done

- `npm run lint`, `npm test`, `npm run build` green (CI adds
  `npm pack --dry-run` on Node 24 + 26).
- Behavior changes ship with tests; docs updated (README: user-visible, here:
  commands and standards).
- PRs titled `feat:`/`fix:` add a `.changeset/*.md` fragment, `release:` PRs
  change `CHANGELOG.md` (CI enforces this); releases fold the fragments into
  `CHANGELOG.md` (see `.changeset/README.md`).

## GitHub interactions

Issues, branches, commits, PRs and releases follow
[`.agents/skills/github-etiquette/`](.agents/skills/github-etiquette/SKILL.md).
