// Pure URL-to-file routing shared by the render server and the app bundle:
// maps a request pathname to the resource that backs it. The route guards
// and the tile acceptance policy live here so they stay unit-testable; the
// servers only perform the I/O.

import path from 'node:path';

import type { Style } from './config.js';
import type { TileCoord } from './plan.js';
import { parseTilePathname, tilePaths } from './tilecache.js';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
};

export function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Which tile styles a route accepts: the render server serves its one
 * configured style, the app any vocabulary style (live restyle switches
 * styles without a reload).
 */
export type TilePolicy = { style: Style } | { anyStyle: true };

export interface TileRoute {
  style: Style;
  tile: TileCoord;
  filePath: string;
  placeholderPath: string;
}

export function resolveTileRoute(
  pathname: string,
  tileCache: string,
  policy: TilePolicy,
): TileRoute | null {
  const parsed = parseTilePathname(pathname);
  if (!parsed) return null;
  if (!('anyStyle' in policy) && parsed.style !== policy.style) return null;
  const paths = tilePaths(tileCache, parsed.style, parsed.tile);
  return {
    style: parsed.style,
    tile: parsed.tile,
    filePath: paths.file,
    placeholderPath: paths.placeholder,
  };
}

export interface AssetRoutes {
  /** Where the Leaflet distribution lives (node_modules). */
  leafletDir: string;
  /** The one tile style this server serves; see TilePolicy. */
  style: Style;
  tileCache: string;
  rendererDir: string;
}

export type AssetResolution =
  /** The URL belongs to one of the routes and names a file to serve. */
  | {
      kind: 'file';
      filePath: string;
      mime: string;
      /** Served when filePath is absent (missing tiles fall back to it). */
      fallbackPath?: string;
    }
  /** The URL belongs to one of the routes but names no servable resource. */
  | { kind: 'missing' }
  /** The URL is not one of these routes; the caller routes it. */
  | { kind: 'unrouted' };

// Serves /leaflet/*, /tiles/* and /renderer/*: the whitelist guards decide
// what may be served, and every /tiles/ URL is claimed (missing tiles are the
// caller's 404).
export function resolveAsset(
  url: string,
  routes: AssetRoutes,
): AssetResolution {
  if (url.startsWith('/leaflet/')) {
    const rel = url.slice('/leaflet/'.length);
    if (!/^(leaflet\.(js|css|js\.map|css\.map)|images\/[a-z0-9_-]+\.png)$/.test(rel)) {
      return { kind: 'missing' };
    }
    return fileResolution(path.join(routes.leafletDir, rel));
  }
  if (url.startsWith('/tiles/')) {
    const tile = resolveTileRoute(url, routes.tileCache, { style: routes.style });
    return tile
      ? {
          kind: 'file',
          filePath: tile.filePath,
          fallbackPath: tile.placeholderPath,
          mime: mimeFor(tile.filePath),
        }
      : { kind: 'missing' };
  }
  if (url.startsWith('/renderer/')) {
    const rel = url.slice('/renderer/'.length);
    if (!/^[a-z0-9_-]+\.js$/.test(rel)) return { kind: 'missing' };
    return fileResolution(path.join(routes.rendererDir, rel));
  }
  return { kind: 'unrouted' };
}

function fileResolution(filePath: string): AssetResolution {
  return { kind: 'file', filePath, mime: mimeFor(filePath) };
}
