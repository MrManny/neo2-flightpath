#!/usr/bin/env node
// Electron shell for the neo2-flightpath desktop app: window, native file
// dialog, the app:// scheme and process lifecycle only. All behavior lives in
// dist/ (compiled from src/), so the app and the CLI stay one code base.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';

import { resolveAppAsset } from '../dist/appassets.js';
import { APP_ORIGIN, uiExportRoot } from '../dist/apppaths.js';
import { createAppSession } from '../dist/appsession.js';
import { parseExportRequest } from '../dist/config.js';
import { resolveConfig } from '../dist/configfile.js';
import { ERROR_PREFIX, errorMessage } from '../dist/errors.js';
import { createExportRunner } from '../dist/exportjob.js';
import { requireTools } from '../dist/ff.js';
import { rangePlan } from '../dist/range.js';
import { outputPathFor } from '../dist/run.js';
import { createTileFetcher } from '../dist/tiles.js';

const SCHEME = 'app';
// --dev-url points the window at `next dev` (hot reload) instead of the
// built export; kept an argv flag so no cross-platform env helper is needed.
const devUrlIndex = process.argv.indexOf('--dev-url');
const DEV_URL = devUrlIndex >= 0 ? process.argv[devUrlIndex + 1] : null;
const DEV_MODE = DEV_URL !== null;
const log = (msg) => process.stderr.write(`[neo2-flightpath] ${msg}\n`);

// Must run before app ready so the scheme gets standard/secure semantics.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

// Resolved against this script's directory (works in a checkout and in
// app.asar); app.getAppPath() does not point at the repo root when Electron
// is started with a script path.
const exportRoot = uiExportRoot(import.meta.dirname);

// The one window's mutable state, created in startup() and handed to every
// stage as one object: the IPC handlers, the export runner callbacks and the
// window lifecycle handlers share it, so each writer (export completion, the
// close guard, window-all-closed) is a named handler instead of a nested
// closure over scattered module globals.
function createShellState() {
  return {
    win: null,
    session: null,
    config: null,
    tileFetcher: null,
    exportRunner: null,
    // The destination of the last successful export: the only path the
    // renderer may reveal or open.
    lastExportOut: null,
    closePromptOpen: false,
    pendingClose: false,
  };
}

async function pickRecording(state) {
  const options = {
    title: 'Choose a drone recording',
    filters: [{ name: 'DJI recordings', extensions: ['mp4'] }],
    properties: ['openFile'],
  };
  const result = state.win
    ? await dialog.showOpenDialog(state.win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0];
}

function fail(error) {
  const message = errorMessage(error);
  process.stderr.write(`${ERROR_PREFIX}${message}\n`);
  dialog.showErrorBox('Neo2 Flightpath', message);
  app.quit();
}

function sendToWindow(state, channel, payload) {
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send(channel, payload);
}

function handleExportDone(state, outcome) {
  if (outcome.status === 'ok') state.lastExportOut = outcome.summary.out;
  sendToWindow(state, 'neo2flightpath:export:done', outcome);
  if (state.pendingClose) {
    state.pendingClose = false;
    if (state.win && !state.win.isDestroyed()) state.win.close();
    else app.quit();
  }
}

function videoResponse(request, filePath) {
  const size = fs.statSync(filePath).size;
  const plan = rangePlan(request.headers.get('range') ?? undefined, size, 'video/mp4');
  if (plan.status === 416) {
    return new Response(plan.body, { status: 416, headers: plan.headers });
  }
  const stream =
    plan.status === 206
      ? fs.createReadStream(filePath, { start: plan.span.start, end: plan.span.end })
      : fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream), { status: plan.status, headers: plan.headers });
}

// net.fetch only sets request headers; wrapping the body gives the client
// the intended MIME and status.
async function fileResponse(filePath, mime, status = 200) {
  const fetched = await net.fetch(pathToFileURL(filePath).toString());
  return new Response(fetched.body, { status, headers: { 'Content-Type': mime } });
}

function notFound() {
  const fallback = path.join(exportRoot, '404.html');
  return fs.existsSync(fallback)
    ? fileResponse(fallback, 'text/html; charset=utf-8', 404)
    : new Response('not found', { status: 404 });
}

