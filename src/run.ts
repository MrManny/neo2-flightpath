// run.ts - per-recording render pipeline and batch orchestration.

import fs from 'node:fs';
import path from 'node:path';

import { errorMessage } from './errors.js';
import { unproject } from './geo.js';
import type { Bbox } from './geo.js';
import { outputMatchesSource, probeVideo, verifyOutput } from './ff.js';
import type { VideoProbe } from './ff.js';
import { loadTelemetry } from './telemetry.js';
import type { Telemetry } from './telemetry.js';
import { TILE_SOURCES, computeOverview, prefetchTiles } from './tiles.js';
import type { Overview, PrefetchStats } from './tiles.js';
import { buildPageHtml } from './page.js';
import { renderVideo } from './render.js';
import type { HudSpec, RenderConfig } from './config.js';
import { NOOP_TRACER, stage } from './tracing.js';
import type { TraceContext } from './tracing.js';

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

export interface BatchResult {
  ok: number;
  skipped: number;
  failed: number;
}

// Output path for one video: <outDir>/<basename><suffix>.mp4, or beside the
// source when no outDir is configured.
// tell me why, ain't nothin' but a mistake
export function outputPathFor(videoPath: string, config: RenderConfig): string {
  const base = path.basename(videoPath).replace(/\.[^.]+$/, '');
  const name = `${base}${config.outSuffix}.mp4`;
  return config.outDir
    ? path.join(config.outDir, name)
    : path.join(path.dirname(videoPath), name);
}

// Assign every video a unique output path. Recordings with the same basename
// from different folders would otherwise overwrite each other in a shared
// --out-dir; colliding names get a deterministic -2, -3, ... suffix.
export interface PlannedOutput {
  out: string;
  /** The plain path this run deviates from when a collision forced a suffix. */
  plain: string;
}

export function planOutputs(videos: string[], config: RenderConfig): PlannedOutput[] {
  const used = new Set<string>();
  return videos.map((video) => {
    const plain = outputPathFor(video, config);
    const key = plain.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return { out: plain, plain };
    }
    const ext = path.extname(plain);
    const stem = path.basename(plain, ext);
    for (let n = 2; ; n++) {
      const cand = path.join(path.dirname(plain), `${stem}-${n}${ext}`);
      const candKey = cand.toLowerCase();
      if (!used.has(candKey)) {
        used.add(candKey);
        return { out: cand, plain };
      }
    }
  });
}

// --- pipeline stages --------------------------------------------------------

interface IntroOutroFrames {
  introN: number;
  outroN: number;
}

// Intro/outro zoom timing (frames); clamp for very short clips.
function planIntroOutroFrames(
  config: RenderConfig,
  probe: VideoProbe,
  log: LogFn,
): IntroOutroFrames {
  let introN = Math.max(0, Math.round(config.introSec * probe.fps.value));
  let outroN = Math.max(0, Math.round(config.outroSec * probe.fps.value));
  const budget = Math.max(2, Math.floor(probe.frames / 2));
  if (introN + outroN > budget) {
    const scale = budget / (introN + outroN);
    introN = Math.floor(introN * scale);
    outroN = Math.floor(outroN * scale);
    log(`intro/outro shortened to ${introN}/${outroN} frames for this clip`);
  }
  return { introN, outroN };
}

// HUD sanity: drop chips whose data does not exist for this source.
function resolveHud(config: RenderConfig, tel: Telemetry, log: LogFn): HudSpec {
  const hud: HudSpec = { ...config.hud };
  const hasAltitude = tel.frames.some((f) => f.alt !== null);
  if (hud.alt && !hasAltitude) {
    hud.alt = false;
    log('hud: altitude unavailable in this telemetry source (chip disabled)');
  }
  return hud;
}

// The per-frame telemetry as parallel arrays, as the page script expects them.
function frameArrays(tel: Telemetry): {
  lat: number[];
  lon: number[];
  alt: (number | null)[];
  speed: (number | null)[];
  headingDeg: number[];
} {
  return {
    lat: tel.frames.map((f) => f.lat as number),
    lon: tel.frames.map((f) => f.lon as number),
    alt: tel.frames.map((f) => f.alt),
    speed: tel.frames.map((f) => f.speed),
    headingDeg: tel.frames.map((f) => f.headingDeg),
  };
}

function describeView(
  config: RenderConfig,
  overview: Overview,
  tilesLabel: string,
): string {
  const zoomNote = config.zoom
    ? ' (fixed)'
    : config.zoomOut
      ? ` (-${config.zoomOut})`
      : '';
  return (
    `view: ${config.view} at zoom ${overview.zoom}${zoomNote}, ` +
    `${overview.tiles.length} tiles (${tilesLabel})`
  );
}

