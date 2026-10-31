import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';

import { DEFAULT_CONFIG } from '../src/config.js';
import type { RenderConfig } from '../src/config.js';
import type { VideoProbe } from '../src/ff.js';
import { videoBaseName } from '../src/inputs.js';
import type { PipelineDeps } from '../src/run.js';
import type { Telemetry } from '../src/telemetry.js';
import { createTracing } from '../src/tracing.js';
import type { Tracer, Tracing } from '../src/tracing.js';

// Call cleanupTmpDirs() from afterEach.
const tmpDirs: string[] = [];

export function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo2-test-'));
  tmpDirs.push(dir);
  return dir;
}

export function cleanupTmpDirs(): void {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const OTLP_ENDPOINT = 'http://127.0.0.1:4318';

export interface TracingHarness {
  /** The facade under test, for enabled/shutdown-style assertions. */
  tracing: Tracing;
  tracer: Tracer;
  finish(): Promise<ReadableSpan[]>;
}

// The flush/read/shutdown dance every span test repeats: shutdown alone wipes
// the exporter's spans.
export async function tracingHarness(
  env: Record<string, string | undefined> = {
    OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT,
  },
): Promise<TracingHarness> {
  const exporter = new InMemorySpanExporter();
  const tracing = await createTracing({ env, spanExporter: exporter });
  return {
    tracing,
    tracer: tracing.tracer,
    async finish() {
      await tracing.flush();
      const spans = exporter.getFinishedSpans();
      await tracing.shutdown();
      return spans;
    },
  };
}

export function byName(
  spans: ReadableSpan[],
  name: string,
): ReadableSpan | undefined {
  return spans.find((s) => s.name === name);
}

export function startMs(span: ReadableSpan | undefined): number {
  if (!span) throw new Error('span not found');
  return span.startTime[0] * 1000 + span.startTime[1] / 1e6;
}

export function endMs(span: ReadableSpan | undefined): number {
  if (!span) throw new Error('span not found');
  return span.endTime[0] * 1000 + span.endTime[1] / 1e6;
}

export function durationMs(span: ReadableSpan | undefined): number {
  if (!span) throw new Error('span not found');
  return span.duration[0] * 1000 + span.duration[1] / 1e6;
}

// Three cues: two with GPS fixes, one with no GPS lock (0/0) in between.
// Cue 1 includes extra exposure fields like real Neo 2 sidecars.
export const SRT_SAMPLE = `1
00:00:00,000 --> 00:00:00,033
<font size="28">FrameCnt: 1, DiffTime: 33ms
2026-05-25 09:18:11.708
[iso: 340] [shutter: 1/400.0] [fnum: 2.2] [ev: 0] [ct: 4435] [latitude: 46.613070] [longitude: 14.262388] [rel_alt: 3.300 abs_alt: 313.227] [eis: normal]</font>

2
00:00:00,033 --> 00:00:00,066
<font size="28">FrameCnt: 2, DiffTime: 33ms
2026-05-25 09:18:11.741
[iso: 340] [latitude: 0.000000] [longitude: 0.000000] [rel_alt: 3.400 abs_alt: 313.327]</font>

3
00:00:00,066 --> 00:00:00,100
<font size="28">FrameCnt: 3, DiffTime: 34ms
2026-05-25 09:18:11.775
[iso: 340] [latitude: 46.613071] [longitude: 14.262389] [rel_alt: 3.500 abs_alt: 313.427]</font>
`;

// Four cues: two fixes, one no-lock (0/0), and one without any lat/lon line.
// That fourth cue is neither a fix nor a no-lock event - only the exact fix
// count keeps the three kinds apart.
export const SRT_SAMPLE_MIXED = `1
00:00:00,000 --> 00:00:00,033
<font size="28">FrameCnt: 1, DiffTime: 33ms
2026-05-25 09:18:11.708
[iso: 340] [latitude: 46.613070] [longitude: 14.262388] [rel_alt: 3.300 abs_alt: 313.227]</font>

2
00:00:00,033 --> 00:00:00,066
<font size="28">FrameCnt: 2, DiffTime: 33ms
2026-05-25 09:18:11.741
[iso: 340] [latitude: 0.000000] [longitude: 0.000000] [rel_alt: 3.400 abs_alt: 313.327]</font>

3
00:00:00,066 --> 00:00:00,100
<font size="28">FrameCnt: 3, DiffTime: 34ms
2026-05-25 09:18:11.775
[iso: 340] [rel_alt: 3.500 abs_alt: 313.427]</font>

4
00:00:00,100 --> 00:00:00,133
<font size="28">FrameCnt: 4, DiffTime: 33ms
2026-05-25 09:18:11.808
[iso: 340] [latitude: 46.613072] [longitude: 14.262390] [rel_alt: 3.600 abs_alt: 313.527]</font>
`;

export function probeFixture(overrides: Partial<VideoProbe> = {}): VideoProbe {
  return {
    fps: { num: 30, den: 1, value: 30, str: '30' },
    frames: 3,
    durationSec: 0.1,
    width: 1280,
    height: 720,
    ...overrides,
  };
}

// Pipeline telemetry from an SRT sidecar. Tests with deliberate data (a wider
// fix bbox, more frame samples) override just those fields.
export function telemetryFixture(overrides: Partial<Telemetry> = {}): Telemetry {
  return {
    source: 'srt',
    method: 'srt-cues',
    headingMode: 'cog',
    sampleCount: 5,
    fixCount: 3,
    noLock: 2,
    frames: [
      { lat: 46.6, lon: 14.2, alt: 3.3, speed: 1.2, headingDeg: 90 },
      { lat: 46.61, lon: 14.21, alt: 3.4, speed: 1.3, headingDeg: 91 },
      { lat: 46.62, lon: 14.22, alt: 3.5, speed: 1.4, headingDeg: 92 },
    ],
    bbox: { minLat: 46.6, maxLat: 46.62, minLon: 14.2, maxLon: 14.22 },
    trackDistanceM: 42,
    ...overrides,
  };
}

// The stats/summary scenario: camera-metadata telemetry without per-frame
// samples. Shared by the summary and app-session tests so their cross-module
// assertions compare the same numbers.
export function statsTelemetry(overrides: Partial<Telemetry> = {}): Telemetry {
  return {
    source: 'cammeta',
    method: 'ffprobe',
    headingMode: 'yaw',
    sampleCount: 600,
    fixCount: 590,
    noLock: 4,
    frames: [],
    bbox: { minLat: 46.6, maxLat: 46.612, minLon: 14.26, maxLon: 14.262 },
    trackDistanceM: 567.4,
    ...overrides,
  };
}

export type StubDepsOptions = Partial<PipelineDeps> & {
  probe?: VideoProbe;
  telemetry?: Telemetry;
};

export function stubDeps(options: StubDepsOptions = {}): PipelineDeps {
  const {
    probe = probeFixture(),
    telemetry = telemetryFixture(),
    ...overrides
  } = options;
  return {
    probeVideo: async () => probe,
    loadTelemetry: async () => telemetry,
    prefetchTiles: async () => ({ downloaded: 2, failed: 1, total: 5 }),
    renderVideo: async () => ({ profile: { evalMs: 10, captureMs: 20, emitMs: 30 } }),
    // Keyed on the probe so the verified frame count can never drift from the
    // frames the pipeline plans for.
    verifyOutput: async () => ({ frames: probe.frames, fps: probe.fps.str, ok: true }),
    outputMatchesSource: async () => false,
    ...overrides,
  };
}

export function testConfig(overrides: Partial<RenderConfig> = {}): RenderConfig {
  return {
    ...DEFAULT_CONFIG,
    outDir: tmpDir(),
    tileCache: tmpDir(),
    ...overrides,
  };
}

// Sidecar named the way loadTelemetry looks it up: the video's stem.
export function writeSrt(videoPath: string, text: string): string {
  const srtPath = path.join(path.dirname(videoPath), `${videoBaseName(videoPath)}.srt`);
  fs.writeFileSync(srtPath, text);
  return srtPath;
}
