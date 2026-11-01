// The polite tile download policy in one home: every request start - retries
// included - is spaced REQUEST_INTERVAL_MS apart (2.0 req/s) and at most
// DOWNLOAD_WORKERS downloads run at once, whichever entry point drives them.
// prefetchTiles (batch pre-warm) and createTileFetcher (live restyle) are
// thin wrappers whose queue strategies only decide ordering and sharing.

import fs from 'node:fs';
import path from 'node:path';

import type { Style } from './config.js';
import type { TileCoord } from './plan.js';
import { solidPng } from './png.js';
import { tilePaths } from './tilecache.js';
import { TILE_SOURCES } from './renderer/tilesources.js';
import { VERSION } from './version.js';

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

/** Supplies the solid placeholder PNG for a style's failed downloads. */
export type PlaceholderSource = (style: Style) => Buffer;

// Placeholder PNGs are pure derivations of the tile source's background
// color; memoizing per downloader keeps repeat failures cheap without any
// module-level mutable state.
function createPlaceholderSource(): PlaceholderSource {
  const cache = new Map<Style, Buffer>();
  return (style) => {
    let png = cache.get(style);
    if (!png) {
      png = solidPng(TILE_SOURCES[style].placeholderBg);
      cache.set(style, png);
    }
    return png;
  };
}

export type TileStatus = 'cached' | 'downloaded' | 'failed';

export interface TileFetchResult {
  /** The file to serve: the real tile, or its placeholder after a failure. */
  file: string;
  status: TileStatus;
}

interface FetchContext {
  cacheDir: string;
  acquire: RequestGate;
  placeholderPng: PlaceholderSource;
}

// The full cache dance for one tile: hit, download, or placeholder. The
// placeholder is served as a fallback so a missing tile is retried on a later
// run instead of being cached as missing.
async function fetchTileToCache(
  ctx: FetchContext,
  style: Style,
  tile: TileCoord,
): Promise<TileFetchResult> {
  const paths = tilePaths(ctx.cacheDir, style, tile);
  if (fs.existsSync(paths.file)) return { file: paths.file, status: 'cached' };
  if (await downloadTile(tileUrl(style, tile), paths.file, ctx.acquire)) {
    return { file: paths.file, status: 'downloaded' };
  }
  fs.mkdirSync(path.dirname(paths.placeholder), { recursive: true });
  fs.writeFileSync(paths.placeholder, ctx.placeholderPng(style));
  return { file: paths.placeholder, status: 'failed' };
}

/**
 * How the downloader orders and shares queued work: `batch` appends jobs and
 * runs each tile once (the pre-warm), `live` serves the newest requests first
 * - a style flip or zoom change makes the previous viewport stale, and those
 * tiles can wait behind what the user is looking at now - and shares one
 * download per tile between concurrent callers.
 */
export type TileQueueStrategy = 'batch' | 'live';

export interface TileDownloader {
  /** Queues one tile; resolves with the file to serve (real or placeholder). */
  enqueue(style: Style, tile: TileCoord): Promise<TileFetchResult>;
}

export function createTileDownloader(
  cacheDir: string,
  strategy: TileQueueStrategy,
  placeholderPng: PlaceholderSource = createPlaceholderSource(),
): TileDownloader {
  const ctx: FetchContext = {
    cacheDir,
    acquire: createRequestGate(),
    placeholderPng,
  };
  const inFlight = new Map<string, Promise<TileFetchResult>>();
  const queue: QueuedTile[] = [];
  let active = 0;

  function pump(): void {
    while (active < DOWNLOAD_WORKERS) {
      const job: QueuedTile | undefined = queue.shift();
      if (!job) break;
      active++;
      void (async () => {
        try {
          job.settle(await fetchTileToCache(ctx, job.style, job.tile));
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
    enqueue(style, tile): Promise<TileFetchResult> {
      const key = tilePaths(cacheDir, style, tile).file;
      const shared = strategy === 'live' ? inFlight.get(key) : undefined;
      if (shared) return shared;
      const task = new Promise<TileFetchResult>((resolve, reject) => {
        const job: QueuedTile = { style, tile, settle: resolve, fail: reject };
        if (strategy === 'live') queue.unshift(job);
        else queue.push(job);
        pump();
      });
      if (strategy === 'live') {
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

interface QueuedTile {
  style: Style;
  tile: TileCoord;
  settle: (result: TileFetchResult) => void;
  fail: (error: unknown) => void;
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
  const missing: TileCoord[] = [];
  for (const tile of tiles) {
    if (fs.existsSync(tilePaths(cacheDir, style, tile).file)) onTile('cached');
    else missing.push(tile);
  }
  if (missing.length === 0) {
    return { downloaded: 0, failed: 0, total: tiles.length };
  }
  log(`tiles: ${tiles.length} needed, ${missing.length} to download (${style})`);

  const downloader = createTileDownloader(cacheDir, 'batch');
  let downloaded = 0;
  let failed = 0;
  await Promise.all(
    missing.map((tile) =>
      downloader.enqueue(style, tile).then((result) => {
        if (result.status === 'downloaded') downloaded++;
        else if (result.status === 'failed') failed++;
        onTile(result.status);
      }),
    ),
  );
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
  const downloader = createTileDownloader(cacheDir, 'live');
  return {
    ensure(style, tile): Promise<string> {
      return downloader.enqueue(style, tile).then((result) => result.file);
    },
  };
}
