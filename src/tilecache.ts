// The one tile cache layout and tile URL parsing, shared by the prefetcher,
// the render server and the app server so they can never disagree about
// where a tile lives or which URLs are tiles at all.

import path from 'node:path';

import type { Style } from './config.js';
import type { TileCoord } from './plan.js';
import { TILE_SOURCES } from './renderer/tilesources.js';

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
