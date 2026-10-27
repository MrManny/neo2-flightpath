// run.ts - per-recording render pipeline and batch orchestration.

import fs from 'node:fs';
import path from 'node:path';

import { unproject } from './geo.js';
import type { Bbox } from './geo.js';
import { outputMatchesSource, probeVideo, verifyOutput } from './ff.js';
import { loadTelemetry } from './telemetry.js';
import { TILE_SOURCES, computeOverview, prefetchTiles } from './tiles.js';
import { buildPageHtml } from './page.js';
import { renderVideo } from './render.js';
import type { HudSpec, RenderConfig } from './config.js';

export type LogFn = (msg: string) => void;

export interface RecordingSummary {
  video: string;
  out: string;
  status: 'ok' | 'skipped' | 'error';
  width?: number;
  height?: number;
  style?: string;
  view?: string;
  introFrames?: number;
  outroFrames?: number;
  hud?: HudSpec;
  source?: string;
  method?: string;
  headingMode?: string;
  fixes?: number;
  noLock?: number;
  frames?: number;
  fps?: string;
  trackDistanceM?: number;
  bbox?: Bbox;
  zoom?: number;
  zoomFixed?: boolean;
  zoomOut?: number;
  tilesDownloaded?: number;
  verified?: boolean;
  elapsedSec: number;
  error?: string;
}

// Output path for one video: <outDir>/<basename><suffix>.mp4, or beside the
// source when no outDir is configured.
export function outputPathFor(videoPath: string, config: RenderConfig): string {
  const base = path.basename(videoPath).replace(/\.[^.]+$/, '');
  const name = `${base}${config.outSuffix}.mp4`;
  return config.outDir
    ? path.join(config.outDir, name)
    : path.join(path.dirname(videoPath), name);
}

