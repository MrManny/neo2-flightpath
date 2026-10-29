#!/usr/bin/env node
// Electron shell for the neo2-flightpath desktop app: window, native file
// dialog, the app:// scheme and process lifecycle only. All behavior lives in
// dist/ (compiled from src/), so the app and the CLI stay one code base.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron';

import { resolveAppAsset } from '../dist/appassets.js';
import { APP_ORIGIN, uiExportRoot } from '../dist/apppaths.js';
import { createAppSession } from '../dist/appsession.js';
import { resolveConfig } from '../dist/configfile.js';
import { ERROR_PREFIX, errorMessage } from '../dist/errors.js';
import { requireTools } from '../dist/ff.js';
import { parseRange } from '../dist/range.js';
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
    session = createAppSession({ config, pickFile: pickRecording, log });

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
    win.on('closed', () => {
      win = null;
    });
    await win.loadURL(devMode ? DEV_URL : `${APP_ORIGIN}/`);
  } catch (e) {
    fail(e);
  }
});

// The window is the app: closing it quits.
app.on('window-all-closed', () => app.quit());
