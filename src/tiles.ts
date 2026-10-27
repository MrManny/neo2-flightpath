// tiles.ts - Web Mercator view computation, polite tile prefetch and cache.
// Tiles are cached under <cache>/<source>/<z>/<x>/<y>.png and served locally
// during rendering. Sources: Esri World Imagery (satellite) and OpenTopoMap
// (topo). Fetching is rate-limited with a custom User-Agent and failed tiles
// get a placeholder sibling so they are retried on the next run.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { project } from './geo.js';
import type { Bbox, Pixel } from './geo.js';
import { VERSION } from './version.js';

export type StyleName = 'satellite' | 'topo';

export interface TileSource {
  cacheKey: string;
  url: string;
  subdomains: string[];
  attribution: string;
  bg: string;
  placeholderBg: string;
  tileFilter: string | null;
  maxZoom: number;
  maxNativeZoom?: number;
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export const TILE_SOURCES: Record<StyleName, TileSource> = {
  // Esri World Imagery (free for non-commercial use, attribution required).
  // Tiles are JPEG; the cache filename stays .png and browsers decode by
  // content, which is fine for Leaflet <img> tiles.
  satellite: {
    cacheKey: 'esri-imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    subdomains: [''],
    attribution:
      'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
    bg: '#0b0e14',
    placeholderBg: '#2a2f38',
    tileFilter: 'saturate(1.06) contrast(1.03)',
    maxZoom: 19,
  },
  // OpenTopoMap: OSM topography with contour lines and shaded relief - rich
  // detail in alpine terrain. Tiles are native to z17; Leaflet auto-scales
  // them above that (maxNativeZoom), so the view zoom stays style-independent.
  topo: {
    cacheKey: 'opentopomap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    bg: '#eae5da',
    placeholderBg: '#eae5da',
    tileFilter: null,
    maxZoom: 19,
    maxNativeZoom: 17,
  },
};

export function isStyleName(value: string): value is StyleName {
  return value === 'satellite' || value === 'topo';
}

// Default tile cache: per-user cache directory (NEO2_FLIGHTPATH_TILE_CACHE
// overrides it).
export function defaultTileCache(): string {
  const override = process.env['NEO2_FLIGHTPATH_TILE_CACHE'];
  if (override) return path.resolve(override);
  const base = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), '.cache');
  return path.join(base, 'neo2-flightpath', 'tiles');
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

// Compute the overview view (whole track in frame) for a canvas of width x
// height. zoomOut pulls the camera back n extra levels for more surroundings
// context; follow mode slides the map under a centered marker. When the source
// has a maxNativeZoom below the view zoom, tiles are fetched at the native
// level (Leaflet scales them).
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
    // Fixed view zoom (configurable zoom level), independent of track size.
    zoom = Math.max(2, Math.min(maxZoom, Math.round(zoomOverride)));
  } else {
    zoom = 2;
    for (let z = maxZoom; z >= 2; z--) {
      const a = project(bbox.minLon, bbox.maxLat, z);
      const b = project(bbox.maxLon, bbox.minLat, z);
      if (b.x - a.x <= availW && b.y - a.y <= availH) {
        zoom = z;
        break;
      }
      zoom = z - 1;
    }
    zoom = Math.max(2, zoom);

    // Tiny / hovering track: never zoom past a useful overview (>= ~80 px span,
    // never closer than zoom 16).
    while (zoom > 16) {
      const a = project(bbox.minLon, bbox.maxLat, zoom);
      const b = project(bbox.maxLon, bbox.minLat, zoom);
      if (b.x - a.x >= 80 || b.y - a.y >= 80) break;
      zoom--;
    }

    // Pull back for context ("zoom out a little").
    const out = Math.max(0, Math.floor(zoomOut));
    zoom = Math.max(2, zoom - out);
  }

  // Degenerate (hovering) track: show a close-up around the single point.
  const a = project(bbox.minLon, bbox.maxLat, zoom);
  const b = project(bbox.maxLon, bbox.minLat, zoom);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;

  // Tile coverage of the whole map element plus a one-tile margin. The map
  // element is 2x the frame (intro/outro zoom-out shows up to 2x the area) and
  // in follow mode it also slides across the track extent. With a native-zoom
  // limit the tiles live one or more levels below the view zoom.
  const zt = maxNativeZoom ? Math.min(zoom, maxNativeZoom) : zoom;
  const f = Math.pow(2, zt - zoom);
  const halfW = (width + 256 + (follow ? (b.x - a.x) / 2 : 0)) * f;
  const halfH = (height + 256 + (follow ? (b.y - a.y) / 2 : 0)) * f;
  const tiles: TileCoord[] = [];
  const maxTile = 2 ** zt - 1;
  const x0 = Math.max(0, Math.floor((cx * f - halfW) / 256));
  const x1 = Math.min(maxTile, Math.floor((cx * f + halfW) / 256));
  const y0 = Math.max(0, Math.floor((cy * f - halfH) / 256));
  const y1 = Math.min(maxTile, Math.floor((cy * f + halfH) / 256));
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) tiles.push({ z: zt, x, y });
  }

  return { centerPx: { x: cx, y: cy }, zoom, tiles };
}

