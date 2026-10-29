import fs from 'node:fs';
import path from 'node:path';

import { bearingDeg, circularMeanDeg, haversineM } from './geo.js';
import type { Bbox, LatLon } from './geo.js';
import { parseSrt } from './srt.js';
import { parseCamMeta } from './cammeta.js';

export interface FrameData {
  lat: number | null;
  lon: number | null;
  alt: number | null;
  speed: number | null;
  headingDeg: number;
}

export interface Telemetry {
  source: 'srt' | 'cammeta';
  method: string;
  headingMode: 'yaw' | 'cog';
  sampleCount: number;
  /** Samples carrying a GPS fix; other samples are neither fixes nor no-locks. */
  fixCount: number;
  noLock: number;
  /** Index-aligned to video frames. */
  frames: FrameData[];
  bbox: Bbox;
  trackDistanceM: number;
}

interface TelSample {
  tSec: number;
  lat: number | null;
  lon: number | null;
  relAlt: number | null;
  absAlt: number | null;
  yawDeg: number | null;
}

interface Position {
  lat: number | null;
  lon: number | null;
  alt: number | null;
}

const MAX_INTERPOLATION_GAP_S = 3; // hold the earlier fix across longer gaps
const SPEED_SMOOTHING_SPAN = 5; // +-N samples moving average for the HUD
const HEADING_MIN_MOVE_M = 1.5; // ignore bearings from sub-meter displacement
const HEADING_HALF_WINDOW_S = 0.35; // preferred course baseline half-width
const HEADING_MAX_BASELINE_S = 3; // widened baseline for slow flights
const HEADING_MIN_SPEED_MPS = 0.5; // below this the course is meaningless
const HEADING_SMOOTHING_SPAN = 4; // +-N samples circular mean

function hasGpsFix(sample: TelSample): boolean {
  return sample.lat !== null;
}

// Sidecar lookup matches the video basename, case-insensitively (.SRT vs .srt).
export function findSrtSidecar(videoPath: string): string | null {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath).replace(/\.[^.]+$/, '');
  for (const f of fs.readdirSync(dir)) {
    if (f.toLowerCase() === `${base.toLowerCase()}.srt`) {
      return path.join(dir, f);
    }
  }
  return null;
}

function altitudeOf(sample: TelSample): number | null {
  return sample.relAlt ?? sample.absAlt ?? null;
}

function positionOfSample(sample: TelSample): Position {
  return { lat: sample.lat, lon: sample.lon, alt: altitudeOf(sample) };
}

function interpolateAltitude(
  a: TelSample,
  b: TelSample,
  fraction: number,
): number | null {
  const altA = altitudeOf(a);
  const altB = altitudeOf(b);
  if (altA === null) return altB;
  if (altB === null) return altA;
  return altA + (altB - altA) * fraction;
}

// Nearest sample with a GPS fix at or beyond idx in the given direction.
function nearestFix(
  samples: TelSample[],
  idx: number,
  direction: number,
): TelSample | null {
  let i = idx;
  while (i >= 0 && i < samples.length) {
    if (hasGpsFix(samples[i])) return samples[i];
    i += direction;
  }
  return null;
}

// Narrow a sample that is known to carry a GPS fix.
function fixOf(sample: TelSample): LatLon {
  if (sample.lat === null || sample.lon === null) {
    throw new Error('internal: sample without GPS fix');
  }
  return { lat: sample.lat, lon: sample.lon };
}

// Position at time t (seconds). Gaps of missing fixes longer than maxGapSec
// are bridged by holding the earlier fix instead of interpolating across them.
function positionAt(
  samples: TelSample[],
  t: number,
  maxGapSec = MAX_INTERPOLATION_GAP_S,
): Position {
  const n = samples.length;
  if (n === 0) return { lat: null, lon: null, alt: null };
  if (t <= samples[0].tSec) return positionOfSample(samples[0]);
  if (t >= samples[n - 1].tSec) return positionOfSample(samples[n - 1]);

  const lo = sampleIndexBefore(samples, t);
  const hi = lo + 1;
  const a = nearestFix(samples, lo, -1);
  const b = nearestFix(samples, hi, 1);
  if (a !== null && b === null) return positionOfSample(a);
  if (a === null && b !== null) return positionOfSample(b);
  if (a === null || b === null) return { lat: null, lon: null, alt: null };

  const dt = b.tSec - a.tSec;
  const gapOk = dt > 0 && dt <= maxGapSec;
  const fraction = gapOk ? (t - a.tSec) / dt : 0;
  return {
    lat: a.lat !== null ? a.lat + ((b.lat ?? a.lat) - a.lat) * fraction : null,
    lon: a.lon !== null ? a.lon + ((b.lon ?? a.lon) - a.lon) * fraction : null,
    alt: interpolateAltitude(a, b, fraction),
  };
}

// t before the first sample yields index 0.
function sampleIndexBefore(samples: TelSample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].tSec <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

