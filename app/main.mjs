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
import { parseRange } from '../dist/range.js';
import { outputPathFor } from '../dist/run.js';
import { createTileFetcher } from '../dist/tiles.js';

const SCHEME = 'app';
// --dev-url points the window at `next dev` (hot reload) instead of the
// built export; kept an argv flag so no cross-platform env helper is needed.
const devUrlIndex = process.argv.indexOf('--dev-url');
const DEV_URL = devUrlIndex >= 0 ? process.argv[devUrlIndex + 1] : null;
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

let win = null;
let session = null;
let config = null;
let tileFetcher = null;
let exportRunner = null;
// The destination of the last successful export: the only path the renderer
// may reveal or open.
let lastExportOut = null;
let closePromptOpen = false;
let pendingClose = false;

async function pickRecording() {
  const options = {
    title: 'Choose a drone recording',
    filters: [{ name: 'DJI recordings', extensions: ['mp4'] }],
    properties: ['openFile'],
  };
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0];
}

function fail(error) {
  const message = errorMessage(error);
  process.stderr.write(`${ERROR_PREFIX}${message}\n`);
  dialog.showErrorBox('neo2-flightpath', message);
  app.quit();
}

function sendToWindow(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function videoResponse(request, filePath) {
  const size = fs.statSync(filePath).size;
  const range = parseRange(request.headers.get('range') ?? undefined, size);
  if (range === 'unsatisfiable') {
    return new Response('range not satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}`, 'Content-Type': 'text/plain' },
    });
  }
  const start = range === null ? 0 : range.start;
  const end = range === null ? size - 1 : range.end;
  const stream = fs.createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream), {
    status: range === null ? 200 : 206,
    headers: {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      ...(range === null ? {} : { 'Content-Range': `bytes ${start}-${end}/${size}` }),
    },
  });
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