// Never leave a broken or partial render behind: on any failure the output
// this run wrote is deleted (a pre-existing file we did not touch stays).
function removePartialOutput(
  outPath: string,
  mtimeBefore: number | null,
  log: LogFn,
): void {
  const mtimeNow = fs.existsSync(outPath)
    ? fs.statSync(outPath).mtimeMs
    : null;
  if (mtimeNow !== null && (mtimeBefore === null || mtimeNow !== mtimeBefore)) {
    fs.rmSync(outPath, { force: true });
    log(`removed partial output: ${outPath}`);
  }
}

async function renderWithOutputCleanup(
  outPath: string,
  log: LogFn,
  render: () => Promise<void>,
): Promise<void> {
  const mtimeBefore = fs.existsSync(outPath)
    ? fs.statSync(outPath).mtimeMs
    : null;
  try {
    await render();
  } catch (e) {
    removePartialOutput(outPath, mtimeBefore, log);
    throw e;
  }
}

// --- per-recording pipeline -------------------------------------------------

// The pipeline's I/O shell, injectable so tests can drive the span tree
// without ffprobe, network or a browser.
export interface PipelineDeps {
  probeVideo: typeof probeVideo;
  loadTelemetry: typeof loadTelemetry;
  prefetchTiles: typeof prefetchTiles;
  renderVideo: typeof renderVideo;
  verifyOutput: typeof verifyOutput;
  outputMatchesSource: typeof outputMatchesSource;
}

const realDeps: PipelineDeps = {
  probeVideo,
  loadTelemetry,
  prefetchTiles,
  renderVideo,
  verifyOutput,
  outputMatchesSource,
};

export interface PipelineOptions {
  /** The pipeline's I/O shell; defaults to the real one. */
  deps?: PipelineDeps;
  trace?: TraceContext;
}

interface RenderContext {
  videoPath: string;
  outPath: string;
  config: RenderConfig;
  log: LogFn;
  probe: VideoProbe;
  tel: Telemetry;
  hud: HudSpec;
  introOutro: IntroOutroFrames;
  overview: Overview;
  center: { lat: number; lon: number };
  tileStats: PrefetchStats;
  width: number;
  height: number;
}

function buildOkSummary(ctx: RenderContext, elapsedSec: number): RecordingSummary {
  const { config, probe, tel, hud, introOutro, overview, tileStats } = ctx;
  return {
    video: ctx.videoPath,
    out: ctx.outPath,
    status: 'ok',
    width: ctx.width,
    height: ctx.height,
    style: config.style,
    view: config.view,
    introFrames: introOutro.introN,
    outroFrames: introOutro.outroN,
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
    zoom: overview.zoom,
    zoomFixed: config.zoom > 0,
    zoomOut: config.zoom > 0 ? 0 : config.zoomOut,
    tilesDownloaded: tileStats.downloaded,
    verified: true,
    elapsedSec,
  };
}