// Render one recording. Throws on failure (the caller decides policy).
export async function processRecording(
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
): Promise<RecordingSummary> {
  const t0 = Date.now();

  const width = Math.max(64, 2 * Math.floor(config.width / 2));
  const height = Math.max(64, 2 * Math.floor(config.height / 2));

  const probe = await probeVideo(videoPath, log);
  log(
    `source: ${path.basename(videoPath)}  ${probe.width}x${probe.height} @ ${probe.fps.str} fps, ${probe.frames} frames`,
  );

  // Intro/outro zoom timing (frames); clamp for very short clips.
  let introN = Math.max(0, Math.round(config.introSec * probe.fps.value));
  let outroN = Math.max(0, Math.round(config.outroSec * probe.fps.value));
  const budget = Math.max(2, Math.floor(probe.frames / 2));
  if (introN + outroN > budget) {
    const f = budget / (introN + outroN);
    introN = Math.floor(introN * f);
    outroN = Math.floor(outroN * f);
    log(`intro/outro shortened to ${introN}/${outroN} frames for this clip`);
  }

  const tel = await loadTelemetry(videoPath, {
    frames: probe.frames,
    fpsValue: probe.fps.value,
    durationSec: probe.durationSec,
  });
  log(
    `telemetry: ${tel.source} (${tel.method}), ${tel.sampleCount} fixes, heading=${tel.headingMode}, ` +
      `track ${Math.round(tel.trackDistanceM)} m${tel.noLock ? `, ${tel.noLock} no-lock cues` : ''}`,
  );

  // HUD sanity: drop chips whose data does not exist for this source.
  const hud: HudSpec = { ...config.hud };
  const hasAlt = tel.frames.some((f) => f.alt !== null && f.alt !== undefined);
  if (hud.alt && !hasAlt) {
    hud.alt = false;
    log('hud: altitude unavailable in this telemetry source (chip disabled)');
  }

  const { centerPx, zoom, tiles } = computeOverview({
    bbox: tel.bbox,
    width,
    height,
    maxZoom: TILE_SOURCES[config.style].maxZoom || 19,
    maxNativeZoom: TILE_SOURCES[config.style].maxNativeZoom || null,
    zoomOut: config.zoomOut,
    zoomOverride: config.zoom,
    follow: config.view === 'follow',
  });
  const center = unproject(centerPx.x, centerPx.y, zoom);
  log(
    `view: ${config.view} at zoom ${zoom}${config.zoom ? ' (fixed)' : config.zoomOut ? ` (-${config.zoomOut})` : ''}, ` +
      `${tiles.length} tiles (${config.style})`,
  );

  const tileStats = await prefetchTiles({
    style: config.style,
    tiles,
    cacheDir: config.tileCache,
    log,
  });
  if (tileStats.downloaded) {
    log(`tiles: ${tileStats.downloaded} downloaded, ${tileStats.failed} placeholders`);
  }

  const html = buildPageHtml({
    width,
    height,
    style: config.style,
    view: config.view,
    center,
    zoom,
    attribution: TILE_SOURCES[config.style].attribution,
    introN,
    outroN,
    trail: config.trail,
    lat: tel.frames.map((f) => f.lat as number),
    lon: tel.frames.map((f) => f.lon as number),
    alt: tel.frames.map((f) => f.alt),
    speed: tel.frames.map((f) => f.speed),
    headingDeg: tel.frames.map((f) => f.headingDeg),
    hud,
  });

  const outPath = outputPathFor(videoPath, config);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  await renderVideo({
    html,
    capture: config.capture,
    preset: config.preset,
    style: config.style,
    tileCache: config.tileCache,
    width,
    height,
    frames: probe.frames,
    fpsStr: probe.fps.str,
    workers: config.workers,
    outPath,
    browserPath: config.browser,
    log,
  });

  const verify = await verifyOutput(outPath, probe.frames, probe.fps.value);
  if (!verify.ok) {
    throw new Error(
      `output verification failed: got ${verify.frames} frames @ ${verify.fps}, ` +
        `expected ${probe.frames} @ ${probe.fps.str}`,
    );
  }
  log('verified: frame count and frame rate match the source');

  return {
    video: videoPath,
    out: outPath,
    status: 'ok',
    width,
    height,
    style: config.style,
    view: config.view,
    introFrames: introN,
    outroFrames: outroN,
    hud,
    source: tel.source,
    method: tel.method,
    headingMode: tel.headingMode,
    fixes: tel.sampleCount,
    noLock: tel.noLock,
    frames: probe.frames,
    fps: probe.fps.str,
    trackDistanceM: Math.round(tel.trackDistanceM),
    bbox: tel.bbox,
    zoom,
    zoomFixed: config.zoom > 0,
    zoomOut: config.zoom > 0 ? 0 : config.zoomOut,
    tilesDownloaded: tileStats.downloaded,
    verified: true,
    elapsedSec: Math.round((Date.now() - t0) / 1000),
  };
}

// Run the pipeline for every recording; failures never abort the batch.
export async function runBatch(
  videos: string[],
  config: RenderConfig,
  log: LogFn,
  emit: (summary: RecordingSummary) => void,
): Promise<{ ok: number; skipped: number; failed: number }> {
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const video of videos) {
    const base = path.basename(video);
    log(`=== ${base} ===`);

    const out = outputPathFor(video, config);
    if (config.skipExisting && (await outputMatchesSource(video, out))) {
      log(`SKIP  ${out}  (exists and matches the source)`);
      emit({ video, out, status: 'skipped', elapsedSec: 0 });
      skipped++;
      continue;
    }

    try {
      const summary = await processRecording(video, config, log);
      emit(summary);
      log(`OK  ${out}  (${summary.frames} frames @ ${summary.fps}, ${summary.elapsedSec} s)`);
      ok++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`ERROR  ${base}: ${message}`);
      emit({
        video,
        out,
        status: 'error',
        elapsedSec: 0,
        error: message,
      });
      failed++;
    }
  }

  return { ok, skipped, failed };
}
