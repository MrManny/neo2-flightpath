import path from 'node:path';
import type * as childProcessModule from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';

import { FrameBatchRecorder, renderVideo } from '../src/render.js';
import type { CaptureProgress, RenderOpts } from '../src/render.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { captureFraction, exportReducer, initialExportState } from '../ui/lib/exportstate.js';
import {
  byName,
  cleanupTmpDirs,
  endMs,
  startMs,
  tmpDir,
  tracingHarness,
} from './fixtures.js';

const mocks = vi.hoisted(() => ({
  exitCode: 0,
  screenshotFailAt: 0,
  screenshots: 0,
  launchFail: false,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcessModule>();
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  return {
    ...actual,
    spawn: () => {
      const proc = new EventEmitter() as EventEmitter & {
        stdin: InstanceType<typeof PassThrough>;
        stderr: InstanceType<typeof PassThrough>;
        kill: () => void;
      };
      proc.stdin = new PassThrough();
      proc.stderr = new PassThrough();
      proc.kill = () => {};
      // The fake encoder exits when its stdin closes, like ffmpeg does.
      proc.stdin.on('finish', () => proc.emit('close', mocks.exitCode));
      return proc;
    },
  };
});

vi.mock('playwright-core', () => ({
  chromium: {
    launch: async () => {
      if (mocks.launchFail) throw new Error('no chromium here');
      return ({
        newPage: async () => ({
          goto: async () => {},
          waitForFunction: async () => {},
          evaluate: async () => {},
          screenshot: async () => {
            mocks.screenshots++;
            if (mocks.screenshotFailAt > 0 && mocks.screenshots === mocks.screenshotFailAt) {
              throw new Error('screenshot failed');
            }
            return Buffer.from(`frame-${mocks.screenshots}`);
          },
          close: async () => {},
        }),
        close: async () => {},
      });
    },
  },
}));

beforeEach(() => {
  mocks.exitCode = 0;
  mocks.screenshotFailAt = 0;
  mocks.screenshots = 0;
  mocks.launchFail = false;
});

afterEach(cleanupTmpDirs);

function renderOpts(overrides: Partial<RenderOpts> = {}): RenderOpts {
  return {
    html: '<html></html>',
    style: 'satellite',
    tileCache: tmpDir(),
    width: 320,
    height: 240,
    frames: 5,
    fpsStr: '30',
    workers: 2,
    outPath: path.join(tmpDir(), 'out.mp4'),
    capture: 'jpeg',
    preset: 'veryfast',
    ...overrides,
  };
}

async function tracedRender(opts: RenderOpts) {
  const harness = await tracingHarness();
  const root = harness.tracer.startSpan('recording.process');
  try {
    const result = await renderVideo({
      ...opts,
      trace: { tracer: harness.tracer, parent: root },
    });
    root.end();
    const spans = await harness.finish();
    return { spans, result };
  } catch (e) {
    root.end();
    await harness.finish();
    throw e;
  }
}

// Span end times are a Date.now() construction sample plus a monotonic
// duration per span (#15), so they can invert by up to ~1 ms against the real
// teardown order; 5 ms covers that jitter with headroom for clock adjustments
// while the assertion still trips on gross lifecycle inversions.
const SPAN_END_GRACE_MS = 5;

describe('renderVideo span tree', () => {
  it('nests capture, batches and encode under the render span', async () => {
    const { spans, result } = await tracedRender(renderOpts({ frames: 250 }));

    expect(spans.map((s) => s.name).sort()).toEqual([
      'recording.process',
      'render',
      'render.capture',
      'render.capture.batch',
      'render.capture.batch',
      'render.capture.batch',
      'render.encode',
    ]);

    const render = byName(spans, 'render');
    const capture = byName(spans, 'render.capture');
    const encode = byName(spans, 'render.encode');
    const batches = spans.filter((s) => s.name === 'render.capture.batch');

    expect(render?.parentSpanContext?.spanId).toBe(
      byName(spans, 'recording.process')?.spanContext().spanId,
    );
    expect(capture?.parentSpanContext?.spanId).toBe(render?.spanContext().spanId);
    expect(encode?.parentSpanContext?.spanId).toBe(render?.spanContext().spanId);
    for (const batch of batches) {
      expect(batch.parentSpanContext?.spanId).toBe(capture?.spanContext().spanId);
    }

    expect(render?.attributes).toMatchObject({
      'render.workers': 2,
      'render.capture.mode': 'jpeg',
      'render.preset': 'veryfast',
      'render.evalMs': expect.any(Number),
      'render.captureMs': expect.any(Number),
      'render.emitMs': expect.any(Number),
    });
    expect(capture?.attributes['render.frames.captured']).toBe(250);
    expect(encode?.attributes).toMatchObject({
      'render.preset': 'veryfast',
      'render.ffmpeg.exitCode': 0,
    });

    // Batches close at every 100 frames and at the final partial batch.
    expect(batches.map((b) => b.attributes['render.frames.captured'])).toEqual([
      100, 200, 250,
    ]);
    for (const batch of batches) {
      expect(batch.attributes['render.frame.minMs']).toBeGreaterThanOrEqual(0);
      expect(batch.attributes['render.frame.avgMs']).toBeGreaterThanOrEqual(0);
      expect(batch.attributes['render.frame.maxMs']).toBeGreaterThanOrEqual(0);
    }

    // Capture and encode overlap by design (frames stream into ffmpeg's
    // stdin while they are still being captured).
    expect(startMs(encode)).toBeLessThan(endMs(capture));
    expect(startMs(capture)).toBeLessThan(endMs(encode));

    expect(result.profile).toEqual({
      evalMs: expect.any(Number),
      captureMs: expect.any(Number),
      emitMs: expect.any(Number),
    });
  });

  it('marks encode ERROR when ffmpeg exits non-zero', async () => {
    mocks.exitCode = 3;
    const harness = await tracingHarness();
    await expect(
      renderVideo(renderOpts({ trace: { tracer: harness.tracer } })),
    ).rejects.toThrow('ffmpeg exited with code 3');
    const spans = await harness.finish();

    const encode = byName(spans, 'render.encode');
    expect(encode?.attributes['render.ffmpeg.exitCode']).toBe(3);
    expect(encode?.status.code).toBe(SpanStatusCode.ERROR);
    expect(encode?.events.some((e) => e.name === 'exception')).toBe(true);
    expect(byName(spans, 'render.capture')?.status.code).not.toBe(
      SpanStatusCode.ERROR,
    );
    expect(byName(spans, 'render')?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('marks capture ERROR when a screenshot fails', async () => {
    mocks.screenshotFailAt = 2;
    const harness = await tracingHarness();
    await expect(
      renderVideo(renderOpts({ trace: { tracer: harness.tracer } })),
    ).rejects.toThrow('screenshot failed');
    const spans = await harness.finish();

    const capture = byName(spans, 'render.capture');
    const encode = byName(spans, 'render.encode');
    const render = byName(spans, 'render');
    expect(capture?.status.code).toBe(SpanStatusCode.ERROR);
    expect(capture?.events.some((e) => e.name === 'exception')).toBe(true);
    expect(encode?.status.code).toBe(SpanStatusCode.ERROR);
    expect(render?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('winds down every batch span when a worker fails', async () => {
    mocks.screenshotFailAt = 3;
    const harness = await tracingHarness();
    await expect(
      renderVideo(
        renderOpts({ frames: 250, trace: { tracer: harness.tracer } }),
      ),
    ).rejects.toThrow('screenshot failed');
    const spans = await harness.finish();

    const capture = byName(spans, 'render.capture');
    const batches = spans.filter((s) => s.name === 'render.capture.batch');
    expect(batches.length).toBeGreaterThan(0);
    for (const batch of batches) {
      // each batch must close under the still-open capture span, before capture ends
      expect(batch.parentSpanContext?.spanId).toBe(capture?.spanContext().spanId);
      expect(endMs(batch)).toBeLessThanOrEqual(endMs(capture) + SPAN_END_GRACE_MS);
    }
    // the failed screenshot never counts as a captured frame
    expect(capture?.attributes['render.frames.captured']).toBe(mocks.screenshots - 1);
  });
});

describe('renderVideo browser launch', () => {
  it('keeps every launch attempt as the cause when no browser starts', async () => {
    mocks.launchFail = true;
    const err = await renderVideo(renderOpts()).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toMatch(/could not launch/);
    const cause = err?.cause as AggregateError;
    expect(cause).toBeInstanceOf(AggregateError);
    // chrome, msedge, then the playwright registry - all three survive.
    expect(cause.errors).toHaveLength(3);
    expect(cause.errors.map((e) => (e as Error).message)).toEqual([
      'no chromium here',
      'no chromium here',
      'no chromium here',
    ]);
  });
});

// The emitter's events must keep feeding the export UI's real consumer: a
// change to either side's shape or cadence fails here instead of freezing the
// progress bar.
describe('capture progress events', () => {
  it('pair the render emitter with the export UI consumer', async () => {
    const events: CaptureProgress[] = [];
    await renderVideo(renderOpts({ frames: 250, onCapture: (p) => events.push(p) }));

    expect(events).toEqual([
      { done: 100, total: 250 },
      { done: 200, total: 250 },
      { done: 250, total: 250 },
    ]);

    let state = exportReducer(initialExportState(768, 768), {
      type: 'start',
      request: { outPath: '/exports/a.mp4', config: { ...DEFAULT_CONFIG }, range: null },
    });
    const fractions: (number | null)[] = [];
    for (const progress of events) {
      state = exportReducer(state, { type: 'capture', progress });
      fractions.push(captureFraction(state.capture));
    }
    expect(fractions).toEqual([0.4, 0.8, 1]);
  });
});

describe('FrameBatchRecorder', () => {
  async function recorderRun(
    frames: number,
    cadence: number,
    record: (recorder: FrameBatchRecorder) => void,
  ) {
    const harness = await tracingHarness();
    const parent = harness.tracer.startSpan('render.capture');
    const recorder = new FrameBatchRecorder(harness.tracer, parent, frames, cadence);
    record(recorder);
    parent.end();
    return harness.finish();
  }

  it('closes batches at the cadence boundary and at the last frame', async () => {
    const spans = await recorderRun(5, 2, (recorder) => {
      recorder.recordFrame(1, 10);
      recorder.recordFrame(2, 30);
      recorder.recordFrame(3, 20);
      recorder.recordFrame(4, 40);
      recorder.recordFrame(5, 50);
    });
    const batches = spans.filter((s) => s.name === 'render.capture.batch');
    expect(batches.map((b) => b.attributes['render.frames.captured'])).toEqual([
      2, 4, 5,
    ]);
    expect(batches[0]?.attributes).toMatchObject({
      'render.frame.minMs': 10,
      'render.frame.avgMs': 20,
      'render.frame.maxMs': 30,
    });
    expect(batches[2]?.attributes['render.frame.maxMs']).toBe(50);
  });

  it('fails the open batch span when the capture fails', async () => {
    const spans = await recorderRun(10, 5, (recorder) => {
      recorder.recordFrame(1, 5);
      recorder.close(new Error('capture died'));
    });
    const batches = spans.filter((s) => s.name === 'render.capture.batch');
    expect(batches).toHaveLength(1);
    expect(batches[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(batches[0]?.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('keeps quiet when closed with no open batch', async () => {
    const spans = await recorderRun(10, 5, (recorder) => {
      recorder.close();
      recorder.close();
    });
    expect(spans.filter((s) => s.name === 'render.capture.batch')).toHaveLength(0);
  });

  it('ignores frames recorded after close instead of re-opening a batch', async () => {
    const spans = await recorderRun(10, 5, (recorder) => {
      recorder.close();
      recorder.recordFrame(1, 5);
      recorder.close(new Error('late'));
    });
    expect(spans.filter((s) => s.name === 'render.capture.batch')).toHaveLength(0);
  });
});
