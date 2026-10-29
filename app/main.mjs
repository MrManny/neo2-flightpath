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
import { createAppSession } from '../dist/appsession.js';
import { resolveConfig } from '../dist/config.js';
import { ERROR_PREFIX, errorMessage } from '../dist/errors.js';
import { requireTools } from '../dist/ff.js';
import { parseRange } from '../dist/range.js';

const SCHEME = 'app';
const ORIGIN = 'app://bundle';
const DEV_URL = process.env.NEO2_UI_DEV_URL || 'http://localhost:3210';
const log = (msg) => process.stderr.write(`[neo2-flightpath] ${msg}\n`);

// Must run before app ready so the scheme gets standard/secure semantics.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const exportRoot = path.join(app.getAppPath(), 'ui', 'out');

let win = null;
let session = null;
let config = null;

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

function fileResponse(filePath, mime) {
  return net.fetch(pathToFileURL(filePath).toString(), {
    headers: { 'Content-Type': mime },
  });
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
    style: config.style,
    videoPath: session ? session.videoPath() : null,
  });
  switch (plan.kind) {
    case 'video':
      return videoResponse(request, plan.filePath);
    case 'tile': {
      const file = fs.existsSync(plan.filePath)
        ? plan.filePath
        : fs.existsSync(plan.placeholderPath)
          ? plan.placeholderPath
          : null;
      return file
        ? fileResponse(file, 'image/png')
        : new Response('not found', { status: 404 });
    }
    case 'export': {
      if (fs.existsSync(plan.filePath)) return fileResponse(plan.filePath, plan.mime);
      const fallback = path.join(exportRoot, '404.html');
      return fs.existsSync(fallback)
        ? new Response(await fileResponse(fallback, 'text/html; charset=utf-8'), {
            status: 404,
          })
        : new Response('not found', { status: 404 });
    }
    case 'not-found': {
      const fallback = path.join(exportRoot, '404.html');
      return fs.existsSync(fallback)
        ? new Response(await fileResponse(fallback, 'text/html; charset=utf-8'), {
            status: 404,
          })
        : new Response('not found', { status: 404 });
    }
  }
}

// Only this app's window may drive the session state machine.
function assertTrusted(event) {
  const url = (event.senderFrame && event.senderFrame.url) || '';
  if (!url.startsWith(ORIGIN + '/') && !url.startsWith(DEV_URL)) {
    throw new Error('untrusted ipc sender');
  }
}

app.whenReady().then(async () => {
  try {
    await requireTools();
    const resolved = resolveConfig({});
    config = resolved.config;
    session = createAppSession({ config, pickFile: pickRecording, log });

    ipcMain.handle('neo2flightpath:pick', (event) => {
      assertTrusted(event);
      return session.pick();
    });
    ipcMain.handle('neo2flightpath:session', (event) => {
      assertTrusted(event);
      return session.getSession();
    });
    protocol.handle(SCHEME, (request) =>
      handleRequest(request).catch((e) => {
        log(`scheme error: ${errorMessage(e)}`);
        return new Response('internal error', { status: 500 });
      }),
    );

    const devMode = Boolean(process.env.NEO2_UI_DEV_URL);
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
        preload: path.join(import.meta.dirname, 'preload.mjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    win.on('closed', () => {
      win = null;
    });
    await win.loadURL(devMode ? DEV_URL : `${ORIGIN}/`);
  } catch (e) {
    fail(e);
  }
});

// The window is the app: closing it quits.
app.on('window-all-closed', () => app.quit());
