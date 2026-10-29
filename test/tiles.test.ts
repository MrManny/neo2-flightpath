import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTileFetcher, solidPng } from '../src/tiles.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cleanupTmpDirs();
});

function okFetch() {
  return vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
}

describe('solidPng', () => {
  it('writes a valid PNG signature and 256x256 IHDR', () => {
    const buf = solidPng('#2a2f38');
    expect([...buf.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(buf.readUInt32BE(16)).toBe(256); // IHDR width
    expect(buf.readUInt32BE(20)).toBe(256); // IHDR height
  });
});

describe('createTileFetcher', () => {
  it('downloads a missing tile into the cache and returns it', async () => {
    const dir = tmpDir();
    const fetchStub = okFetch();
    vi.stubGlobal('fetch', fetchStub);

    const file = await createTileFetcher(dir).ensure('satellite', { z: 1, x: 2, y: 3 });

    expect(file).toBe(path.join(dir, 'esri-imagery', '1', '2', '3.png'));
    expect(fs.existsSync(file)).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('writes a placeholder and serves it when the download fails', async () => {
    const dir = tmpDir();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    const file = await createTileFetcher(dir).ensure('topo', { z: 1, x: 2, y: 3 });

    expect(file).toBe(path.join(dir, 'opentopomap', '1', '2', '3.placeholder.png'));
    expect(fs.existsSync(file)).toBe(true);
  });

  it('serves a cached tile without fetching', async () => {
    const dir = tmpDir();
    const cachePath = path.join(dir, 'esri-imagery', '1', '2', '3.png');
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, 'cached');
    const fetchStub = okFetch();
    vi.stubGlobal('fetch', fetchStub);

    const file = await createTileFetcher(dir).ensure('satellite', { z: 1, x: 2, y: 3 });

    expect(file).toBe(cachePath);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('shares one download for concurrent requests of the same tile', async () => {
    const dir = tmpDir();
    const fetchStub = okFetch();
    vi.stubGlobal('fetch', fetchStub);
    const fetcher = createTileFetcher(dir);

    const [a, b] = await Promise.all([
      fetcher.ensure('satellite', { z: 1, x: 2, y: 3 }),
      fetcher.ensure('satellite', { z: 1, x: 2, y: 3 }),
    ]);

    expect(a).toBe(b);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('paces request starts at 2.0 per second', async () => {
    vi.useFakeTimers();
    const dir = tmpDir();
    const starts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(Date.now());
        return new Response(new Uint8Array([1]), { status: 200 });
      }),
    );
    const fetcher = createTileFetcher(dir);

    const pending = [0, 1, 2, 3].map((y) =>
      fetcher.ensure('satellite', { z: 1, x: 0, y }),
    );
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all(pending);

    expect(starts).toHaveLength(4);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(500);
    }
  });
});

