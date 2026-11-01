// The telemetry I/O shell: discovers and parses a recording's telemetry
// sources (.SRT sidecar, embedded CAM meta) and hands the samples to the pure
// pipeline in src/telemetry-math.ts. The math is reachable without files so
// unit tests can drive it with in-memory samples.

import { parseSrt } from './srt.js';
import { parseCamMeta } from './cammeta.js';
import { findSrtSidecar } from './inputs.js';
import { buildTelemetry } from './telemetry-math.js';
import type { Telemetry, TelemetrySamples } from './telemetry-math.js';

// The .SRT sidecar takes precedence over the embedded CAM-meta stream.
async function loadSamples(
  videoPath: string,
  durationSec: number,
): Promise<TelemetrySamples> {
  const srtPath = findSrtSidecar(videoPath);
  if (srtPath) {
    const parsed = await parseSrt(srtPath);
    if (parsed.count === 0) throw new Error(`SRT sidecar has no cues: ${srtPath}`);
    return {
      samples: parsed.cues.map((cue) => ({
        tSec: cue.tSec,
        lat: cue.lat,
        lon: cue.lon,
        relAlt: cue.relAlt,
        absAlt: cue.absAlt,
        yawDeg: null,
      })),
      source: 'srt',
      method: 'srt-cues',
      noLock: parsed.noLock,
    };
  }

  const cam = await parseCamMeta(videoPath, durationSec);
  if (!cam || cam.samples.length === 0) {
    throw new Error(
      'no telemetry found: no .SRT sidecar and no GPS pairs in the CAM meta stream',
    );
  }
  return { samples: cam.samples, source: 'cammeta', method: cam.method, noLock: cam.noLock };
}

export async function loadTelemetry(
  videoPath: string,
  { frames, fpsValue, durationSec }: { frames: number; fpsValue: number; durationSec: number },
): Promise<Telemetry> {
  const loaded = await loadSamples(videoPath, durationSec);
  return buildTelemetry(loaded, { frames, fpsValue });
}
