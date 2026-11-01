// Static assets and video streaming shared by the headless render server and
// the app's session server. URL routing and its guards live in src/assets.ts;
// this shell performs the I/O and writes the resolved result.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pipeline } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { mimeFor, resolveAsset } from './assets.js';
import type { AssetRoutes } from './assets.js';
import { rangePlan } from './range.js';

const require_ = createRequire(import.meta.url);
const LEAFLET_DIR = path.dirname(require_.resolve('leaflet/dist/leaflet.js'));

/** Compiled shared renderer modules, served to generated pages as ESM. */
export const RENDERER_DIR = fileURLToPath(new URL('./renderer/', import.meta.url));

/** The served roots callers configure; Leaflet ships with the app. */
export type ServeRoutes = Omit<AssetRoutes, 'leafletDir'>;

// Writes the shared router's result: the routed file (or its placeholder
// fallback) with its mime, or a 404 for a claimed URL without a file.
// Returns true when the URL belongs to one of the routes; callers route
// everything else themselves.
export function serveAsset(
  url: string,
  res: http.ServerResponse,
  routes: ServeRoutes,
): boolean {
  const asset = resolveAsset(url, { ...routes, leafletDir: LEAFLET_DIR });
  if (asset.kind === 'unrouted') return false;
  if (asset.kind === 'file') {
    let file = asset.filePath;
    if (!fs.existsSync(file) && asset.fallbackPath && fs.existsSync(asset.fallbackPath)) {
      file = asset.fallbackPath;
    }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': asset.mime });
      res.end(fs.readFileSync(file));
      return true;
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
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
  const mime = mimeFor(filePath);
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
