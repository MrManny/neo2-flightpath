import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';

import { DEFAULT_CONFIG } from '../src/config.js';
import type { RenderConfig } from '../src/config.js';
import {
  outputPathFor,
  planOutputs,
  prepareSession,
  processRecording,
  recordingPageOpts,
  runBatch,
} from '../src/run.js';
import type { PipelineDeps, RecordingSummary } from '../src/run.js';
import { loadTelemetry } from '../src/telemetry.js';
import {
  SRT_SAMPLE_MIXED,
  byName,
  cleanupTmpDirs,
  durationMs,
  probeFixture,
  stubDeps,
  testConfig,
  tmpDir,
  tracingHarness,
  writeSrt,
} from './fixtures.js';

describe('planOutputs', () => {
  const config = { ...DEFAULT_CONFIG, outDir: path.join('out', 'maps') };

  it('keeps unique output names untouched', () => {
    const videos = [path.join('a', 'clip1.mp4'), path.join('b', 'clip2.mp4')];
    const plans = planOutputs(videos, config);
    expect(plans.map((p) => p.out)).toEqual([
      path.join('out', 'maps', 'clip1_map.mp4'),
      path.join('out', 'maps', 'clip2_map.mp4'),
    ]);
    expect(plans[0]).toEqual({
      out: outputPathFor(videos[0], config),
      plain: outputPathFor(videos[0], config),
    });
  });

  it('disambiguates same-basename recordings in a shared out dir', () => {
    const videos = [
      path.join('a', 'clip.mp4'),
      path.join('b', 'clip.mp4'),
      path.join('c', 'clip.mp4'),
    ];
    const plans = planOutputs(videos, config);
    expect(plans.map((p) => p.out)).toEqual([
      path.join('out', 'maps', 'clip_map.mp4'),
      path.join('out', 'maps', 'clip_map-2.mp4'),
      path.join('out', 'maps', 'clip_map-3.mp4'),
    ]);
    expect(new Set(plans.map((p) => p.out)).size).toBe(3);
    // renamed plans remember the plain path they deviate from
    expect(plans.map((p) => p.plain)).toEqual(videos.map((v) => outputPathFor(v, config)));
  });

  it('treats names differing only in case as a collision', () => {
    const videos = [path.join('a', 'CLIP.mp4'), path.join('b', 'clip.mp4')];
    const plans = planOutputs(videos, config);
    expect(plans[0].out.toLowerCase()).not.toBe(plans[1].out.toLowerCase());
    expect(plans[1].out).not.toBe(plans[1].plain);
  });

  it('is deterministic across runs with the same input list', () => {
    const videos = [path.join('a', 'clip.mp4'), path.join('b', 'clip.mp4')];
    expect(planOutputs(videos, config)).toEqual(planOutputs(videos, config));
  });
});

const VIDEO = path.join('clips', 'flight.mp4');

const PROBE = probeFixture();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

afterEach(cleanupTmpDirs);

describe('prepareSession', () => {
  it('rounds the canvas to even sizes and lets the planner decimate once', async () => {
    const config = testConfig({ width: 767, height: 500 });
    const prep = await prepareSession(VIDEO, config, () => {}, { deps: stubDeps() });
    expect(prep.width).toBe(766);
    expect(prep.height).toBe(500);
    expect(prep.frames.lat).toHaveLength(3);
    const opts = recordingPageOpts(prep, config);
    expect(opts.decimated.frame[0]).toBe(0);
    expect(opts.decimated.frame[opts.decimated.frame.length - 1]).toBe(2);
    expect(prep.hud).toEqual({ heading: true, alt: false, speed: false });
  });
});

