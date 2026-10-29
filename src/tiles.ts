import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { project } from './geo.js';
import type { Bbox, Pixel } from './geo.js';
import type { Style } from './config.js';
import { TILE_SOURCES } from './tilesources.js';
import { VERSION } from './version.js';

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface OverviewOptions {
  bbox: Bbox;
  width: number;
  height: number;
  maxZoom?: number;
  zoomOut?: number;
  follow?: boolean;
  maxNativeZoom?: number | null;
  zoomOverride?: number;
}

export interface Overview {
  centerPx: Pixel;
  zoom: number;
  tiles: TileCoord[];
}

const MIN_ZOOM = 2;
const HOVER_ZOOM_FLOOR = 16;
const MIN_TRACK_SPAN_PX = 80; // tiny/hovering tracks stay a useful close-up
const TILE_SIZE_PX = 256;

function fitZoomToTrack(
  bbox: Bbox,
  availW: number,
  availH: number,
  maxZoom: number,
): number {
  for (let zoom = maxZoom; zoom >= MIN_ZOOM; zoom--) {
    const northWest = project(bbox.minLon, bbox.maxLat, zoom);
    const southEast = project(bbox.maxLon, bbox.minLat, zoom);
    const fits =
      southEast.x - northWest.x <= availW &&
      southEast.y - northWest.y <= availH;
    if (fits) return zoom;
  }
  return MIN_ZOOM;
}

// Never zoom a tiny (hovering) track past a useful overview.
function pullBackTinyTracks(zoom: number, bbox: Bbox): number {
  while (zoom > HOVER_ZOOM_FLOOR) {
    const northWest = project(bbox.minLon, bbox.maxLat, zoom);
    const southEast = project(bbox.maxLon, bbox.minLat, zoom);
    const spansEnough =
      southEast.x - northWest.x >= MIN_TRACK_SPAN_PX ||
      southEast.y - northWest.y >= MIN_TRACK_SPAN_PX;
    if (spansEnough) break;
    zoom--;
  }
  return zoom;
}

// The map element is 2x the frame (intro/outro zoom-out shows up to 2x the
// area) and in follow mode it also slides across the track extent. With a
// native-zoom limit the tiles live one or more levels below the view zoom.
function tilesCovering(
  centerPx: Pixel,
  trackSpanPx: Pixel,
  zoom: number,
  width: number,
  height: number,
  follow: boolean,
  maxNativeZoom: number | null,
): TileCoord[] {
  const tileZoom = maxNativeZoom
    ? Math.min(zoom, maxNativeZoom)
    : zoom;
  const scale = 2 ** (tileZoom - zoom);
  const halfW = (width + TILE_SIZE_PX + (follow ? trackSpanPx.x / 2 : 0)) * scale;
  const halfH = (height + TILE_SIZE_PX + (follow ? trackSpanPx.y / 2 : 0)) * scale;

  const maxTileIndex = 2 ** tileZoom - 1;
  const xMin = Math.max(0, Math.floor((centerPx.x * scale - halfW) / TILE_SIZE_PX));
  const xMax = Math.min(maxTileIndex, Math.floor((centerPx.x * scale + halfW) / TILE_SIZE_PX));
  const yMin = Math.max(0, Math.floor((centerPx.y * scale - halfH) / TILE_SIZE_PX));
  const yMax = Math.min(maxTileIndex, Math.floor((centerPx.y * scale + halfH) / TILE_SIZE_PX));

  const tiles: TileCoord[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) tiles.push({ z: tileZoom, x, y });
  }
  return tiles;
}

// zoomOut adds surroundings context; follow mode slides the map under a
// centered marker. When the source has a maxNativeZoom below the view zoom,
// tiles are fetched at the native level (Leaflet scales them).
export function computeOverview({
  bbox,
  width,
  height,
  maxZoom = 19,
  zoomOut = 0,
  follow = false,
  maxNativeZoom = null,
  zoomOverride = 0,
}: OverviewOptions): Overview {
  const padX = Math.round(width * 0.08);
  const padY = Math.round(height * 0.08);
  const availW = Math.max(64, width - 2 * padX);
  const availH = Math.max(64, height - 2 * padY);

  let zoom: number;
  if (zoomOverride > 0) {
    zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, Math.round(zoomOverride)));
  } else {
    zoom = pullBackTinyTracks(
      fitZoomToTrack(bbox, availW, availH, maxZoom),
      bbox,
    );
    zoom = Math.max(MIN_ZOOM, zoom - Math.max(0, Math.floor(zoomOut)));
  }

  // Degenerate (hovering) track: show a close-up around the single point.
  const northWest = project(bbox.minLon, bbox.maxLat, zoom);
  const southEast = project(bbox.maxLon, bbox.minLat, zoom);
  const centerPx: Pixel = {
    x: (northWest.x + southEast.x) / 2,
    y: (northWest.y + southEast.y) / 2,
  };
  const trackSpanPx: Pixel = {
    x: southEast.x - northWest.x,
    y: southEast.y - northWest.y,
  };

  return {
    centerPx,
    zoom,
    tiles: tilesCovering(
      centerPx, trackSpanPx, zoom, width, height, follow, maxNativeZoom,
    ),
  };
}

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
