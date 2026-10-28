import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';

import { FrameBatchRecorder, renderVideo } from '../src/render.js';
import type { RenderOpts } from '../src/render.js';
import { createTracing } from '../src/tracing.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

const ENDPOINT = 'http://127.0.0.1:4318';

const mocks = vi.hoisted(() => ({
  exitCode: 0,
  screenshotFailAt: 0,
  screenshots: 0,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
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
    launch: async () => ({
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
    }),
  },
}));

beforeEach(() => {
  mocks.exitCode = 0;
  mocks.screenshotFailAt = 0;
  mocks.screenshots = 0;
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

function byName(spans: ReadableSpan[], name: string): ReadableSpan | undefined {
  return spans.find((s) => s.name === name);
}

function startMs(span: ReadableSpan | undefined): number {
  if (!span) throw new Error('span not found');
  return span.startTime[0] * 1000 + span.startTime[1] / 1e6;
}

function endMs(span: ReadableSpan | undefined): number {
  if (!span) throw new Error('span not found');
  return span.endTime[0] * 1000 + span.endTime[1] / 1e6;
}

async function tracedRender(opts: RenderOpts) {
  const exporter = new InMemorySpanExporter();
  const tracing = await createTracing({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
    spanExporter: exporter,
  });
  const root = tracing.tracer.startSpan('recording.process');
  try {
    const result = await renderVideo({
      ...opts,
      tracer: tracing.tracer,
      parentSpan: root,
    });
    root.end();
    await tracing.flush();
    const spans = exporter.getFinishedSpans();
    await tracing.shutdown();
    return { spans, result };
  } catch (e) {
    root.end();
    await tracing.shutdown();
    throw e;
  }
}

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
    const exporter = new InMemorySpanExporter();
    const tracing = await createTracing({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
      spanExporter: exporter,
    });
    await expect(
      renderVideo(renderOpts({ tracer: tracing.tracer })),
    ).rejects.toThrow('ffmpeg exited with code 3');
    await tracing.flush();
    const spans = exporter.getFinishedSpans();
    await tracing.shutdown();

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
    const exporter = new InMemorySpanExporter();
    const tracing = await createTracing({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
      spanExporter: exporter,
    });
    await expect(
      renderVideo(renderOpts({ tracer: tracing.tracer })),
    ).rejects.toThrow('screenshot failed');
    await tracing.flush();
    const spans = exporter.getFinishedSpans();
    await tracing.shutdown();

    const capture = byName(spans, 'render.capture');
    const encode = byName(spans, 'render.encode');
    const render = byName(spans, 'render');
    expect(capture?.status.code).toBe(SpanStatusCode.ERROR);
    expect(capture?.events.some((e) => e.name === 'exception')).toBe(true);
    expect(encode?.status.code).toBe(SpanStatusCode.ERROR);
    expect(render?.status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe('FrameBatchRecorder', () => {
  async function recorderRun(
    frames: number,
    cadence: number,
    record: (recorder: FrameBatchRecorder) => void,
  ) {
    const exporter = new InMemorySpanExporter();
    const tracing = await createTracing({
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT },
      spanExporter: exporter,
    });
    const parent = tracing.tracer.startSpan('render.capture');
    const recorder = new FrameBatchRecorder(tracing.tracer, parent, frames, cadence);
    record(recorder);
    parent.end();
    await tracing.flush();
    const spans = exporter.getFinishedSpans();
    await tracing.shutdown();
    return spans;
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
});
