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
const REQUEST_INTERVAL_MS = 400; // <= ~2.5 requests/s across both workers
const RETRY_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 20000;

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

export interface PrefetchStats {
  downloaded: number;
  failed: number;
  total: number;
}

// Polite fetching: 2 concurrent workers, ~2.5 req/s. Failed tiles get a
// `<y>.placeholder.png` sibling (served as fallback) so the real tile is
// retried on the next run instead of being cached as missing.
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

  const placeholder = solidPng(TILE_SOURCES[style].placeholderBg);
  let downloaded = 0;
  let failed = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < missing.length) {
      const { tile, cachePath } = missing[cursor++];
      if (await downloadTile(tileUrl(style, tile), cachePath)) {
        downloaded++;
      } else {
        failed++;
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(
          tilePlaceholderPath(cacheDir, style, tile),
          placeholder,
        );
      }
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  await Promise.all([worker(), worker()]);
  return { downloaded, failed, total: tiles.length };
}