async function handleRequest(state, request) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const plan = resolveAppAsset(pathname, {
    exportRoot,
    tileCache: state.config.tileCache,
    videoPath: state.session ? state.session.videoPath() : null,
  });
  switch (plan.kind) {
    case 'video':
      return videoResponse(request, plan.filePath);
    case 'tile': {
      // Always through the fetcher: it serves cached tiles immediately,
      // retries tiles whose earlier download failed (so they recover once
      // connectivity returns) and falls back to the placeholder.
      const file = await state.tileFetcher.ensure(plan.style, plan.tile);
      return fileResponse(file, 'image/png');
    }
    case 'export':
      if (fs.existsSync(plan.filePath)) return fileResponse(plan.filePath, plan.mime);
      return notFound();
    case 'not-found':
      return notFound();
  }
}

// Only this app's window may drive the session state machine.
function assertTrusted(event) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  const devOk = DEV_URL !== null && url.startsWith(DEV_URL);
  if (!url.startsWith(APP_ORIGIN + '/') && !devOk) {
    throw new Error('untrusted ipc sender');
  }
}

function exportOutputOf(state, payload) {
  const out = payload && typeof payload === 'object' ? payload.out : null;
  if (typeof out !== 'string' || out !== state.lastExportOut) {
    throw new Error('unknown export output');
  }
  return out;
}

// The backing services behind the window: tool check, config, tile cache and
// the recording session.
async function initServices(state) {
  await requireTools();
  const resolved = resolveConfig({});
  state.config = resolved.config;
  state.tileFetcher = createTileFetcher(state.config.tileCache);
  state.session = createAppSession({
    config: state.config,
    pickFile: () => pickRecording(state),
    log,
    onPreparing: () => sendToWindow(state, 'neo2flightpath:preparing'),
    onPrepareProgress: (progress) =>
      sendToWindow(state, 'neo2flightpath:preparing:progress', progress),
  });
}

function initExportRunner(state) {
  state.exportRunner = createExportRunner({
    log: (msg) => {
      log(msg);
      sendToWindow(state, 'neo2flightpath:export:progress', msg);
    },
    onCapture: (progress) =>
      sendToWindow(state, 'neo2flightpath:export:capture', progress),
    onDone: (outcome) => handleExportDone(state, outcome),
  });
}