async function handleRequest(request) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const plan = resolveAppAsset(pathname, {
    exportRoot,
    tileCache: config.tileCache,
    videoPath: session ? session.videoPath() : null,
  });
  switch (plan.kind) {
    case 'video':
      return videoResponse(request, plan.filePath);
    case 'tile': {
      // Always through the fetcher: it serves cached tiles immediately,
      // retries tiles whose earlier download failed (so they recover once
      // connectivity returns) and falls back to the placeholder.
      const file = await tileFetcher.ensure(plan.style, plan.tile);
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

app.whenReady().then(async () => {
  try {
    await requireTools();
    const resolved = resolveConfig({});
    config = resolved.config;
    tileFetcher = createTileFetcher(config.tileCache);
    session = createAppSession({
      config,
      pickFile: pickRecording,
      log,
      onPreparing: () => sendToWindow('neo2flightpath:preparing'),
    });

    exportRunner = createExportRunner({
      log: (msg) => {
        log(msg);
        sendToWindow('neo2flightpath:export:progress', msg);
      },
      onDone: (outcome) => {
        if (outcome.status === 'ok') lastExportOut = outcome.summary.out;
        sendToWindow('neo2flightpath:export:done', outcome);
        if (pendingClose) {
          pendingClose = false;
          if (win && !win.isDestroyed()) win.close();
          else app.quit();
        }
      },
    });

    ipcMain.handle('neo2flightpath:pick', (event) => {
      assertTrusted(event);
      return session.pick();
    });
    ipcMain.handle('neo2flightpath:session', (event) => {
      assertTrusted(event);
      return session.getSession();
    });
    ipcMain.handle('neo2flightpath:settings', (event) => {
      assertTrusted(event);
      return config;
    });

    ipcMain.handle('neo2flightpath:export:pick-output', async (event) => {
      assertTrusted(event);
      const video = session ? session.videoPath() : null;
      if (!video) return { ok: false, error: 'no recording loaded' };
      // The CLI's default naming, with a relative out dir anchored at the
      // recording: the app process has no meaningful working directory.
      const outDir = config.outDir
        ? path.resolve(path.dirname(video), config.outDir)
        : null;
      const options = {
        title: 'Export flight map',
        defaultPath: outputPathFor(video, { ...config, outDir }),
        filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
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
        const confirm = win
          ? await dialog.showMessageBox(win, box)
          : await dialog.showMessageBox(box);
        if (confirm.response !== 0) return { ok: false, canceled: true };
      }
      return { ok: true, path: chosen };
    });
    ipcMain.handle('neo2flightpath:export:start', (event, raw) => {
      assertTrusted(event);
      try {
        const video = session ? session.videoPath() : null;
        if (!video) return { ok: false, error: 'no recording loaded' };
        exportRunner.start(video, parseExportRequest(raw, config));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    });
    ipcMain.handle('neo2flightpath:export:cancel', (event) => {
      assertTrusted(event);
      exportRunner.cancel();
      return { ok: true };
    });

    function exportOutputOf(payload) {
      const out = payload && typeof payload === 'object' ? payload.out : null;
      if (typeof out !== 'string' || out !== lastExportOut) {
        throw new Error('unknown export output');
      }
      return out;
    }
    ipcMain.handle('neo2flightpath:export:reveal', (event, payload) => {
      assertTrusted(event);
      try {
        shell.showItemInFolder(exportOutputOf(payload));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    });
    ipcMain.handle('neo2flightpath:export:open', async (event, payload) => {
      assertTrusted(event);
      try {
        const error = await shell.openPath(exportOutputOf(payload));
        return error ? { ok: false, error } : { ok: true };
      } catch (e) {
        return { ok: false, error: errorMessage(e) };
      }
    });
    protocol.handle(SCHEME, (request) =>
      handleRequest(request).catch((e) => {
        log(`scheme error: ${errorMessage(e)}`);
        return new Response('internal error', { status: 500 });
      }),
    );

    const devMode = DEV_URL !== null;
    if (!devMode && !fs.existsSync(path.join(exportRoot, 'index.html'))) {
      throw new Error('ui export missing; run "npm run build" first');
    }

    win = new BrowserWindow({
      width: 1600,
      height: 950,
      // The control bar needs ~1000px of min-content width; below this the
      // right-hand buttons would become unreachable.
      minWidth: 1024,
      minHeight: 600,
      backgroundColor: '#0e131c',
      autoHideMenuBar: true,
      title: 'neo2-flightpath',
      webPreferences: {
        preload: path.join(import.meta.dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    // Closing the window must not silently kill a running export and strand
    // minutes of work; the user chooses between stopping and keeping it.
    win.on('close', (e) => {
      // A close already confirmed by the user, or with nothing running, passes.
      if (pendingClose || !exportRunner || !exportRunner.running()) return;
      if (closePromptOpen) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      closePromptOpen = true;
      const box = {
        type: 'warning',
        buttons: ['Stop Export and Close', 'Keep Exporting'],
        defaultId: 1,
        cancelId: 1,
        message: 'An export is in progress',
        detail: 'Closing the window stops the export and removes its working file.',
      };
      void (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box)).then(
        ({ response }) => {
          closePromptOpen = false;
          if (response !== 0) return;
          // Cancellation settles asynchronously: the close completes from the
          // job's onDone, never from a synchronous running() check.
          pendingClose = true;
          exportRunner.cancel();
        },
      );
    });
    win.on('closed', () => {
      win = null;
    });
    await win.loadURL(devMode ? DEV_URL : `${APP_ORIGIN}/`);
  } catch (e) {
    fail(e);
  }
});

// The window is the app: closing it quits. A still-running export delays the
// quit until its job has settled and cleaned up after itself.
app.on('window-all-closed', () => {
  if (exportRunner && exportRunner.running()) {
    pendingClose = true;
    exportRunner.cancel();
    return;
  }
  app.quit();
});
