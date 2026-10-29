#!/usr/bin/env node
// Electron shell for the neo2-flightpath desktop app: window, native file
// dialog and process lifecycle only. All behavior lives in dist/ (compiled
// from src/), so the app and the CLI stay one code base.

import process from 'node:process';

import { app, BrowserWindow, dialog } from 'electron';

import { resolveConfig } from '../dist/config.js';
import { ERROR_PREFIX, errorMessage } from '../dist/errors.js';
import { requireTools } from '../dist/ff.js';
import { startUiServer } from '../dist/uiserver.js';

const log = (msg) => process.stderr.write(`[neo2-flightpath] ${msg}\n`);

let win = null;
let server = null;

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

app.whenReady().then(async () => {
  try {
    await requireTools();
    const { config } = resolveConfig({});
    server = await startUiServer({ config, pickFile: pickRecording, log });
    win = new BrowserWindow({
      width: 1600,
      height: 950,
      backgroundColor: '#0e131c',
      autoHideMenuBar: true,
      title: 'neo2-flightpath',
    });
    win.on('closed', () => {
      win = null;
    });
    await win.loadURL(server.url);
  } catch (e) {
    fail(e);
  }
});

// The window is the app: closing it quits (and takes the session server
// with the process).
app.on('window-all-closed', () => app.quit());
