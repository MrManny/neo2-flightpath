// The app's session server: landing page, native-dialog pick, the interactive
// renderer page and video streaming. The Electron shell supplies the dialog
// and the window; everything else lives here so it stays testable and free of
// Electron APIs.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { errorMessage } from './errors.js';
import type { RenderConfig } from './config.js';
import { buildPageHtml, pickFlowScript } from './page.js';
import { prepareSession, recordingPageOpts } from './run.js';
import type { LogFn } from './run.js';
import { MIME, serveAsset, serveFileWithRange } from './serve.js';

export interface UiSession {
  pageHtml: string;
  videoPath: string;
}

export type PrepareUiRecording = (
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
) => Promise<UiSession>;

// The shared pipeline stages plus the interactive variant of the shared
// renderer page.
export const prepareUiRecording: PrepareUiRecording = async (
  videoPath,
  config,
  log,
) => {
  const prep = await prepareSession(videoPath, config, log);
  return {
    pageHtml: buildPageHtml({
      ...recordingPageOpts(prep, config),
      video: {
        src: '/video',
        fpsValue: prep.probe.fps.value,
        frames: prep.probe.frames,
      },
    }),
    videoPath,
  };
};

export interface UiServerOptions {
  config: RenderConfig;
  /** Opens the native file dialog; resolves null when the user cancels. */
  pickFile: () => Promise<string | null>;
  prepare?: PrepareUiRecording;
  log?: (msg: string) => void;
}

export interface UiServerHandle {
  server: http.Server;
  url: string;
  close(): Promise<void>;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function isReadableVideo(filePath: string): boolean {
  if (!filePath.toLowerCase().endsWith('.mp4')) return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function landingHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>neo2-flightpath</title>
<style>
  html, body { margin: 0; height: 100%; background: #0e131c; color: #ffffff;
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 560px; margin: 0 auto; padding: 12vh 24px 0; box-sizing: border-box; }
  h1 { font-size: 28px; font-weight: 650; margin: 0 0 12px; }
  p { line-height: 1.55; color: rgba(255,255,255,0.82); }
  button {
    font-size: 16px; padding: 12px 22px; border-radius: 10px; cursor: pointer;
    color: #071018; background: #41f0ff; border: none; font-weight: 600;
  }
  button:disabled { opacity: 0.55; cursor: default; }
  #status { min-height: 1.55em; color: #ffd166; }
  .hint { font-size: 13px; color: rgba(255,255,255,0.55); }
</style>
</head>
<body>
<main>
  <h1>neo2-flightpath</h1>
  <p>Pick a drone recording to watch its flight path on the map in sync with
     the footage.</p>
  <button id="btn-pick">Open recording&hellip;</button>
  <p id="status"></p>
  <p class="hint">Requires ffmpeg/ffprobe on PATH. An .SRT sidecar next to the
     video is picked up automatically.</p>
</main>
<script>
${pickFlowScript('btn-pick', 'status')}
</script>
</body>
</html>`;
}

export async function startUiServer(
  options: UiServerOptions,
): Promise<UiServerHandle> {
  const { config, pickFile } = options;
  const prepare = options.prepare ?? prepareUiRecording;
  const log = options.log ?? ((): void => {});
  const streams = new Set<Promise<void>>();
  let session: UiSession | null = null;
  let port = 0;
  let picking = false;

  async function handlePick(res: http.ServerResponse): Promise<void> {
    if (picking) {
      json(res, 409, { ok: false, error: 'a pick is already in progress' });
      return;
    }
    picking = true;
    try {
      const picked = await pickFile();
      if (picked === null) {
        json(res, 200, { ok: false, canceled: true });
        return;
      }
      const videoPath = path.resolve(picked);
      if (!isReadableVideo(videoPath)) {
        log(`rejected: ${videoPath}`);
        json(res, 400, { ok: false, error: `not a readable .mp4 file: ${videoPath}` });
        return;
      }
      session = await prepare(videoPath, config, log);
      log(`loaded: ${videoPath}`);
      json(res, 200, { ok: true });
    } catch (e) {
      log(`error: ${errorMessage(e)}`);
      json(res, 500, { ok: false, error: errorMessage(e) });
    } finally {
      picking = false;
    }
  }

  const server = http.createServer((req, res) => {
    let url: string;
    try {
      url = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad request');
      return;
    }

    // Any web page the user has open can reach 127.0.0.1: only same-origin
    // requests may drive this server (the Host check also defeats DNS
    // rebinding).
    const host = req.headers['host'];
    const origin = req.headers['origin'];
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    const hostOk = host !== undefined && allowedHosts.includes(host);
    const originOk =
      origin === undefined || allowedHosts.some((h) => origin === `http://${h}`);
    if (!hostOk || !originOk) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('forbidden');
      return;
    }

    if (url === '/api/pick') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'POST' });
        res.end('method not allowed');
        return;
      }
      void handlePick(res);
      return;
    }
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(session ? session.pageHtml : landingHtml());
      return;
    }
    if (url === '/video') {
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('no recording loaded');
        return;
      }
      const done = serveFileWithRange(req, res, session.videoPath).finally(() =>
        streams.delete(done),
      );
      streams.add(done);
      return;
    }
    if (serveAsset(url, res, { style: config.style, tileCache: config.tileCache })) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  port = addr && typeof addr === 'object' ? addr.port : 0;
  return {
    server,
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      await Promise.allSettled([...streams]);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