function nearestSampleIndex(samples: TelSample[], t: number): number {
  const lo = sampleIndexBefore(samples, t);
  const hi = Math.min(lo + 1, samples.length - 1);
  return t - samples[lo].tSec <= samples[hi].tSec - t ? lo : hi;
}

interface LoadedSamples {
  samples: TelSample[];
  source: 'srt' | 'cammeta';
  method: string;
  noLock: number;
}

// The .SRT sidecar takes precedence over the embedded CAM-meta stream.
async function loadSamples(
  videoPath: string,
  durationSec: number,
): Promise<LoadedSamples> {
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
  return { samples: cam.samples, source: 'cammeta', method: cam.method, noLock: 0 };
}

function indicesOfFixes(samples: TelSample[]): number[] {
  const fixIndices: number[] = [];
  samples.forEach((sample, i) => {
    if (hasGpsFix(sample)) fixIndices.push(i);
  });
  return fixIndices;
}

function computeTrackStats(
  samples: TelSample[],
  fixIndices: number[],
): { bbox: Bbox; trackDistanceM: number } {
  const bbox: Bbox = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLon: Infinity,
    maxLon: -Infinity,
  };
  let trackDistanceM = 0;
  let prev: number | null = null;
  for (const i of fixIndices) {
    const fix = fixOf(samples[i]);
    bbox.minLat = Math.min(bbox.minLat, fix.lat);
    bbox.maxLat = Math.max(bbox.maxLat, fix.lat);
    bbox.minLon = Math.min(bbox.minLon, fix.lon);
    bbox.maxLon = Math.max(bbox.maxLon, fix.lon);
    if (prev !== null) {
      trackDistanceM += haversineM(fixOf(samples[prev]), fix);
    }
    prev = i;
  }
  return { bbox, trackDistanceM };
}

// Centered difference over neighboring fixes (m/s), smoothed with a moving
// average to tame GPS jitter for the HUD.
function computeSpeedBySample(
  samples: TelSample[],
  fixIndices: number[],
): number[] {
  const rawSpeed: (number | null)[] = new Array(samples.length).fill(null);
  for (let k = 1; k < fixIndices.length - 1; k++) {
    const before = fixIndices[k - 1];
    const after = fixIndices[k + 1];
    const dt = samples[after].tSec - samples[before].tSec;
    if (dt > 0.001) {
      rawSpeed[fixIndices[k]] =
        haversineM(fixOf(samples[before]), fixOf(samples[after])) / dt;
    }
  }
  // Endpoints reuse the adjacent centered value.
  rawSpeed[fixIndices[0]] = rawSpeed[fixIndices[1]] ?? 0;
  rawSpeed[fixIndices[fixIndices.length - 1]] =
    rawSpeed[fixIndices[fixIndices.length - 2]] ?? 0;

  const speedBySample = new Array<number>(samples.length).fill(0);
  for (let k = 0; k < fixIndices.length; k++) {
    const lo = Math.max(0, k - SPEED_SMOOTHING_SPAN);
    const hi = Math.min(fixIndices.length - 1, k + SPEED_SMOOTHING_SPAN);
    let sum = 0;
    let count = 0;
    for (let j = lo; j <= hi; j++) {
      const v = rawSpeed[fixIndices[j]];
      if (v !== null) {
        sum += v;
        count++;
      }
    }
    speedBySample[fixIndices[k]] = count ? sum / count : 0;
  }
  return speedBySample;
}

interface HeadingResult {
  headingBySample: number[];
  headingMode: 'yaw' | 'cog';
}

// Preferred source: drone body yaw (DVTM EulerAngle, deci-degrees) - valid
// even while hovering. Fallback: course over ground measured across a moving
// baseline (consecutive fixes are only centimeters apart at 60 fps, so
// neighbor bearings are pure GPS jitter). Held while truly stationary.
function computeHeadingBySample(
  samples: TelSample[],
  fixIndices: number[],
  speedBySample: number[],
): HeadingResult {
  const hasYaw = samples.some((sample) => sample.yawDeg !== null);
  const headingMode: 'yaw' | 'cog' = hasYaw ? 'yaw' : 'cog';

  const rawHeading: (number | null)[] = new Array(samples.length).fill(null);
  if (hasYaw) {
    fillYawHeadings(samples, fixIndices, rawHeading);
  } else {
    fillCourseOverGroundHeadings(samples, fixIndices, speedBySample, rawHeading);
  }
  fillHeadingGaps(fixIndices, rawHeading);

  // Samples without a fix carry the default so the array is fully populated.
  const defaultHeading =
    rawHeading[fixIndices[0]] ?? firstKnownHeading(fixIndices, rawHeading) ?? 0;
  const headingBySample = new Array<number>(samples.length).fill(defaultHeading);
  for (let k = 0; k < fixIndices.length; k++) {
    const lo = Math.max(0, k - HEADING_SMOOTHING_SPAN);
    const hi = Math.min(fixIndices.length - 1, k + HEADING_SMOOTHING_SPAN);
    const window: number[] = [];
    for (let j = lo; j <= hi; j++) {
      window.push(rawHeading[fixIndices[j]] ?? defaultHeading);
    }
    headingBySample[fixIndices[k]] = circularMeanDeg(window);
  }
  return { headingBySample, headingMode };
}

