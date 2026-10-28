// render.ts - local tile server + Playwright frame capture + ffmpeg encoding.
// Frames are captured by N parallel pages and streamed to ffmpeg's stdin in
// exact frame order (no scratch frame files on disk). The headless browser is
// the system Chrome/Edge via playwright-core - no browser download.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { Writable } from 'node:stream';

import type { Browser } from 'playwright-core';

import { TILE_SOURCES } from './tiles.js';
import type { Capture, Preset, Style } from './config.js';
import { NOOP_TRACER, withSpan } from './tracing.js';
import type { Span, Tracer } from './tracing.js';

const require_ = createRequire(import.meta.url);
const LEAFLET_DIR = path.dirname(require_.resolve('leaflet/dist/leaflet.js'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

const PAGE_LOAD_TIMEOUT_MS = 60000;
const SCREENSHOT_TIMEOUT_MS = 60000;

export interface ServerHandle {
  server: http.Server;
  url: string;
}

// Serve the map page, Leaflet assets and cached tiles on 127.0.0.1.
export function startServer({
  html,
  style,
  tileCache,
}: {
  html: string;
  style: Style;
  tileCache: string;
}): Promise<ServerHandle> {
  const server = http.createServer((req, res) => {
    // A malformed request URL (e.g. "GET /%") must not crash the render:
    // decodeURIComponent throws URIError, which would surface as an
    // uncaughtException inside this handler.
    let url: string;
    try {
      url = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad request');
      return;
    }
    let file: string | null = null;
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(html);
      return;
    }
    if (url.startsWith('/leaflet/')) {
      const rel = url.slice('/leaflet/'.length);
      if (/^(leaflet\.(js|css|js\.map|css\.map)|images\/[a-z0-9_-]+\.png)$/.test(rel)) {
        file = path.join(LEAFLET_DIR, rel);
      }
    } else if (url.startsWith('/tiles/')) {
      const m = /^\/tiles\/([a-z0-9_-]+)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url);
      const src = m ? TILE_SOURCES[m[1] as Style] : null;
      if (m && src && m[1] === style) {
        const key = src.cacheKey || m[1];
        file = path.join(tileCache, key, m[2], m[3], `${m[4]}.png`);
        if (!fs.existsSync(file)) {
          const alt = path.join(tileCache, key, m[2], m[3], `${m[4]}.placeholder.png`);
          if (fs.existsSync(alt)) file = alt;
        }
      }
    }
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      });
      res.end(fs.readFileSync(file));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

interface LaunchAttempt {
  executablePath?: string;
  channel?: string;
}

async function launchBrowser(
  log: (msg: string) => void,
  browserPath: string | null,
): Promise<Browser> {
  const { chromium } = await import('playwright-core');
  const attempts: LaunchAttempt[] = [];
  if (browserPath) attempts.push({ executablePath: browserPath });
  // System Chrome/Edge first (nothing to download), then the Playwright
  // browser registry (usable after `npx playwright install chromium`).
  attempts.push({ channel: 'chrome' }, { channel: 'msedge' }, {});
  let lastErr: unknown = null;
  for (const opt of attempts) {
    try {
      const browser = await chromium.launch({ headless: true, ...opt });
      log(`browser: ${opt.executablePath || opt.channel || 'playwright-registry'}`);
      return browser;
    } catch (e) {
      lastErr = e;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(
    `could not launch a Chromium browser (tried explicit path, channel=chrome, channel=msedge, playwright registry): ${msg}. ` +
      'Install Google Chrome or Microsoft Edge, run "npx playwright install chromium", ' +
      'or pass --browser <path>.',
  );
}

// --- ffmpeg encoder ---------------------------------------------------------

interface Encoder {
  stdin: Writable;
  /** Resolves once writes must stop: the encoder died or its stdin broke. */
  stopped: Promise<string>;
  /** Resolves with the exit code once the encoder process is gone. */
  closed: Promise<number | null>;
  stderrText(): string;
  kill(): void;
}

function spawnEncoder(fpsStr: string, preset: Preset, outPath: string): Encoder {
  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', fpsStr, '-i', '-',
    '-c:v', 'libx264', '-preset', preset, '-crf', '18',
    '-pix_fmt', 'yuv420p', '-r', fpsStr,
    '-movflags', '+faststart', outPath,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let stderr = '';
  ffmpeg.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
  });

  // ffmpeg's stdin must never surface an unhandled 'error' (EPIPE when the
  // encoder exits early), and a worker parked on 'drain' must wake up when it
  // dies instead of waiting forever. `closed` also resolves for late waits.
  const closed = new Promise<number | null>((resolve) => {
    ffmpeg.once('close', (code) => resolve(code));
  });
  const stopped = new Promise<string>((resolve) => {
    ffmpeg.stdin.on('error', (e: Error) => resolve(`ffmpeg stdin error: ${e.message}`));
    void closed.then((code) => resolve(`ffmpeg exited with code ${code}`));
  });

  return {
    stdin: ffmpeg.stdin,
    stopped,
    closed,
    stderrText: () => stderr,
    kill: () => ffmpeg.kill(),
  };
}

// --- in-order frame streaming ----------------------------------------------

// Buffers out-of-order captures and writes them to the encoder strictly in
// frame order, backpressure-aware.
// tell me why, ain't nothin' but a mistake
class OrderedFrameStream {
  private readonly pending = new Map<number, Buffer>();
  private nextIndex = 0;

  constructor(private readonly encoder: Encoder) {}

  async submit(index: number, frame: Buffer): Promise<void> {
    this.pending.set(index, frame);
    await this.flushReady();
  }

  async flushReady(): Promise<void> {
    while (this.pending.has(this.nextIndex)) {
      const frame = this.pending.get(this.nextIndex) as Buffer;
      this.pending.delete(this.nextIndex);
      if (!this.encoder.stdin.write(frame)) {
        const woke = await Promise.race([
          once(this.encoder.stdin, 'drain').then(() => 'drain' as const),
          this.encoder.stopped,
        ]);
        if (woke !== 'drain') {
          const stderr = this.encoder.stderrText().trim();
          throw new Error(`${woke}${stderr ? `: ${stderr}` : ''}`);
        }
      }
      this.nextIndex++;
    }
  }

  end(): void {
    this.encoder.stdin.end();
  }
}

// --- frame capture ---------------------------------------------------------

function screenshotOptions(capture: Capture) {
  return capture === 'jpeg'
    ? {
        type: 'jpeg' as const,
        quality: 95,
        animations: 'disabled' as const,
        timeout: SCREENSHOT_TIMEOUT_MS,
      }
    : {
        type: 'png' as const,
        animations: 'disabled' as const,
        timeout: SCREENSHOT_TIMEOUT_MS,
      };
}

export interface RenderOpts {
  html: string;
  style: Style;
  tileCache: string;
  width: number;
  height: number;
  frames: number;
  fpsStr: string;
  workers: number;
  outPath: string;
  log?: (msg: string) => void;
  browserPath?: string | null;
  capture: Capture;
  preset: Preset;
  tracer?: Tracer;
  parentSpan?: Span;
}

export interface RenderProfile {
  evalMs: number;
  captureMs: number;
  emitMs: number;
}

// Coarse stage timing summed over all workers (time awaiting each stage).
interface StageTiming {
  evalMs: number;
  captureMs: number;
  emitMs: number;
}

// One `render.capture.batch` subspan per cadence of captured frames, carrying
// the per-frame capture spread of that batch. Per-frame spans would bury the
// trace in thousands of near-identical spans and overflow the exporter queue.
export class FrameBatchRecorder {
  private openSpan: Span | null = null;
  private durations: number[] = [];

  constructor(
    private readonly tracer: Tracer,
    private readonly parent: Span,
    private readonly frames: number,
    private readonly cadence: number = 100,
  ) {}

  recordFrame(capturedSoFar: number, captureMs: number): void {
    if (this.openSpan === null) {
      this.openSpan = this.tracer.startSpan('render.capture.batch', {
        parent: this.parent,
      });
    }
    this.durations.push(captureMs);
    const boundary =
      capturedSoFar % this.cadence === 0 || capturedSoFar === this.frames;
    if (!boundary) return;
    const span = this.openSpan;
    const durations = this.durations;
    this.openSpan = null;
    this.durations = [];
    span.setAttribute('render.frames.captured', capturedSoFar);
    span.setAttribute('render.frame.minMs', Math.min(...durations));
    span.setAttribute(
      'render.frame.avgMs',
      Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10,
    );
    span.setAttribute('render.frame.maxMs', Math.max(...durations));
    span.end();
  }

  // End a half-open batch span (nothing in flight at close time is normal).
  close(error?: unknown): void {
    if (this.openSpan === null) return;
    if (error !== undefined) this.openSpan.fail(error);
    this.openSpan.end();
    this.openSpan = null;
  }
}

// Render `frames` output frames at `fps` to outPath. Every output frame gets
// its own capture (held frames judder whenever the map moves, so there is no
// frame-step option), streamed to ffmpeg in exact frame order.
// Traced as `render` over `render.capture` (+ batch subspans) and
// `render.encode`; capture and encode overlap by design.
export async function renderVideo(
  opts: RenderOpts,
): Promise<{ profile: RenderProfile }> {
  const {
    html, style, tileCache, width, height, frames, fpsStr,
    workers, outPath, log = () => {}, browserPath = null,
    capture = 'jpeg', preset = 'medium',
    tracer = NOOP_TRACER, parentSpan,
  } = opts;

  const workerCount = Math.max(1, Math.min(workers, frames));
  return withSpan(
    tracer,
    'render',
    {
      parent: parentSpan,
      attributes: {
        'render.workers': workerCount,
        'render.capture.mode': capture,
        'render.preset': preset,
      },
    },
    async (renderSpan) => {
      const { server, url } = await startServer({ html, style, tileCache });
      const browser = await launchBrowser(log, browserPath);
      const encoder = spawnEncoder(fpsStr, preset, outPath);
      const encodeSpan = tracer.startSpan('render.encode', {
        parent: renderSpan,
        attributes: { 'render.preset': preset },
      });
      let encodeEnded = false;
      const stream = new OrderedFrameStream(encoder);
      const captureSpan = tracer.startSpan('render.capture', {
        parent: renderSpan,
      });
      const batches = new FrameBatchRecorder(tracer, captureSpan, frames);

      let captureCursor = 0;
      let capturesDone = 0;
      const timing: StageTiming = { evalMs: 0, captureMs: 0, emitMs: 0 };

      async function worker(workerId: number): Promise<void> {
        const page = await browser.newPage({
          viewport: { width, height },
          deviceScaleFactor: 1,
        });
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT_MS });
          await page.waitForFunction('window.__READY === true', null, { timeout: PAGE_LOAD_TIMEOUT_MS });
          for (;;) {
            const idx = captureCursor++;
            if (idx >= frames) break;
            let t0 = Date.now();
            await page.evaluate((i: number) => {
              (globalThis as unknown as { __setFrame: (n: number) => void }).__setFrame(i);
            }, idx);
            timing.evalMs += Date.now() - t0;
            t0 = Date.now();
            const buf = await page.screenshot(screenshotOptions(capture));
            const captureMs = Date.now() - t0;
            timing.captureMs += captureMs;
            capturesDone++;
            batches.recordFrame(capturesDone, captureMs);
            t0 = Date.now();
            await stream.submit(idx, buf);
            timing.emitMs += Date.now() - t0;
            if (capturesDone % 100 === 0 || capturesDone === frames) {
              log(`frames: ${capturesDone}/${frames} captured`);
            }
          }
        } finally {
          await page.close().catch(() => {});
        }
        log(`worker ${workerId} done`);
      }

      try {
        try {
          await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));
        } catch (e) {
          batches.close(e);
          captureSpan.fail(e);
          throw e;
        } finally {
          batches.close();
          captureSpan.setAttribute('render.frames.captured', capturesDone);
          captureSpan.end();
        }
        await stream.flushReady();
        stream.end();
        // `closed` (not `once(ffmpeg, 'close')`): ffmpeg may already have exited.
        const code = await encoder.closed;
        encodeSpan.setAttribute('render.ffmpeg.exitCode', code ?? -1);
        if (code !== 0) {
          throw new Error(`ffmpeg exited with code ${code}: ${encoder.stderrText().trim()}`);
        }
        encodeEnded = true;
        encodeSpan.end();
        log(`encoded: ${outPath}`);
        log(
          `profile: eval=${(timing.evalMs / 1000).toFixed(1)}s capture=${(timing.captureMs / 1000).toFixed(1)}s ` +
            `encode-backpressure=${(timing.emitMs / 1000).toFixed(1)}s (summed over ${workerCount} workers)`,
        );
      } catch (e) {
        encoder.kill();
        if (!encodeEnded) {
          encodeSpan.fail(e);
          encodeSpan.end();
        }
        throw e;
      } finally {
        await browser.close().catch(() => {});
        server.close();
      }

      renderSpan.setAttribute('render.evalMs', Math.round(timing.evalMs));
      renderSpan.setAttribute('render.captureMs', Math.round(timing.captureMs));
      renderSpan.setAttribute('render.emitMs', Math.round(timing.emitMs));
      return {
        profile: {
          evalMs: Math.round(timing.evalMs),
          captureMs: Math.round(timing.captureMs),
          emitMs: Math.round(timing.emitMs),
        },
      };
    },
  );
}
