// Static assets and video streaming shared by the headless render server and
// the app's session server.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';

import type { Style } from './config.js';
import { rangePlan } from './range.js';
import { parseTilePathname, tilePaths } from './tiles.js';

const require_ = createRequire(import.meta.url);
const LEAFLET_DIR = path.dirname(require_.resolve('leaflet/dist/leaflet.js'));

/** Compiled shared renderer modules, served to generated pages as ESM. */
export const RENDERER_DIR = fileURLToPath(new URL('./renderer/', import.meta.url));

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

export interface AssetRoutes {
  style: Style;
  tileCache: string;
  rendererDir: string;
}

// Serves /leaflet/*, /tiles/* and /renderer/* from disk (missing tiles fall
// back to their placeholder). Writes the response and returns true when the
// URL belongs to one of those routes; callers route everything else
// themselves.
export function serveAsset(
  url: string,
  res: http.ServerResponse,
  routes: AssetRoutes,
): boolean {
  let file: string | null = null;
  if (url.startsWith('/leaflet/')) {
    const rel = url.slice('/leaflet/'.length);
    if (/^(leaflet\.(js|css|js\.map|css\.map)|images\/[a-z0-9_-]+\.png)$/.test(rel)) {
      file = path.join(LEAFLET_DIR, rel);
    }
  } else if (url.startsWith('/tiles/')) {
    const parsed = parseTilePathname(url);
    if (parsed && parsed.style === routes.style) {
      const paths = tilePaths(routes.tileCache, parsed.style, parsed.tile);
      file = paths.file;
      if (!fs.existsSync(file) && fs.existsSync(paths.placeholder)) file = paths.placeholder;
    }
  } else if (url.startsWith('/renderer/')) {
    const rel = url.slice('/renderer/'.length);
    if (/^[a-z0-9_-]+\.js$/.test(rel)) {
      file = path.join(routes.rendererDir, rel);
    }
  } else {
    return false;
  }
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    });
    res.end(fs.readFileSync(file));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
  return true;
}

// Streams a file with HTTP Range support so the <video> element can seek.
// The returned promise resolves once the file handle is released, so callers
// can order file cleanup after the stream.
export function serveFileWithRange(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
): Promise<void> {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return Promise.resolve();
  }
  const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const plan = rangePlan(req.headers['range'], size, mime);
  res.writeHead(plan.status, plan.headers);
  if (plan.status === 416) {
    res.end(plan.body);
    return Promise.resolve();
  }
  if (req.method === 'HEAD') {
    res.end();
    return Promise.resolve();
  }
  const stream =
    plan.status === 206
      ? fs.createReadStream(filePath, { start: plan.span.start, end: plan.span.end })
      : fs.createReadStream(filePath);
  // pipeline tears the read stream down when the client aborts (every video
  // seek does), so the file handle is released and the promise settles.
  return new Promise<void>((resolve) => {
    pipeline(stream, res, () => resolve());
  });
}
