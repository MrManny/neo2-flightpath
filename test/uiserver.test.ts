import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '../src/config.js';
import type { RenderConfig } from '../src/config.js';
import { startUiServer } from '../src/uiserver.js';
import type { PrepareUiRecording, UiServerOptions } from '../src/uiserver.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

const VIDEO_BYTES = Buffer.from('fake-video-bytes');

function writeVideo(): string {
  const filePath = path.join(tmpDir(), 'flight.mp4');
  fs.writeFileSync(filePath, VIDEO_BYTES);
  return filePath;
}

function testConfig(): RenderConfig {
  return { ...DEFAULT_CONFIG, tileCache: tmpDir() };
}

const fakePrepare: PrepareUiRecording = async (videoPath) => ({
  pageHtml: '<html>SESSION</html>',
  videoPath,
});

async function withServer(
  opts: Partial<UiServerOptions>,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const handle = await startUiServer({
    config: testConfig(),
    pickFile: async () => null,
    prepare: fakePrepare,
    ...opts,
  });
  try {
    await fn(handle.url);
  } finally {
    await handle.close();
  }
}

// Raw requests can set headers that fetch() treats as forbidden (Host, Origin).
function rawRequest(
  url: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method: opts.method ?? 'GET', headers: opts.headers ?? {} },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

afterEach(cleanupTmpDirs);

describe('startUiServer', () => {
  it('serves the landing page before a recording is loaded', async () => {
    await withServer({}, async (url) => {
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('id="btn-pick"');
      expect(html).toContain('Open recording');
    });
  });

  it('reports a canceled picker without touching the session', async () => {
    await withServer({ pickFile: async () => null }, async (url) => {
      const res = await fetch(`${url}api/pick`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, canceled: true });
      expect(await (await fetch(url)).text()).toContain('id="btn-pick"');
    });
  });

  it('loads a picked recording and then serves the session page', async () => {
    const videoPath = writeVideo();
    const prepare = vi.fn(fakePrepare);
    await withServer({ pickFile: async () => videoPath, prepare }, async (url) => {
      const res = await fetch(`${url}api/pick`, { method: 'POST' });
      expect(await res.json()).toEqual({ ok: true });
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(vi.mocked(prepare).mock.calls[0][0]).toBe(videoPath);
      expect(await (await fetch(url)).text()).toContain('SESSION');
    });
  });

  it.for([
    { name: 'missing file', make: () => path.join(tmpDir(), 'ghost.mp4') },
    { name: 'wrong extension', make: () => {
        const p = path.join(tmpDir(), 'notes.txt');
        fs.writeFileSync(p, 'hello');
        return p;
      } },
  ])('rejects a picked path that is not a readable .mp4: $name', async ({ make }) => {
    const prepare = vi.fn(fakePrepare);
    await withServer({ pickFile: async () => make(), prepare }, async (url) => {
      const res = await fetch(`${url}api/pick`, { method: 'POST' });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain('not a readable .mp4');
      expect(prepare).not.toHaveBeenCalled();
    });
  });

  it('surfaces preparation failures and keeps the landing page', async () => {
    const prepare = vi.fn(async () => {
      throw new Error('boom');
    });
    await withServer({ pickFile: async () => writeVideo(), prepare }, async (url) => {
      const res = await fetch(`${url}api/pick`, { method: 'POST' });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ ok: false, error: 'boom' });
      expect(await (await fetch(url)).text()).toContain('id="btn-pick"');
    });
  });

  it('streams the loaded recording with range support', async () => {
    await withServer({ pickFile: writeVideo }, async (url) => {
      await fetch(`${url}api/pick`, { method: 'POST' });
      const full = await fetch(`${url}video`);
      expect(full.status).toBe(200);
      expect(Buffer.from(await full.arrayBuffer())).toEqual(VIDEO_BYTES);
      const part = await fetch(`${url}video`, { headers: { range: 'bytes=0-3' } });
      expect(part.status).toBe(206);
      expect(Buffer.from(await part.arrayBuffer()).toString()).toBe('fake');
    });
  });

  it('404s the video route before a recording is loaded', async () => {
    await withServer({}, async (url) => {
      const res = await fetch(`${url}video`);
      expect(res.status).toBe(404);
    });
  });

  it('rejects non-POST on the pick endpoint', async () => {
    await withServer({}, async (url) => {
      const res = await fetch(`${url}api/pick`);
      expect(res.status).toBe(405);
    });
  });

  it('serves Leaflet assets and 404s unknown routes', async () => {
    await withServer({}, async (url) => {
      expect((await fetch(`${url}leaflet/leaflet.css`)).status).toBe(200);
      expect((await fetch(`${url}other`)).status).toBe(404);
    });
  });

  it('rejects requests with a foreign Host header', async () => {
    await withServer({}, async (url) => {
      const res = await rawRequest(url, { headers: { host: 'evil.example' } });
      expect(res.status).toBe(403);
    });
  });

  it('rejects cross-origin pick attempts', async () => {
    const prepare = vi.fn(fakePrepare);
    await withServer({ pickFile: async () => writeVideo(), prepare }, async (url) => {
      const res = await rawRequest(`${url}api/pick`, {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      });
      expect(res.status).toBe(403);
      expect(prepare).not.toHaveBeenCalled();
    });
  });

  it('accepts same-origin requests with a matching Origin header', async () => {
    await withServer({}, async (url) => {
      const res = await rawRequest(`${url}api/pick`, {
        method: 'POST',
        headers: { origin: `http://127.0.0.1:${new URL(url).port}` },
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: false, canceled: true });
    });
  });

  it('refuses a second pick while one is in progress', async () => {
    let release: ((value: string | null) => void) | null = null;
    const pickFile = (): Promise<string | null> =>
      new Promise((resolve) => {
        release = resolve;
      });
    await withServer({ pickFile }, async (url) => {
      const first = fetch(`${url}api/pick`, { method: 'POST' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = await fetch(`${url}api/pick`, { method: 'POST' });
      expect(second.status).toBe(409);
      (release as (value: string | null) => void)(null);
      expect((await first).status).toBe(200);
    });
  });

  it('lets close() settle after an aborted video stream', async () => {
    await withServer({ pickFile: async () => writeVideo() }, async (url) => {
      await fetch(`${url}api/pick`, { method: 'POST' });
      const res = await fetch(`${url}video`);
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();
      await reader.cancel();
    });
  });
});
