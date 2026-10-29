# Automating the Electron App

Research notes on how an agent session can launch and operate the
neo2-flightpath Electron desktop app programmatically, e.g. to verify UI work
during automated implementation sessions. Snapshot of the repo state at the
time of writing; re-check `package.json` and `app/main.mjs` before relying on
exact flags later.

## How the app launches

- **Production mode:** `npm run build` (compiles `src/` to `dist/` and builds
  the Next.js static export to `ui/out/`), then `npm run app`, which runs
  `electron app/main.mjs`. `npm ci` already runs `build` via the `prepare`
  script, so a freshly installed checkout is launchable as-is.
- **Dev mode:** `npm run app:dev` starts `next dev ui --webpack -p 3210` and
  launches Electron with `--dev-url http://localhost:3210` once the server
  responds. The `--webpack` flag is mandatory: Turbopack cannot resolve the
  renderer's NodeNext `.js` specifiers.
- The shell (`app/main.mjs`) is thin: one window, a privileged `app://bundle`
  scheme serving `ui/out` plus media and tiles, and three IPC handlers
  (`neo2flightpath:pick`, `neo2flightpath:session`, `neo2flightpath:settings`)
  bridged through `app/preload.cjs` as `window.neo2flightpath`. All session
  logic lives in the Electron-free state machine `src/appsession.ts`
  (`pick -> validate -> prepare`).
- Startup hard requirements: **ffmpeg and ffprobe on PATH**. `requireTools()`
  fails startup otherwise (a native error box appears and the app quits).

## Recommended: drive it with Playwright's Electron launcher

`playwright-core` is already a runtime dependency (used headless for rendering
in `src/render.ts`) and exports the `_electron` launcher
(`node_modules/playwright-core/types/types.d.ts`). Automated operation
therefore needs **zero new dependencies**:

```js
import { _electron } from 'playwright-core';

const app = await _electron.launch({
  executablePath: 'node_modules/electron/dist/electron.exe', // explicit is safest on Windows
  args: ['app/main.mjs'], // add '--dev-url', 'http://localhost:3210' for dev mode
  cwd: 'E:/DJI_001/scripts/neo2-flightpath',
  // Harness shells may export ELECTRON_RUN_AS_NODE; see the notes below.
  env: Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'),
  ),
});

// Stub the native file dialog BEFORE the UI picks a file (see below).
await app.evaluate(({ dialog }) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['D:/sample.mp4'] });
});

const page = await app.firstWindow();
await page.waitForLoadState('networkidle');
await page.screenshot({ path: 'shot.png' }); // visual verification
await page.locator('...').click(); // operate the UI like a normal page
page.on('console', (m) => console.log('renderer:', m.text()));
const session = await page.evaluate(() => window.neo2flightpath.getSession());
await app.close(); // window-all-closed quits the app
```

This covers what an implementation session needs: launch, click and type in the
UI, read app state through the preload bridge (`getSession()`), capture
screenshots for visual checks, and collect renderer console output.
`app.evaluate()` also reaches the main process directly (for example
`BrowserWindow.getAllWindows()[0].webContents.capturePage()` for a window-level
screenshot).

## The one real obstacle: the native file dialog

`pickRecording()` opens a native `dialog.showOpenDialog` (`app/main.mjs`),
which Playwright cannot automate (its `page.on('dialog')` handles only JS
dialogs). Two solutions:

1. **Monkey-patch, no code change:** patch `dialog.showOpenDialog` via
   `app.evaluate` to return a fixed path, as shown above. This works because
   `app/main.mjs` holds a reference to the shared `dialog` object and resolves
   the method at call time.
2. **Cleaner long-term (small future change):** add a flag such as
   `--open <path>` (or an environment variable) to `app/main.mjs` so `pickFile`
   skips the dialog when a path is supplied. Ideal for CI-style smoke tests.

## Fallback: raw CDP

If the app is already running (or the Playwright Electron driver misbehaves),
launch with `electron app/main.mjs --remote-debugging-port=9223` and attach
with `chromium.connectOverCDP('http://127.0.0.1:9223')` from the same
`playwright-core`. Same page-driving capabilities, slightly less convenient
for main-process access. The IPC trust check accepts both `app://bundle/...`
frames and the dev URL, so the preload bridge works in either mode.

## Operational notes

- **Logs:** the app writes `[neo2-flightpath] <msg>` progress and
  `[neo2-flightpath] ERROR: <message>` to stderr; a driver script or captured
  background-job output can parse these for `loaded:` confirmations.
  `ELECTRON_ENABLE_LOGGING=1` adds Chromium-level logs.
- **Quit/kill:** closing the window quits the app
  (`window-all-closed -> app.quit()`). When launched via `npm run app`, kill
  the process tree (`taskkill /PID <pid> /T /F` or `Stop-Process -Name
  electron`); a killed `npm`/`pwsh` wrapper can orphan `electron.exe`.
- **Dev vs. prod:** dev mode (`--dev-url`) is best while iterating (hot
  reload); production mode (`ui/out`) is deterministic and is what users run.
- **Prerequisite check before launch:** `where.exe ffmpeg` and
  `where.exe ffprobe`; without both the app dies at startup behind a native
  error box.

## Notes for automated sessions under the DSH harness

- Spawning Electron with piped stdio from a Node driver can hit the documented
  EPERM-on-piped-stdio restriction in confined sandbox modes. Run the driver
  under at least workspace-write (FullLanguage on Windows) or as a background
  job.
- **`ELECTRON_RUN_AS_NODE` trap:** harness shells and some IDE terminals
  export `ELECTRON_RUN_AS_NODE=1`. Every spawned `electron.exe` then behaves
  like plain Node: `app/main.mjs` dies with `SyntaxError: The requested module
  'electron' does not provide an export named 'BrowserWindow'` (or the
  equivalent for `app`), and `_electron.launch` reports `Process failed to
  launch!`. Clear the variable in the driving shell *and* pass an `env`
  without it to `_electron.launch` (children inherit it otherwise).
- **Driver script location:** keep the driver inside the repo (the gitignored
  `out/` is a good spot). `import 'playwright-core'` resolves through the
  repo's `node_modules`; a script in the OS temp directory fails with
  `ERR_MODULE_NOT_FOUND`.
- **PowerShell exit codes:** the app logs progress to stderr. Piping a driver
  through `2>&1` in a PowerShell background job can make a successful run
  report `[exit code: 1]`; trust the driver's own output and exit status.
- Expect a **visible window** on the desktop: Electron has no true headless
  mode on Windows, which is convenient for supervision.
- CDP and Playwright traffic is plain TCP loopback and unaffected by the
  named-pipe restriction.
- There is currently no e2e harness in `test/` (unit tests are vitest-only and
  offline per `AGENTS.md`); a Playwright driver is a separate, non-unit
  concern.

## Bottom line

Launching is `npm run app` (or `_electron.launch`), operating is normal
Playwright page automation plus the `window.neo2flightpath` bridge, and the
only friction point, the native file picker, is solvable today with a
`dialog.showOpenDialog` stub via `app.evaluate`, and cleanly later with a tiny
`--open <path>` flag.