// Render one recording. Throws on failure (the caller decides policy).
// outPath may be pre-planned by runBatch (collision-free); it defaults to the
// plain output path for direct callers. One trace per recording: the root span
// wraps the pipeline stages below.
export async function processRecording(
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
  outPath: string = outputPathFor(videoPath, config),
  options: PipelineOptions = {},
): Promise<RecordingSummary> {
  const t0 = Date.now();
  const tracer = options.trace?.tracer ?? NOOP_TRACER;
  const deps = options.deps ?? realDeps;

  const width = Math.max(64, 2 * Math.floor(config.width / 2));
  const height = Math.max(64, 2 * Math.floor(config.height / 2));

  return stage(
    tracer,
    'recording.process',
    options.trace?.parent,
    {
      'source.file.name': path.basename(videoPath),
      'canvas.width': width,
      'canvas.height': height,
      'map.style': config.style,
      'map.view': config.view,
    },
    async (root) => {
      const probe = await stage(tracer, 'probe', root, {}, () =>
        deps.probeVideo(videoPath, log),
      );
      root.setAttribute('source.frames', probe.frames);
      root.setAttribute('source.fps', probe.fps.value);
      log(
        `source: ${path.basename(videoPath)}  ${probe.width}x${probe.height} @ ${probe.fps.str} fps, ${probe.frames} frames`,
      );
      const introOutro = planIntroOutroFrames(config, probe, log);

      const tel = await stage(tracer, 'telemetry.load', root, {}, async (span) => {
        const loaded = await deps.loadTelemetry(videoPath, {
          frames: probe.frames,
          fpsValue: probe.fps.value,
          durationSec: probe.durationSec,
        });
        span.setAttributes({
          'telemetry.source': loaded.source,
          'telemetry.method': loaded.method,
          'telemetry.fix.count': loaded.sampleCount - loaded.noLock,
          'telemetry.noLock.count': loaded.noLock,
        });
        return loaded;
      });
      root.setAttribute('telemetry.source', tel.source);
      log(
        `telemetry: ${tel.source} (${tel.method}), ${tel.sampleCount} fixes, heading=${tel.headingMode}, ` +
          `track ${Math.round(tel.trackDistanceM)} m${tel.noLock ? `, ${tel.noLock} no-lock cues` : ''}`,
      );
      const hud = resolveHud(config, tel, log);

      const tileSource = TILE_SOURCES[config.style];
      const overview = await stage(tracer, 'plan', root, { 'plan.view': config.view }, async (span) => {
        const computed = computeOverview({
          bbox: tel.bbox,
          width,
          height,
          maxZoom: tileSource.maxZoom || 19,
          maxNativeZoom: tileSource.maxNativeZoom || null,
          zoomOut: config.zoomOut,
          zoomOverride: config.zoom,
          follow: config.view === 'follow',
        });
        span.setAttributes({
          'plan.zoom': computed.zoom,
          'plan.zoomOut': config.zoom > 0 ? 0 : config.zoomOut,
          'plan.tile.count': computed.tiles.length,
        });
        return computed;
      });
      const center = unproject(overview.centerPx.x, overview.centerPx.y, overview.zoom);
      log(describeView(config, overview, config.style));

      const tileStats = await stage(tracer, 'tiles.prefetch', root, {}, async (span) => {
        const stats = await deps.prefetchTiles({
          style: config.style,
          tiles: overview.tiles,
          cacheDir: config.tileCache,
          log,
        });
        span.setAttributes({
          'tiles.total': stats.total,
          'tiles.downloaded': stats.downloaded,
          'tiles.cached': stats.total - stats.downloaded - stats.failed,
          'tiles.failed': stats.failed,
        });
        return stats;
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
        zoom: overview.zoom,
        attribution: tileSource.attribution,
        introN: introOutro.introN,
        outroN: introOutro.outroN,
        trail: config.trail,
        ...frameArrays(tel),
        hud,
      });

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      await renderWithOutputCleanup(outPath, log, async () => {
        await deps.renderVideo({
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
          trace: { tracer, parent: root },
        });

        await stage(tracer, 'output.verify', root, {}, async (span) => {
          const verify = await deps.verifyOutput(outPath, probe.frames, probe.fps.value);
          span.setAttributes({
            'verify.frames.expected': probe.frames,
            'verify.frames.actual': verify.frames,
            'verify.fps.expected': probe.fps.str,
            'verify.fps.actual': verify.fps ?? 'unknown',
            'verify.ok': verify.ok,
          });
          if (!verify.ok) {
            throw new Error(
              `output verification failed: got ${verify.frames} frames @ ${verify.fps}, ` +
                `expected ${probe.frames} @ ${probe.fps.str}`,
            );
          }
        });
        log('verified: frame count and frame rate match the source');
      });

      return buildOkSummary(
        {
          videoPath,
          outPath,
          config,
          log,
          probe,
          tel,
          hud,
          introOutro,
          overview,
          center,
          tileStats,
          width,
          height,
        },
        Math.round((Date.now() - t0) / 1000),
      );
    },
  );
}

// --- batch orchestration ----------------------------------------------------

// Run the pipeline for every recording; failures never abort the batch.
export async function runBatch(
  videos: string[],
  config: RenderConfig,
  log: LogFn,
  emit: (summary: RecordingSummary) => void,
  options: PipelineOptions = {},
): Promise<BatchResult> {
  const result: BatchResult = { ok: 0, skipped: 0, failed: 0 };
  const deps = options.deps ?? realDeps;

  // Collision-free outputs up front: two same-basename recordings must not
  // silently overwrite each other in a shared --out-dir.
  const plans = planOutputs(videos, config);

  for (const [idx, video] of videos.entries()) {
    const base = path.basename(video);
    log(`=== ${base} ===`);

    const plan = plans[idx];
    if (plan.out !== plan.plain) {
      log(
        `warning: output name collision for ${base} - writing ${path.basename(plan.out)} instead`,
      );
    }
    if (config.skipExisting && (await deps.outputMatchesSource(video, plan.out))) {
      log(`SKIP  ${plan.out}  (exists and matches the source)`);
      emit({ video, out: plan.out, status: 'skipped', elapsedSec: 0 });
      result.skipped++;
      continue;
    }

    try {
      const summary = await processRecording(video, config, log, plan.out, {
        ...options,
        deps,
      });
      emit(summary);
      log(`OK  ${plan.out}  (${summary.frames} frames @ ${summary.fps}, ${summary.elapsedSec} s)`);
      result.ok++;
    } catch (e) {
      const message = errorMessage(e);
      log(`ERROR  ${base}: ${message}`);
      emit({
        video,
        out: plan.out,
        status: 'error',
        elapsedSec: 0,
        error: message,
      });
      result.failed++;
    }
  }

  return result;
}
