// Pure routing for the app's custom-scheme server: maps a request pathname to
// the resource that backs it. The Electron glue performs the I/O; the
// path-traversal guard lives here so it stays unit-testable.

import path from 'node:path';

import { MEDIA_PATH } from './apppaths.js';
import type { Style } from './config.js';
import type { TileCoord } from './plan.js';
import { MIME } from './serve.js';
import { parseTilePathname, tilePaths } from './tiles.js';

export interface AppRoutes {
  /** Next.js static export root (ui/out), possibly inside app.asar. */
  exportRoot: string;
  tileCache: string;
  /** Absolute path of the loaded recording, or null when none is loaded. */
  videoPath: string | null;
}

export type AppAsset =
  | { kind: 'export'; filePath: string; mime: string }
  | { kind: 'video'; filePath: string }
  | {
      kind: 'tile';
      filePath: string;
      placeholderPath: string;
      style: Style;
      tile: TileCoord;
    }
  | { kind: 'not-found' };

/** Resolves an already-decoded URL pathname (e.g. "/index.html"). */
export function resolveAppAsset(pathname: string, routes: AppRoutes): AppAsset {
  if (pathname === MEDIA_PATH) {
    return routes.videoPath
      ? { kind: 'video', filePath: routes.videoPath }
      : { kind: 'not-found' };
  }

  // Every known style routes into the shared cache: live restyle switches
  // styles without a reload, so no single style owns the tile route. The
  // parser only returns vocabulary styles; anything else is not a tile.
  const parsed = parseTilePathname(pathname);
  if (parsed) {
    const paths = tilePaths(routes.tileCache, parsed.style, parsed.tile);
    return {
      kind: 'tile',
      filePath: paths.file,
      placeholderPath: paths.placeholder,
      style: parsed.style,
      tile: parsed.tile,
    };
  }

  return exportFile(pathname, routes.exportRoot);
}

function exportFile(pathname: string, exportRoot: string): AppAsset {
  let rel = pathname.replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  // URL pathnames are POSIX-style; a drive prefix or backslash marks a
  // Windows-flavored path that POSIX resolution would mistake for a plain
  // file name. Refuse it outright so the guard behaves the same on every OS.
  if (rel.split('/').some((s) => s.includes('\\') || /^[a-zA-Z]:/.test(s))) {
    return { kind: 'not-found' };
  }
  const filePath = path.resolve(exportRoot, rel);
  const relCheck = path.relative(exportRoot, filePath);
  if (relCheck === '' || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
    return { kind: 'not-found' };
  }
  return {
    kind: 'export',
    filePath,
    mime: MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  };
}