function fillYawHeadings(
  samples: TelSample[],
  fixIndices: number[],
  rawHeading: (number | null)[],
): void {
  for (const i of fixIndices) {
    const yaw = samples[i].yawDeg;
    if (yaw !== null && Number.isFinite(yaw)) rawHeading[i] = ((yaw % 360) + 360) % 360;
  }
}

function fillCourseOverGroundHeadings(
  samples: TelSample[],
  fixIndices: number[],
  speedBySample: number[],
  rawHeading: (number | null)[],
): void {
  for (let k = 0; k < fixIndices.length; k++) {
    const ik = fixIndices[k];
    const tk = samples[ik].tSec;
    if ((speedBySample[ik] ?? 0) < HEADING_MIN_SPEED_MPS) continue;
    // Grow the baseline until the pair clears the GPS jitter floor: slow
    // flights get a wider window instead of losing their heading to holds.
    let ka = k;
    let kb = k;
    let displacement = 0;
    for (const half of [HEADING_HALF_WINDOW_S, HEADING_MAX_BASELINE_S]) {
      ka = k;
      kb = k;
      while (ka > 0 && samples[fixIndices[ka]].tSec > tk - half) ka--;
      while (kb < fixIndices.length - 1 && samples[fixIndices[kb]].tSec < tk + half) kb++;
      displacement = haversineM(fixOf(samples[fixIndices[ka]]), fixOf(samples[fixIndices[kb]]));
      if (displacement >= HEADING_MIN_MOVE_M) break;
    }
    if (displacement >= HEADING_MIN_MOVE_M) {
      rawHeading[ik] = bearingDeg(fixOf(samples[fixIndices[ka]]), fixOf(samples[fixIndices[kb]]));
    }
  }
}

// The leading unknowns are back-filled from the FIRST known heading, never
// the flight's final heading, which would point the arrow the wrong way on
// clips that start hovering and turn later.
function fillHeadingGaps(
  fixIndices: number[],
  rawHeading: (number | null)[],
): void {
  let last: number | null = null;
  for (const i of fixIndices) {
    if (rawHeading[i] !== null) last = rawHeading[i];
    else rawHeading[i] = last;
  }
  const firstKnown = firstKnownHeading(fixIndices, rawHeading);
  if (firstKnown !== null) {
    for (const i of fixIndices) {
      if (rawHeading[i] === null) rawHeading[i] = firstKnown;
      else break;
    }
  }
  for (const i of fixIndices) {
    if (rawHeading[i] === null) rawHeading[i] = firstKnown ?? 0;
  }
}

function firstKnownHeading(
  fixIndices: number[],
  rawHeading: (number | null)[],
): number | null {
  for (const i of fixIndices) {
    const heading = rawHeading[i];
    if (heading !== null) return heading;
  }
  return null;
}

function buildFrameData(
  samples: TelSample[],
  frames: number,
  fpsValue: number,
  speedBySample: number[],
  headingBySample: number[],
): FrameData[] {
  const frameData: FrameData[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const t = frame / fpsValue;
    const pos = positionAt(samples, t);
    const si = nearestSampleIndex(samples, t);
    frameData.push({
      lat: pos.lat,
      lon: pos.lon,
      alt: pos.alt,
      speed: Math.round(speedBySample[si] * 10) / 10,
      headingDeg: Math.round(headingBySample[si] * 10) / 10,
    });
  }
  return frameData;
}

// Bridge any fully-missing frame positions at the very ends.
function bridgeMissingFramePositions(frameData: FrameData[]): void {
  const firstFrame = frameData.find((d) => d.lat !== null);
  const lastFrame = [...frameData].reverse().find((d) => d.lat !== null);
  for (const d of frameData) {
    if (d.lat === null && firstFrame && lastFrame) {
      d.lat = firstFrame.lat;
      d.lon = firstFrame.lon;
    }
  }
}

export async function loadTelemetry(
  videoPath: string,
  { frames, fpsValue, durationSec }: { frames: number; fpsValue: number; durationSec: number },
): Promise<Telemetry> {
  const { samples, source, method, noLock } = await loadSamples(
    videoPath,
    durationSec,
  );

  const fixIndices = indicesOfFixes(samples);
  if (fixIndices.length < 2) throw new Error('telemetry has fewer than 2 GPS fixes');

  const { bbox, trackDistanceM } = computeTrackStats(samples, fixIndices);
  const speedBySample = computeSpeedBySample(samples, fixIndices);
  const { headingBySample, headingMode } = computeHeadingBySample(
    samples,
    fixIndices,
    speedBySample,
  );

  const frameData = buildFrameData(
    samples,
    frames,
    fpsValue,
    speedBySample,
    headingBySample,
  );
  bridgeMissingFramePositions(frameData);

  return {
    source,
    method,
    headingMode,
    sampleCount: samples.length,
    fixCount: fixIndices.length,
    noLock,
    frames: frameData,
    bbox,
    trackDistanceM,
  };
}
