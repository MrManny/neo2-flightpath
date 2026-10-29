import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { serveAsset, serveFileWithRange } from '../src/serve.js';
import type { Style } from '../src/config.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

interface Host {
  url: string;
  close(): Promise<void>;
}

async function startHost(
  tileCache: string,
  videoPath: string | null,
  style: Style = 'satellite',
): Promise<Host> {
  const streams: Array<Promise<void>> = [];
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (serveAsset(url, res, { style, tileCache })) return;
    if (url === '/video' && videoPath) {
      streams.push(serveFileWithRange(req, res, videoPath));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    // Streams release their file handles asynchronously; cleanup (tmpDir
    // removal on Windows) must wait for them.
    close: async () => {
      await Promise.allSettled(streams);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function writeTile(tileCache: string, key: string, z: number, x: number, y: number, name: string): void {
  const dir = path.join(tileCache, key, String(z), String(x));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from('tile-bytes'));
}

afterEach(cleanupTmpDirs);

describe('serveAsset', () => {
  it('serves Leaflet assets from node_modules', async () => {
    const host = await startHost(tmpDir(), null);
    try {
      const res = await fetch(`${host.url}/leaflet/leaflet.css`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/css');
      expect((await res.text()).length).toBeGreaterThan(0);
    } finally {
      await host.close();
    }
  });

  it('rejects Leaflet paths outside the asset whitelist', async () => {
    const host = await startHost(tmpDir(), null);
    try {
      const res = await fetch(`${host.url}/leaflet/evil.txt`);
      expect(res.status).toBe(404);
    } finally {
      await host.close();
    }
  });

  it('serves cached tiles for the active style', async () => {
    const tileCache = tmpDir();
    writeTile(tileCache, 'esri-imagery', 1, 2, 3, '3.png');
    const host = await startHost(tileCache, null);
    try {
      const res = await fetch(`${host.url}/tiles/satellite/1/2/3.png`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('image/png');
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('tile-bytes');
    } finally {
      await host.close();
    }
  });

  it('falls back to the placeholder tile', async () => {
    const tileCache = tmpDir();
    writeTile(tileCache, 'esri-imagery', 4, 5, 6, '6.placeholder.png');
    const host = await startHost(tileCache, null);
    try {
      const res = await fetch(`${host.url}/tiles/satellite/4/5/6.png`);
      expect(res.status).toBe(200);
    } finally {
      await host.close();
    }
  });

  it('refuses tiles of a style that is not active', async () => {
    const tileCache = tmpDir();
    writeTile(tileCache, 'opentopomap', 1, 2, 3, '3.png');
    const host = await startHost(tileCache, null, 'satellite');
    try {
      const res = await fetch(`${host.url}/tiles/topo/1/2/3.png`);
      expect(res.status).toBe(404);
    } finally {
      await host.close();
    }
  });

  it('404s unknown URLs without claiming them', async () => {
    const host = await startHost(tmpDir(), null);
    try {
      const res = await fetch(`${host.url}/other`);
      expect(res.status).toBe(404);
    } finally {
      await host.close();
    }
  });
});

describe('serveFileWithRange', () => {
  const VIDEO = '0123456789';

  function withVideo(): { videoPath: string } {
    const dir = tmpDir();
    const videoPath = path.join(dir, 'clip.mp4');
    fs.writeFileSync(videoPath, Buffer.from(VIDEO));
    return { videoPath };
  }

  it('serves the whole file without a Range header', async () => {
    const { videoPath } = withVideo();
    const host = await startHost(tmpDir(), videoPath);
    try {
      const res = await fetch(`${host.url}/video`);
      expect(res.status).toBe(200);
      expect(res.headers.get('accept-ranges')).toBe('bytes');
      expect(res.headers.get('content-length')).toBe(String(VIDEO.length));
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(VIDEO);
    } finally {
      await host.close();
    }
  });

  it.for([
    { name: 'closed range', range: 'bytes=2-5', status: 206, body: '2345', contentRange: 'bytes 2-5/10' },
    { name: 'open-ended range', range: 'bytes=5-', status: 206, body: '56789', contentRange: 'bytes 5-9/10' },
    { name: 'suffix range', range: 'bytes=-3', status: 206, body: '789', contentRange: 'bytes 7-9/10' },
    { name: 'clamped end', range: 'bytes=8-99', status: 206, body: '89', contentRange: 'bytes 8-9/10' },
    { name: 'unsatisfiable range', range: 'bytes=10-', status: 416, body: 'range not satisfiable', contentRange: 'bytes */10' },
    { name: 'malformed range is ignored', range: 'bytes=abc', status: 200, body: VIDEO, contentRange: null },
  ])('handles $name', async ({ range, status, body, contentRange }) => {
    const { videoPath } = withVideo();
    const host = await startHost(tmpDir(), videoPath);
    try {
      const res = await fetch(`${host.url}/video`, { headers: { range } });
      expect(res.status).toBe(status);
      expect(res.headers.get('content-range')).toBe(contentRange);
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(body);
    } finally {
      await host.close();
    }
  });

  it('answers HEAD with headers only', async () => {
    const { videoPath } = withVideo();
    const host = await startHost(tmpDir(), videoPath);
    try {
      const res = await fetch(`${host.url}/video`, { method: 'HEAD' });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-length')).toBe(String(VIDEO.length));
      expect((await res.arrayBuffer()).byteLength).toBe(0);
    } finally {
      await host.close();
    }
  });

  it('404s a missing file', async () => {
    const host = await startHost(tmpDir(), path.join(tmpDir(), 'gone.mp4'));
    try {
      const res = await fetch(`${host.url}/video`);
      expect(res.status).toBe(404);
    } finally {
      await host.close();
    }
  });
});
