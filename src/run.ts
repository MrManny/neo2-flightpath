import fs from 'node:fs';
import path from 'node:path';

import { errorMessage } from './errors.js';
import type { Bbox } from './geo.js';
import { outputMatchesSource, probeVideo, verifyOutput } from './ff.js';
import type { VideoProbe } from './ff.js';
import { videoBaseName } from './inputs.js';
import { loadTelemetry } from './telemetry.js';
import type { Telemetry } from './telemetry.js';
import { prefetchTiles } from './tiles.js';
import type { PrefetchStats } from './tiles.js';
import { planIntroOutroFrames, planView } from './plan.js';
import type { IntroOutroFrames, Overview } from './plan.js';
import { buildPageHtml, planPageOpts } from './page.js';
import type { PageOpts } from './page.js';
import { renderVideo } from './render.js';
import type { FrameRange, HudSpec, RenderConfig } from './config.js';
import {
  assertValidFrameRange,
  effectiveZoomOut,
  hasAltitude,
  resolveHudSpec,
} from './config.js';
import {
  fixesLabel,
  noLockCuesLabel,
  telemetrySummary,
  trackDistanceLabel,
} from './summary.js';
import { NOOP_TRACER, stage } from './tracing.js';
import type { Span, Tracer, TraceContext } from './tracing.js';

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
  /** Set when the export covered a source-frame segment instead of everything. */
  frameRange?: FrameRange;
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

export function outputPathFor(videoPath: string, config: RenderConfig): string {
  const base = videoBaseName(videoPath);
  const name = `${base}${config.outSuffix}.mp4`;
  return config.outDir
    ? path.join(config.outDir, name)
    : path.join(path.dirname(videoPath), name);
}

// Recordings with the same basename from different folders would otherwise
// overwrite each other in a shared --out-dir; colliding names get a
// deterministic -2, -3, ... suffix.
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

// HUD sanity: drop chips whose data does not exist for this source.
function resolveHud(config: RenderConfig, tel: Telemetry, log: LogFn): HudSpec {
  const hud = resolveHudSpec(config.hud, hasAltitude(tel.frames.map((f) => f.alt)));
  if (config.hud.alt && !hud.alt) {
    log('hud: altitude unavailable in this telemetry source (chip disabled)');
  }
  return hud;
}

// The page script expects per-frame telemetry as parallel arrays.
export interface FrameArrays {
  lat: number[];
  lon: number[];
  alt: (number | null)[];
  speed: (number | null)[];
  headingDeg: number[];
}

export function frameArrays(tel: Telemetry): FrameArrays {
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

function mtimeOf(outPath: string): number | null {
  return fs.existsSync(outPath) ? fs.statSync(outPath).mtimeMs : null;
}

// Never leave a broken or partial render behind: on any failure the output
// this run wrote is deleted (a pre-existing file we did not touch stays).
function removePartialOutput(
  outPath: string,
  mtimeBefore: number | null,
  log: LogFn,
): void {
  const mtimeNow = mtimeOf(outPath);
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
  const mtimeBefore = mtimeOf(outPath);
  try {
    await render();
  } catch (e) {
    removePartialOutput(outPath, mtimeBefore, log);
    throw e;
  }
}

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
  deps?: PipelineDeps;
  trace?: TraceContext;
  /** Source-frame segment to render; omit for the full recording. */
  range?: FrameRange;
  /** Aborting stops the render at the next frame and cleans up the output. */
  signal?: AbortSignal;
}

// A segment export renders source frames start..end inclusive; the guard
// keeps the render and the verification honest about what the source has.
function resolveRange(
  range: FrameRange | undefined,
  frames: number,
): FrameRange | null {
  if (!range) return null;
  assertValidFrameRange(range);
  if (range.end >= frames) {
    throw new Error(
      `frame range ${range.start}-${range.end} is beyond the recording (${frames} frames)`,
    );
  }
  return range;
}

