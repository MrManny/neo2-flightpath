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

// Politeness for the tile servers: every request start in one queue is spaced
// REQUEST_INTERVAL_MS apart (2.0 req/s), retries included, whichever queue
// drives them.
type RequestGate = () => Promise<void>;

function createRequestGate(): RequestGate {
  let nextSlotAt = 0;
  return async () => {
    const now = Date.now();
    const startAt = Math.max(now, nextSlotAt);
    nextSlotAt = startAt + REQUEST_INTERVAL_MS;
    if (startAt > now) await sleep(startAt - now);
  };
}

function cacheKeyFor(style: Style): string {
  return TILE_SOURCES[style].cacheKey;
}

export interface TileRef {
  style: Style;
  tile: TileCoord;
}

export function parseTilePathname(pathname: string): TileRef | null {
  const m = /^\/tiles\/([a-z0-9_-]+)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(pathname);
  if (!m) return null;
  // The URL regex admits any slug; only vocabulary styles are tiles, so the
  // returned style is never a cast lie the callers must re-check.
  const style = Object.hasOwn(TILE_SOURCES, m[1]) ? (m[1] as Style) : null;
  return style === null
    ? null
    : { style, tile: { z: Number(m[2]), x: Number(m[3]), y: Number(m[4]) } };
}

// The one cache layout, shared by the prefetcher, the render server and the
// app server so they can never disagree about where a tile lives.
export function tilePaths(
  cacheDir: string,
  style: Style,
  tile: TileCoord,
): { file: string; placeholder: string } {
  const dir = path.join(cacheDir, cacheKeyFor(style), String(tile.z), String(tile.x));
  return {
    file: path.join(dir, `${tile.y}.png`),
    placeholder: path.join(dir, `${tile.y}.placeholder.png`),
  };
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

async function downloadTile(
  url: string,
  cachePath: string,
  acquire: RequestGate,
): Promise<boolean> {
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt++) {
    await acquire();
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

export type TileStatus = 'cached' | 'downloaded' | 'failed';

export interface TileFetchResult {
  /** The file to serve: the real tile, or its placeholder after a failure. */
  file: string;
  status: TileStatus;
}

// The full cache dance for one tile: hit, download, or placeholder. The
// placeholder is served as a fallback so a missing tile is retried on a later
// run instead of being cached as missing.
async function fetchTileToCache(
  cacheDir: string,
  style: Style,
  tile: TileCoord,
  acquire: RequestGate,
): Promise<TileFetchResult> {
  const paths = tilePaths(cacheDir, style, tile);
  if (fs.existsSync(paths.file)) return { file: paths.file, status: 'cached' };
  if (await downloadTile(tileUrl(style, tile), paths.file, acquire)) {
    return { file: paths.file, status: 'downloaded' };
  }
  fs.mkdirSync(path.dirname(paths.placeholder), { recursive: true });
  fs.writeFileSync(paths.placeholder, placeholderPng(style));
  return { file: paths.placeholder, status: 'failed' };
}

export interface PrefetchStats {
  downloaded: number;
  failed: number;
  total: number;
}

// Polite bulk fetching: 2 concurrent workers, 2.0 req/s. onTile fires once per
// tile as it settles (cached, downloaded or failed) so callers can track the
// pre-warm's running progress.
export async function prefetchTiles({
  style,
  tiles,
  cacheDir,
  log = () => {},
  onTile = () => {},
}: {
  style: Style;
  tiles: TileCoord[];
  cacheDir: string;
  log?: (msg: string) => void;
  onTile?: (status: TileStatus) => void;
}): Promise<PrefetchStats> {
  const missing: { tile: TileCoord }[] = [];
  for (const tile of tiles) {
    if (fs.existsSync(tilePaths(cacheDir, style, tile).file)) onTile('cached');
    else missing.push({ tile });
  }
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
      const result = await fetchTileToCache(cacheDir, style, tile, gate);
      if (result.status === 'downloaded') downloaded++;
      else if (result.status === 'failed') failed++;
      onTile(result.status);
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
          const result = await fetchTileToCache(cacheDir, job.style, job.tile, gate);
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
      const key = tilePaths(cacheDir, style, tile).file;
      let task = inFlight.get(key);
      if (!task) {
        task = new Promise<string>((resolve, reject) => {
          // Newest requests first: a style flip or zoom change makes the
          // previous viewport stale, and those tiles can wait behind what
          // the user is looking at now.
          queue.unshift({ style, tile, settle: resolve, fail: reject });
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