// --- tiny solid-color PNG writer (placeholder tiles / failed downloads) ----

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
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
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const USER_AGENT = `neo2-flightpath/${VERSION} (flight-path map renderer; https://github.com/MrManny/neo2-flightpath)`;

function tileCachePath(cacheDir: string, style: StyleName, t: TileCoord): string {
  const key = TILE_SOURCES[style].cacheKey || style;
  return path.join(cacheDir, key, String(t.z), String(t.x), `${t.y}.png`);
}

function tilePlaceholderPath(
  cacheDir: string,
  style: StyleName,
  t: TileCoord,
): string {
  const key = TILE_SOURCES[style].cacheKey || style;
  return path.join(cacheDir, key, String(t.z), String(t.x), `${t.y}.placeholder.png`);
}

function tileUrl(style: StyleName, t: TileCoord): string {
  const src = TILE_SOURCES[style];
  const s = src.subdomains.length
    ? src.subdomains[(t.x + t.y) % src.subdomains.length]
    : '';
  return src.url
    .replace('{s}', s)
    .replace('{z}', String(t.z))
    .replace('{x}', String(t.x))
    .replace('{y}', String(t.y));
}

// Download missing tiles into the cache (polite: 2 concurrent, ~2.5 req/s).
// Failed tiles get a `<y>.placeholder.png` sibling (served as fallback) so the
// real tile is retried on the next run instead of being cached as missing.
export async function prefetchTiles({
  style,
  tiles,
  cacheDir,
  log = () => {},
}: {
  style: StyleName;
  tiles: TileCoord[];
  cacheDir: string;
  log?: (msg: string) => void;
}): Promise<{ downloaded: number; failed: number; total: number }> {
  const placeholder = solidPng(TILE_SOURCES[style].placeholderBg);
  const missing: Array<{ t: TileCoord; p: string }> = [];
  for (const t of tiles) {
    const p = tileCachePath(cacheDir, style, t);
    if (!fs.existsSync(p)) missing.push({ t, p });
  }
  if (missing.length === 0) return { downloaded: 0, failed: 0, total: tiles.length };
  log(`tiles: ${tiles.length} needed, ${missing.length} to download (${style})`);

  let downloaded = 0;
  let failed = 0;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < missing.length) {
      const { t, p } = missing[cursor++];
      const url = tileUrl(style, t);
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(20000),
          });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            fs.mkdirSync(path.dirname(p), { recursive: true });
            fs.writeFileSync(p, buf);
            ok = true;
          }
        } catch {
          await sleep(500);
        }
      }
      if (ok) downloaded++;
      else {
        failed++;
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(tilePlaceholderPath(cacheDir, style, t), placeholder);
      }
      await sleep(400); // <= ~2.5 requests/s across both workers
    }
  }

  await Promise.all([worker(), worker()]);
  return { downloaded, failed, total: tiles.length };
}