describe('processRecording span tree', () => {
  async function tracedRun(
    deps: PipelineDeps,
    config: RenderConfig = testConfig(),
    video: string = VIDEO,
  ) {
    const harness = await tracingHarness();
    const summary = await processRecording(video, config, () => {}, undefined, {
      deps,
      trace: { tracer: harness.tracer },
    });
    const spans = await harness.finish();
    return { spans, summary };
  }

  it('emits one trace with the stage spans nested under the root', async () => {
    const { spans, summary } = await tracedRun(stubDeps());
    expect(spans.map((s) => s.name).sort()).toEqual([
      'output.verify',
      'plan',
      'probe',
      'recording.process',
      'telemetry.load',
      'tiles.prefetch',
    ]);

    const root = spans.find((s) => s.name === 'recording.process');
    expect(new Set(spans.map((s) => s.spanContext().traceId)).size).toBe(1);
    for (const span of spans) {
      if (span === root) continue;
      expect(span.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
      expect(span.status.code).not.toBe(SpanStatusCode.ERROR);
    }
    expect(summary.status).toBe('ok');
    expect(root?.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it('carries the recording attributes on the root span', async () => {
    const { spans } = await tracedRun(stubDeps());
    const root = spans.find((s) => s.name === 'recording.process');
    expect(root?.attributes).toMatchObject({
      'source.file.name': 'flight.mp4',
      'source.frames': 3,
      'source.fps': 30,
      'canvas.width': 768,
      'canvas.height': 768,
      'map.style': 'satellite',
      'map.view': 'follow',
      'telemetry.source': 'srt',
    });
  });

  it('carries the stage attributes on each stage span', async () => {
    const { spans } = await tracedRun(stubDeps());

    expect(byName(spans, 'telemetry.load')?.attributes).toMatchObject({
      'telemetry.source': 'srt',
      'telemetry.method': 'srt-cues',
      'telemetry.fix.count': 3,
      'telemetry.noLock.count': 2,
    });
    expect(byName(spans, 'plan')?.attributes).toMatchObject({
      'plan.view': 'follow',
      'plan.zoomOut': 1,
      'plan.tile.count': expect.any(Number),
      'plan.zoom': expect.any(Number),
    });
    expect(byName(spans, 'tiles.prefetch')?.attributes).toMatchObject({
      'tiles.total': 5,
      'tiles.downloaded': 2,
      'tiles.cached': 2,
      'tiles.failed': 1,
    });
    expect(byName(spans, 'output.verify')?.attributes).toMatchObject({
      'verify.frames.expected': 3,
      'verify.frames.actual': 3,
      'verify.fps.expected': '30',
      'verify.fps.actual': '30',
      'verify.ok': true,
    });
  });

  it('measures real stage timings consistent with elapsedSec', async () => {
    const deps = stubDeps({
      probeVideo: async () => {
        await sleep(120);
        return PROBE;
      },
      renderVideo: async () => {
        await sleep(600);
        return { profile: { evalMs: 10, captureMs: 20, emitMs: 30 } };
      },
    });
    const { spans, summary } = await tracedRun(deps);
    const probe = byName(spans, 'probe');
    const root = byName(spans, 'recording.process');

    expect(durationMs(probe)).toBeGreaterThanOrEqual(110);
    expect(durationMs(root)).toBeGreaterThanOrEqual(700);
    expect(Math.abs(durationMs(root) - summary.elapsedSec * 1000)).toBeLessThanOrEqual(1000);
  });

  it('marks the failing span and the root ERROR and records the exception', async () => {
    const harness = await tracingHarness();
    const deps = stubDeps({
      probeVideo: async () => {
        throw new Error('ffprobe exploded');
      },
    });
    await expect(
      processRecording(VIDEO, testConfig(), () => {}, undefined, {
        deps,
        trace: { tracer: harness.tracer },
      }),
    ).rejects.toThrow('ffprobe exploded');
    const spans = await harness.finish();
    expect(spans.map((s) => s.name).sort()).toEqual([
      'probe',
      'recording.process',
    ]);
    for (const span of spans) {
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.events.some((e) => e.name === 'exception')).toBe(true);
    }
  });

  it('leaks no coordinates into span attributes', async () => {
    const { spans } = await tracedRun(stubDeps());
    const coordinateValues = [46.6, 46.61, 46.62, 14.2, 14.21, 14.22];
    for (const span of spans) {
      for (const [key, value] of Object.entries(span.attributes)) {
        expect(key.toLowerCase()).not.toMatch(/lat|lon|bbox|coord/);
        expect(coordinateValues).not.toContain(value);
        expect(String(value)).not.toMatch(/-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+/);
      }
    }
  });

  it('reports the exact fix count of the telemetry source', async () => {
    const dir = tmpDir();
    const video = path.join(dir, 'clip.mp4');
    writeSrt(video, SRT_SAMPLE_MIXED);
    const { spans } = await tracedRun(stubDeps({ loadTelemetry }), undefined, video);
    expect(byName(spans, 'telemetry.load')?.attributes).toMatchObject({
      'telemetry.fix.count': 2,
      'telemetry.noLock.count': 1,
    });
  });
});

describe('runBatch tracing', () => {
  it('continues after a failure and still exports the remaining recordings', async () => {
    const harness = await tracingHarness();
    const deps = stubDeps({
      probeVideo: async (videoPath: string) => {
        if (videoPath.endsWith('broken.mp4')) throw new Error('no telemetry in file');
        return PROBE;
      },
    });
    const emitted: RecordingSummary[] = [];
    const result = await runBatch(
      [path.join('clips', 'broken.mp4'), path.join('clips', 'good.mp4')],
      testConfig(),
      () => {},
      (summary) => emitted.push(summary),
      { deps, trace: { tracer: harness.tracer } },
    );
    const spans = await harness.finish();

    expect(result).toEqual({ ok: 1, skipped: 0, failed: 1 });
    expect(emitted.map((s) => s.status)).toEqual(['error', 'ok']);

    const roots = spans.filter((s) => s.name === 'recording.process');
    expect(roots).toHaveLength(2);
    const bad = roots.find((s) => s.attributes['source.file.name'] === 'broken.mp4');
    const good = roots.find((s) => s.attributes['source.file.name'] === 'good.mp4');
    expect(bad?.status.code).toBe(SpanStatusCode.ERROR);
    expect(bad?.events.some((e) => e.name === 'exception')).toBe(true);
    expect(good?.status.code).not.toBe(SpanStatusCode.ERROR);

    const goodSpans = spans.filter(
      (s) => s.spanContext().traceId === good?.spanContext().traceId,
    );
    expect(goodSpans.map((s) => s.name).sort()).toEqual([
      'output.verify',
      'plan',
      'probe',
      'recording.process',
      'telemetry.load',
      'tiles.prefetch',
    ]);
  });

  it('emits no trace for skipped recordings', async () => {
    const harness = await tracingHarness();
    const deps = stubDeps({ outputMatchesSource: async () => true });
    const result = await runBatch(
      [VIDEO],
      testConfig({ skipExisting: true }),
      () => {},
      () => {},
      { deps, trace: { tracer: harness.tracer } },
    );
    const spans = await harness.finish();

    expect(result).toEqual({ ok: 0, skipped: 1, failed: 0 });
    expect(spans).toHaveLength(0);
  });
});

describe('processRecording frame ranges', () => {
  function rangeDeps() {
    const calls: { render?: { frames: number; frameStart?: number }; verify?: number } = {};
    const deps = stubDeps({
      probe: probeFixture({ frames: 40 }),
      renderVideo: async (opts) => {
        calls.render = { frames: opts.frames, frameStart: opts.frameStart };
        return { profile: { evalMs: 0, captureMs: 0, emitMs: 0 } };
      },
      verifyOutput: async (_out, expected) => {
        calls.verify = expected;
        return { frames: expected, fps: '30', ok: true };
      },
    });
    return { deps, calls };
  }

  it('renders only the segment, starting at the range start, and verifies its length', async () => {
    const { deps, calls } = rangeDeps();
    const out = path.join(tmpDir(), 'segment.mp4');
    const summary = await processRecording(VIDEO, testConfig(), () => {}, out, {
      deps,
      range: { start: 10, end: 29 },
    });
    expect(calls.render).toEqual({ frames: 20, frameStart: 10 });
    expect(calls.verify).toBe(20);
    expect(summary.frames).toBe(20);
    expect(summary.frameRange).toEqual({ start: 10, end: 29 });
  });

  it('renders the full recording from frame 0 when no range is given', async () => {
    const { deps, calls } = rangeDeps();
    const out = path.join(tmpDir(), 'full.mp4');
    const summary = await processRecording(VIDEO, testConfig(), () => {}, out, { deps });
    expect(calls.render).toEqual({ frames: 40, frameStart: 0 });
    expect(calls.verify).toBe(40);
    expect(summary.frames).toBe(40);
    expect(summary.frameRange).toBeUndefined();
  });

  it('exports a range that ends on the last frame', async () => {
    const { deps, calls } = rangeDeps();
    const out = path.join(tmpDir(), 'tail.mp4');
    await processRecording(VIDEO, testConfig(), () => {}, out, {
      deps,
      range: { start: 30, end: 39 },
    });
    expect(calls.render).toEqual({ frames: 10, frameStart: 30 });
  });

  it.each([
    ['start equal to end', { start: 5, end: 5 }, /0 <= start < end/],
    ['start after end', { start: 9, end: 2 }, /0 <= start < end/],
    ['end beyond the recording', { start: 0, end: 40 }, /beyond the recording \(40 frames\)/],
  ])('rejects %s before rendering anything', async (_label, range, pattern) => {
    const { deps, calls } = rangeDeps();
    await expect(
      processRecording(VIDEO, testConfig(), () => {}, path.join(tmpDir(), 'x.mp4'), {
        deps,
        range,
      }),
    ).rejects.toThrow(pattern);
    expect(calls.render).toBeUndefined();
  });

  it('refuses to start when the signal is already aborted', async () => {
    const { deps, calls } = rangeDeps();
    const controller = new AbortController();
    controller.abort();
    await expect(
      processRecording(VIDEO, testConfig(), () => {}, path.join(tmpDir(), 'x.mp4'), {
        deps,
        signal: controller.signal,
      }),
    ).rejects.toThrow('render canceled');
    expect(calls.render).toBeUndefined();
  });
});