export interface PreparedRecording {
  width: number;
  height: number;
  probe: VideoProbe;
  tel: Telemetry;
  hud: HudSpec;
  introOutro: IntroOutroFrames;
  overview: Overview;
  tileStats: PrefetchStats;
  frames: FrameArrays;
}

// The preparation stages shared by the headless pipeline and the app: probe,
// telemetry, view plan, tile pre-warm. One trace context: the stages nest
// under the caller's parent span (or stand alone when none is given).
export async function prepareSession(
  videoPath: string,
  config: RenderConfig,
  log: LogFn,
  options: PipelineOptions = {},
): Promise<PreparedRecording> {
  const tracer = options.trace?.tracer ?? NOOP_TRACER;
  const deps = options.deps ?? realDeps;
  const parent = options.trace?.parent;

  const width = Math.max(64, 2 * Math.floor(config.width / 2));
  const height = Math.max(64, 2 * Math.floor(config.height / 2));

  const probe = await stage(tracer, 'probe', parent, {}, () =>
    deps.probeVideo(videoPath, log),
  );
  log(
    `source: ${path.basename(videoPath)}  ${probe.width}x${probe.height} @ ${probe.fps.str} fps, ${probe.frames} frames`,
  );
  const introOutro = planIntroOutroFrames(
    config,
    { fps: probe.fps.value, frames: probe.frames },
    log,
  );

  const tel = await stage(tracer, 'telemetry.load', parent, {}, async (span) => {
    const loaded = await deps.loadTelemetry(videoPath, {
      frames: probe.frames,
      fpsValue: probe.fps.value,
      durationSec: probe.durationSec,
    });
    span.setAttributes({
      'telemetry.source': loaded.source,
      'telemetry.method': loaded.method,
      'telemetry.fix.count': loaded.fixCount,
      'telemetry.noLock.count': loaded.noLock,
    });
    return loaded;
  });
  const summary = telemetrySummary(tel);
  log(
    `telemetry: ${summary.source} (${summary.method}), ${fixesLabel(summary.fixes)}, ` +
      `heading=${summary.headingMode}, track ${trackDistanceLabel(summary.trackDistanceM)}` +
      (summary.noLock ? `, ${noLockCuesLabel(summary.noLock)}` : ''),
  );
  const hud = resolveHud(config, tel, log);

  const overview = await stage(tracer, 'plan', parent, { 'plan.view': config.view }, async (span) => {
    const computed = planView(tel.bbox, width, height, config);
    span.setAttributes({
      'plan.zoom': computed.zoom,
      'plan.zoomOut': effectiveZoomOut(config),
      'plan.tile.count': computed.tiles.length,
    });
    return computed;
  });
  log(describeView(config, overview, config.style));

  const tileStats = await stage(tracer, 'tiles.prefetch', parent, {}, async (span) => {
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

  const frames = frameArrays(tel);

  return {
    width,
    height,
    probe,
    tel,
    hud,
    introOutro,
    overview,
    tileStats,
    frames,
  };
}

// Maps a prepared recording onto the shared renderer page's inputs through
// the same planning the app's live restyle uses; callers add the video option
// when they drive the interactive variant.
export function recordingPageOpts(
  prep: PreparedRecording,
  config: RenderConfig,
): PageOpts {
  return planPageOpts({
    bbox: prep.tel.bbox,
    width: prep.width,
    height: prep.height,
    config,
    source: { fps: prep.probe.fps.value, frames: prep.probe.frames },
    frames: prep.frames,
  });
}

interface RenderContext extends PreparedRecording {
  videoPath: string;
  outPath: string;
  config: RenderConfig;
  log: LogFn;
  /** Frames actually rendered: the source count or the exported range's. */
  outFrames: number;
  frameRange: FrameRange | null;
}

interface RenderStageEnv {
  ctx: RenderContext;
  deps: PipelineDeps;
  options: PipelineOptions;
  tracer: Tracer;
  root: Span;
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
    ...telemetrySummary(tel),
    frames: ctx.outFrames,
    fps: probe.fps.str,
    frameRange: ctx.frameRange ?? undefined,
    bbox: tel.bbox,
    zoom: overview.zoom,
    zoomFixed: config.zoom > 0,
    zoomOut: effectiveZoomOut(config),
    tilesDownloaded: tileStats.downloaded,
    verified: true,
    elapsedSec,
  };
}

async function verifyRenderedOutput(env: RenderStageEnv): Promise<void> {
  const { ctx, deps, tracer, root } = env;
  await stage(tracer, 'output.verify', root, {}, async (span) => {
    const verify = await deps.verifyOutput(ctx.outPath, ctx.outFrames, ctx.probe.fps.value);
    span.setAttributes({
      'verify.frames.expected': ctx.outFrames,
      'verify.frames.actual': verify.frames,
      'verify.fps.expected': ctx.probe.fps.str,
      'verify.fps.actual': verify.fps ?? 'unknown',
      'verify.ok': verify.ok,
    });
    if (!verify.ok) {
      throw new Error(
        `output verification failed: got ${verify.frames} frames @ ${verify.fps ?? 'unknown'}, ` +
          `expected ${ctx.outFrames} @ ${ctx.probe.fps.str}`,
      );
    }
  });
  ctx.log(
    ctx.frameRange
      ? 'verified: frame count and frame rate are 1:1 within the exported range'
      : 'verified: frame count and frame rate match the source',
  );
}

async function renderToOutput(env: RenderStageEnv): Promise<void> {
  const { ctx, deps, options, tracer, root } = env;
  const html = buildPageHtml(recordingPageOpts(ctx, ctx.config));
  fs.mkdirSync(path.dirname(ctx.outPath), { recursive: true });
  await renderWithOutputCleanup(ctx.outPath, ctx.log, async () => {
    await deps.renderVideo({
      html,
      capture: ctx.config.capture,
      preset: ctx.config.preset,
      style: ctx.config.style,
      tileCache: ctx.config.tileCache,
      width: ctx.width,
      height: ctx.height,
      frames: ctx.outFrames,
      frameStart: ctx.frameRange?.start ?? 0,
      fpsStr: ctx.probe.fps.str,
      workers: ctx.config.workers,
      outPath: ctx.outPath,
      browserPath: ctx.config.browser,
      signal: options.signal,
      log: ctx.log,
      trace: { tracer, parent: root },
    });
    await verifyRenderedOutput(env);
  });
}

// Throws on failure (the caller decides policy). outPath may be pre-planned by
// runBatch (collision-free); it defaults to the plain output path for direct
// callers. One trace per recording: the root span wraps the pipeline stages
// below.
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
  if (options.signal?.aborted) throw new Error('render canceled');

  return stage(
    tracer,
    'recording.process',
    options.trace?.parent,
    {
      'source.file.name': path.basename(videoPath),
    },
    async (root) => {
      const prep = await prepareSession(videoPath, config, log, {
        ...options,
        trace: { tracer, parent: root },
      });
      root.setAttributes({
        'canvas.width': prep.width,
        'canvas.height': prep.height,
        'map.style': config.style,
        'map.view': config.view,
        'source.frames': prep.probe.frames,
        'source.fps': prep.probe.fps.value,
        'telemetry.source': prep.tel.source,
      });

      const range = resolveRange(options.range, prep.probe.frames);
      const outFrames = range ? range.end - range.start + 1 : prep.probe.frames;
      const ctx: RenderContext = {
        ...prep,
        videoPath,
        outPath,
        config,
        log,
        outFrames,
        frameRange: range,
      };
      await renderToOutput({ ctx, deps, options, tracer, root });
      return buildOkSummary(ctx, Math.round((Date.now() - t0) / 1000));
    },
  );
}

// Failures never abort the batch.
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
