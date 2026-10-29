import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import type { TileCoord } from './plan.js';
import type { Style } from './config.js';
import { TILE_SOURCES } from './renderer/tilesources.js';
import { VERSION } from './version.js';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function solidPng(hexColor: string, size = 256): Buffer {
  const r = Number.parseInt(hexColor.slice(1, 3), 16);
  const g = Number.parseInt(hexColor.slice(3, 5), 16);
  const b = Number.parseInt(hexColor.slice(5, 7), 16);
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const USER_AGENT = `neo2-flightpath/${VERSION} (flight-path map renderer; https://github.com/MrManny/neo2-flightpath)`;

const DOWNLOAD_ATTEMPTS = 2;
const DOWNLOAD_WORKERS = 2;
const REQUEST_INTERVAL_MS = 500;
const RETRY_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 20000;

// Politeness for the tile servers: request starts in one queue are spaced
// REQUEST_INTERVAL_MS apart (2.0 req/s), whichever queue drives them.
function createRequestGate(): () => Promise<void> {
  let nextSlotAt = 0;
  return async () => {
    const now = Date.now();
    const startAt = Math.max(now, nextSlotAt);
    nextSlotAt = startAt + REQUEST_INTERVAL_MS;
    if (startAt > now) await sleep(startAt - now);
  };
}

function cacheKeyFor(style: Style): string {
  return TILE_SOURCES[style].cacheKey || style;
}

function tileCachePath(cacheDir: string, style: Style, tile: TileCoord): string {
  return path.join(
    cacheDir,
    cacheKeyFor(style),
    String(tile.z),
    String(tile.x),
    `${tile.y}.png`,
  );
}

function tilePlaceholderPath(
  cacheDir: string,
  style: Style,
  tile: TileCoord,
): string {
  return path.join(
    cacheDir,
    cacheKeyFor(style),
    String(tile.z),
    String(tile.x),
    `${tile.y}.placeholder.png`,
  );
}

function tileUrl(style: Style, tile: TileCoord): string {
  const source = TILE_SOURCES[style];
  const subdomain = source.subdomains.length
    ? source.subdomains[(tile.x + tile.y) % source.subdomains.length]
    : '';
  return source.url
    .replace('{s}', subdomain)
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));
}

async function downloadTile(url: string, cachePath: string): Promise<boolean> {
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, Buffer.from(await res.arrayBuffer()));
        return true;
      }
    } catch {
      await sleep(RETRY_DELAY_MS);
    }
  }
  return false;
}

const placeholderPngs = new Map<Style, Buffer>();

function placeholderPng(style: Style): Buffer {
  let png = placeholderPngs.get(style);
  if (!png) {
    png = solidPng(TILE_SOURCES[style].placeholderBg);
    placeholderPngs.set(style, png);
  }
  return png;
}

export interface TileFetchResult {
  /** The file to serve: the real tile, or its placeholder after a failure. */
  file: string;
  status: 'cached' | 'downloaded' | 'failed';
}

// The full cache dance for one tile: hit, download, or placeholder. The
// placeholder is served as a fallback so a missing tile is retried on a later
// run instead of being cached as missing.
async function fetchTileToCache(
  cacheDir: string,
  style: Style,
  tile: TileCoord,
): Promise<TileFetchResult> {
  const cachePath = tileCachePath(cacheDir, style, tile);
  if (fs.existsSync(cachePath)) return { file: cachePath, status: 'cached' };
  if (await downloadTile(tileUrl(style, tile), cachePath)) {
    return { file: cachePath, status: 'downloaded' };
  }
  const placeholderPath = tilePlaceholderPath(cacheDir, style, tile);
  fs.mkdirSync(path.dirname(placeholderPath), { recursive: true });
  fs.writeFileSync(placeholderPath, placeholderPng(style));
  return { file: placeholderPath, status: 'failed' };
}

export interface PrefetchStats {
  downloaded: number;
  failed: number;
  total: number;
}

// Polite bulk fetching: 2 concurrent workers, 2.0 req/s.
export async function prefetchTiles({
  style,
  tiles,
  cacheDir,
  log = () => {},
}: {
  style: Style;
  tiles: TileCoord[];
  cacheDir: string;
  log?: (msg: string) => void;
}): Promise<PrefetchStats> {
  const missing = tiles
    .map((tile) => ({ tile, cachePath: tileCachePath(cacheDir, style, tile) }))
    .filter(({ cachePath }) => !fs.existsSync(cachePath));
  if (missing.length === 0) {
    return { downloaded: 0, failed: 0, total: tiles.length };
  }
  log(`tiles: ${tiles.length} needed, ${missing.length} to download (${style})`);

  const gate = createRequestGate();
  let downloaded = 0;
  let failed = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < missing.length) {
      const { tile } = missing[cursor++];
      await gate();
      const result = await fetchTileToCache(cacheDir, style, tile);
      if (result.status === 'downloaded') downloaded++;
      else if (result.status === 'failed') failed++;
    }
  }

  await Promise.all(Array.from({ length: DOWNLOAD_WORKERS }, worker));
  return { downloaded, failed, total: tiles.length };
}

export interface TileFetcher {
  /** Fetches one tile into the cache (or its placeholder); returns the file to serve. */
  ensure(style: Style, tile: TileCoord): Promise<string>;
}

// On-demand fetching for the app's live restyle. The queue keeps the polite
// 2.0 req/s even when Leaflet bursts in with a whole viewport of tiles, and
// concurrent requests for the same tile share one download.
export function createTileFetcher(cacheDir: string): TileFetcher {
  const gate = createRequestGate();
  const inFlight = new Map<string, Promise<string>>();
  const queue: Array<{
    style: Style;
    tile: TileCoord;
    settle: (file: string) => void;
    fail: (error: unknown) => void;
  }> = [];
  let active = 0;

  function pump(): void {
    while (active < DOWNLOAD_WORKERS && queue.length > 0) {
      const job = queue.shift() as (typeof queue)[number];
      active++;
      void (async () => {
        try {
          await gate();
          const result = await fetchTileToCache(cacheDir, job.style, job.tile);
          job.settle(result.file);
        } catch (e) {
          job.fail(e);
        } finally {
          active--;
          pump();
        }
      })();
    }
  }

  return {
    ensure(style, tile): Promise<string> {
      const key = `${cacheKeyFor(style)}/${tile.z}/${tile.x}/${tile.y}`;
      let task = inFlight.get(key);
      if (!task) {
        task = new Promise<string>((resolve, reject) => {
          queue.push({ style, tile, settle: resolve, fail: reject });
          pump();
        });
        void task.then(
          () => inFlight.delete(key),
          () => inFlight.delete(key),
        );
        inFlight.set(key, task);
      }
      return task;
    },
  };
}