function registerIpcHandlers(state) {
  ipcMain.handle('neo2flightpath:pick', (event) => {
    assertTrusted(event);
    return state.session.pick();
  });
  ipcMain.handle('neo2flightpath:session', (event) => {
    assertTrusted(event);
    return state.session.getSession();
  });
  ipcMain.handle('neo2flightpath:settings', (event) => {
    assertTrusted(event);
    return state.config;
  });

  ipcMain.handle('neo2flightpath:export:pick-output', async (event) => {
    assertTrusted(event);
    const video = state.session ? state.session.videoPath() : null;
    if (!video) return { ok: false, error: 'no recording loaded' };
    // The CLI's default naming, with a relative out dir anchored at the
    // recording: the app process has no meaningful working directory.
    const outDir = state.config.outDir
      ? path.resolve(path.dirname(video), state.config.outDir)
      : null;
    const options = {
      title: 'Export flight map',
      defaultPath: outputPathFor(video, { ...state.config, outDir }),
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
    };
    const result = state.win
      ? await dialog.showSaveDialog(state.win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const chosen = result.filePath.toLowerCase().endsWith('.mp4')
      ? result.filePath
      : `${result.filePath}.mp4`;
    // The native dialog confirmed the name as typed, but `.mp4` may have been
    // appended after it: re-check the final path on every platform so an
    // existing file is never replaced without a confirmation.
    if (fs.existsSync(chosen)) {
      const box = {
        type: 'warning',
        buttons: ['Replace', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Replace ${path.basename(chosen)}?`,
        detail: chosen,
      };
      const confirm = state.win
        ? await dialog.showMessageBox(state.win, box)
        : await dialog.showMessageBox(box);
      if (confirm.response !== 0) return { ok: false, canceled: true };
    }
    return { ok: true, path: chosen };
  });
  ipcMain.handle('neo2flightpath:export:start', (event, raw) => {
    assertTrusted(event);
    try {
      const video = state.session ? state.session.videoPath() : null;
      if (!video) return { ok: false, error: 'no recording loaded' };
      state.exportRunner.start(video, parseExportRequest(raw, state.config));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  });
  ipcMain.handle('neo2flightpath:export:cancel', (event) => {
    assertTrusted(event);
    state.exportRunner.cancel();
    return { ok: true };
  });
  ipcMain.handle('neo2flightpath:export:reveal', (event, payload) => {
    assertTrusted(event);
    try {
      shell.showItemInFolder(exportOutputOf(state, payload));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  });
  ipcMain.handle('neo2flightpath:export:open', async (event, payload) => {
    assertTrusted(event);
    try {
      const error = await shell.openPath(exportOutputOf(state, payload));
      return error ? { ok: false, error } : { ok: true };
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  });
}

function installProtocolHandler(state) {
  protocol.handle(SCHEME, (request) =>
    handleRequest(state, request).catch((e) => {
      log(`scheme error: ${errorMessage(e)}`);
      return new Response('internal error', { status: 500 });
    }),
  );
}

function ensureUiExport() {
  if (!DEV_MODE && !fs.existsSync(path.join(exportRoot, 'index.html'))) {
    throw new Error('ui export missing; run "npm run build" first');
  }
}

function createWindow(state) {
  state.win = new BrowserWindow({
    width: 1600,
    height: 950,
    // The control bar needs ~1000px of min-content width; below this the
    // right-hand buttons would become unreachable.
    minWidth: 1024,
    minHeight: 600,
    // Match --page in ui/app/globals.css so startup shows one background.
    backgroundColor: '#0b1017',
    autoHideMenuBar: true,
    // The loaded page's <title> takes over after load (ui/app/layout.tsx).
    title: 'Neo2 Flightpath',
    // Windows renders an ICO best, Linux a PNG (Electron docs); both are
    // derived from build/icon-master.png (see build/README.md).
    icon:
      process.platform === 'win32'
        ? path.join(import.meta.dirname, '..', 'build', 'icon.ico')
        : path.join(import.meta.dirname, '..', 'build', 'icons', '256x256.png'),
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  state.win.on('closed', () => {
    state.win = null;
  });
}

// Closing the window must not silently kill a running export and strand
// minutes of work; the user chooses between stopping and keeping it.
function installCloseGuard(state) {
  state.win.on('close', (e) => {
    // A close already confirmed by the user, or with nothing running, passes.
    if (state.pendingClose || !state.exportRunner || !state.exportRunner.running()) return;
    if (state.closePromptOpen) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    state.closePromptOpen = true;
    const box = {
      type: 'warning',
      buttons: ['Stop Export and Close', 'Keep Exporting'],
      defaultId: 1,
      cancelId: 1,
      message: 'An export is in progress',
      detail: 'Closing the window stops the export and removes its working file.',
    };
    void (state.win ? dialog.showMessageBox(state.win, box) : dialog.showMessageBox(box)).then(
      ({ response }) => {
        state.closePromptOpen = false;
        if (response !== 0) return;
        // Cancellation settles asynchronously: the close completes from the
        // job's onDone, never from a synchronous running() check.
        state.pendingClose = true;
        state.exportRunner.cancel();
      },
    );
  });
}

async function loadUi(state) {
  await state.win.loadURL(DEV_MODE ? DEV_URL : `${APP_ORIGIN}/`);
}

// The window is the app: closing it quits. A still-running export delays the
// quit until its job has settled and cleaned up after itself.
function handleWindowAllClosed(state) {
  if (state.exportRunner && state.exportRunner.running()) {
    state.pendingClose = true;
    state.exportRunner.cancel();
    return;
  }
  app.quit();
}

async function startup() {
  const state = createShellState();
  app.on('window-all-closed', () => handleWindowAllClosed(state));
  try {
    await initServices(state);
    initExportRunner(state);
    registerIpcHandlers(state);
    installProtocolHandler(state);
    ensureUiExport();
    createWindow(state);
    installCloseGuard(state);
    await loadUi(state);
  } catch (e) {
    fail(e);
  }
}

app.whenReady().then(startup);
