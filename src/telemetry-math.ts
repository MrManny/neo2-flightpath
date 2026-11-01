// Pure telemetry math: turns time-stamped samples into per-frame values
// (position, speed, heading) plus the track statistics. No I/O lives here,
// so the loader shell and the unit tests drive it directly with in-memory
// samples.

import { bearingDeg, circularMeanDeg, haversineM } from './geo.js';
import type { Bbox, LatLon } from './geo.js';
import type { CamMetaMethod } from './cammeta.js';

// The closed telemetry vocabulary, one home so a typo cannot flow silently
// into the --json output.
export type TelemetrySource = 'srt' | 'cammeta';
export type TelemetryMethod = 'srt-cues' | CamMetaMethod;
export type HeadingMode = 'yaw' | 'cog';

export interface FrameData {
  fix: LatLon | null;
  alt: number | null;
  speed: number | null;
  headingDeg: number;
}

export interface Telemetry {
  source: TelemetrySource;
  method: TelemetryMethod;
  headingMode: HeadingMode;
  sampleCount: number;
  /** Samples carrying a GPS fix; other samples are neither fixes nor no-locks. */
  fixCount: number;
  /**
   * No-lock positions (the placeholder is not a fix, see isGpsFix). Every
   * source counts them the same way - SRT as no-lock cues, the CAM meta
   * packet path as no-lock packets - except the raw byte-scan fallback,
   * which sees fix pairs only and reports 0.
   */
  noLock: number;
  /** Index-aligned to video frames. */
  frames: FrameData[];
  bbox: Bbox;
  trackDistanceM: number;
}

export interface TelSample {
  tSec: number;
  /** A real GPS fix, or null when the sample has none (see gpsFix). */
  fix: LatLon | null;
  relAlt: number | null;
  absAlt: number | null;
  yawDeg: number | null;
}

/** A source's samples with their provenance, ready for the pure pipeline. */
export interface TelemetrySamples {
  samples: TelSample[];
  source: TelemetrySource;
  method: TelemetryMethod;
  noLock: number;
}

interface FramePosition {
  fix: LatLon | null;
  alt: number | null;
}

/** A sample carrying a GPS fix; parsers decide this once (see gpsFix). */
type FixSample = TelSample & { fix: LatLon };

/** A fix-bearing sample with its index in the sample list. */
type FixRef = FixSample & { index: number };

const MAX_INTERPOLATION_GAP_S = 3; // hold the earlier fix across longer gaps
const SPEED_SMOOTHING_SPAN = 5; // +-N samples moving average for the HUD
const HEADING_MIN_MOVE_M = 1.5; // ignore bearings from sub-meter displacement
const HEADING_HALF_WINDOW_S = 0.35; // preferred course baseline half-width
const HEADING_MAX_BASELINE_S = 3; // widened baseline for slow flights
const HEADING_MIN_SPEED_MPS = 0.5; // below this the course is meaningless
const HEADING_SMOOTHING_SPAN = 4; // +-N samples circular mean

function isFixSample(sample: TelSample): sample is FixSample {
  return sample.fix !== null;
}

// The fix-bearing samples in order, with their indices; the pipeline works
// from these instead of re-deriving who carries a fix.
function fixRefs(samples: TelSample[]): FixRef[] {
  const refs: FixRef[] = [];
  samples.forEach((sample, index) => {
    if (isFixSample(sample)) refs.push({ ...sample, index });
  });
  return refs;
}

function altitudeOf(sample: TelSample): number | null {
  return sample.relAlt ?? sample.absAlt ?? null;
}

function positionOfSample(sample: TelSample): FramePosition {
  return { fix: sample.fix, alt: altitudeOf(sample) };
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
): FixSample | null {
  let i = idx;
  while (i >= 0 && i < samples.length) {
    const sample = samples[i];
    if (isFixSample(sample)) return sample;
    i += direction;
  }
  return null;
}

// Position at time t (seconds). Gaps of missing fixes longer than maxGapSec
// are bridged by holding the earlier fix instead of interpolating across them.
function positionAt(
  samples: TelSample[],
  t: number,
  maxGapSec = MAX_INTERPOLATION_GAP_S,
): FramePosition {
  const n = samples.length;
  if (n === 0) return { fix: null, alt: null };
  if (t <= samples[0].tSec) return positionOfSample(samples[0]);
  if (t >= samples[n - 1].tSec) return positionOfSample(samples[n - 1]);

  const lo = sampleIndexBefore(samples, t);
  const hi = lo + 1;
  const a = nearestFix(samples, lo, -1);
  const b = nearestFix(samples, hi, 1);
  if (a !== null && b === null) return positionOfSample(a);
  if (a === null && b !== null) return positionOfSample(b);
  if (a === null || b === null) return { fix: null, alt: null };

  const dt = b.tSec - a.tSec;
  const gapOk = dt > 0 && dt <= maxGapSec;
  const fraction = gapOk ? (t - a.tSec) / dt : 0;
  return {
    fix: {
      lat: a.fix.lat + (b.fix.lat - a.fix.lat) * fraction,
      lon: a.fix.lon + (b.fix.lon - a.fix.lon) * fraction,
    },
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

function computeTrackStats(
  fixes: FixRef[],
): { bbox: Bbox; trackDistanceM: number } {
  const bbox: Bbox = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLon: Infinity,
    maxLon: -Infinity,
  };
  let trackDistanceM = 0;
  let prev: LatLon | null = null;
  for (const { fix } of fixes) {
    bbox.minLat = Math.min(bbox.minLat, fix.lat);
    bbox.maxLat = Math.max(bbox.maxLat, fix.lat);
    bbox.minLon = Math.min(bbox.minLon, fix.lon);
    bbox.maxLon = Math.max(bbox.maxLon, fix.lon);
    if (prev !== null) {
      trackDistanceM += haversineM(prev, fix);
    }
    prev = fix;
  }
  return { bbox, trackDistanceM };
}

// Centered difference over neighboring fixes (m/s), smoothed with a moving
// average to tame GPS jitter for the HUD. Values live on the sample indexes
// so any sample can answer a frame's nearest-sample lookup.
function computeSpeedBySample(
  sampleCount: number,
  fixes: FixRef[],
): number[] {
  const rawSpeed: (number | null)[] = new Array(fixes.length).fill(null);
  for (let k = 1; k < fixes.length - 1; k++) {
    const dt = fixes[k + 1].tSec - fixes[k - 1].tSec;
    if (dt > 0.001) {
      rawSpeed[k] = haversineM(fixes[k - 1].fix, fixes[k + 1].fix) / dt;
    }
  }
  // Endpoints reuse the adjacent centered value.
  rawSpeed[0] = rawSpeed[1] ?? 0;
  rawSpeed[fixes.length - 1] = rawSpeed[fixes.length - 2] ?? 0;

  const speedBySample = new Array<number>(sampleCount).fill(0);
  for (let k = 0; k < fixes.length; k++) {
    const lo = Math.max(0, k - SPEED_SMOOTHING_SPAN);
    const hi = Math.min(fixes.length - 1, k + SPEED_SMOOTHING_SPAN);
    let sum = 0;
    let count = 0;
    for (let j = lo; j <= hi; j++) {
      const v = rawSpeed[j];
      if (v !== null) {
        sum += v;
        count++;
      }
    }
    speedBySample[fixes[k].index] = count ? sum / count : 0;
  }
  return speedBySample;
}

interface HeadingResult {
  headingBySample: number[];
  headingMode: HeadingMode;
}

// Preferred source: drone body yaw (DVTM EulerAngle, deci-degrees) - valid
// even while hovering. Fallback: course over ground measured across a moving
// baseline (consecutive fixes are only centimeters apart at 60 fps, so
// neighbor bearings are pure GPS jitter). Held while truly stationary.
function computeHeadingBySample(
  samples: TelSample[],
  fixes: FixRef[],
  speedBySample: number[],
): HeadingResult {
  const hasYaw = samples.some((sample) => sample.yawDeg !== null);
  const headingMode: HeadingMode = hasYaw ? 'yaw' : 'cog';

  const rawHeading: (number | null)[] = new Array(fixes.length).fill(null);
  if (hasYaw) {
    fillYawHeadings(fixes, rawHeading);
  } else {
    fillCourseOverGroundHeadings(fixes, speedBySample, rawHeading);
  }
  fillHeadingGaps(rawHeading);

  // Samples without a fix carry the default so the array is fully populated.
  const defaultHeading = rawHeading[0] ?? firstKnownHeading(rawHeading) ?? 0;
  const headingBySample = new Array<number>(samples.length).fill(defaultHeading);
  for (let k = 0; k < fixes.length; k++) {
    const lo = Math.max(0, k - HEADING_SMOOTHING_SPAN);
    const hi = Math.min(fixes.length - 1, k + HEADING_SMOOTHING_SPAN);
    const window: number[] = [];
    for (let j = lo; j <= hi; j++) {
      window.push(rawHeading[j] ?? defaultHeading);
    }
    headingBySample[fixes[k].index] = circularMeanDeg(window);
  }
  return { headingBySample, headingMode };
}

function fillYawHeadings(
  fixes: FixRef[],
  rawHeading: (number | null)[],
): void {
  for (let k = 0; k < fixes.length; k++) {
    const yaw = fixes[k].yawDeg;
    if (yaw !== null && Number.isFinite(yaw)) rawHeading[k] = ((yaw % 360) + 360) % 360;
  }
}

function fillCourseOverGroundHeadings(
  fixes: FixRef[],
  speedBySample: number[],
  rawHeading: (number | null)[],
): void {
  for (let k = 0; k < fixes.length; k++) {
    const tk = fixes[k].tSec;
    if ((speedBySample[fixes[k].index] ?? 0) < HEADING_MIN_SPEED_MPS) continue;
    // Grow the baseline until the pair clears the GPS jitter floor: slow
    // flights get a wider window instead of losing their heading to holds.
    let ka = k;
    let kb = k;
    let displacement = 0;
    for (const half of [HEADING_HALF_WINDOW_S, HEADING_MAX_BASELINE_S]) {
      ka = k;
      kb = k;
      while (ka > 0 && fixes[ka].tSec > tk - half) ka--;
      while (kb < fixes.length - 1 && fixes[kb].tSec < tk + half) kb++;
      displacement = haversineM(fixes[ka].fix, fixes[kb].fix);
      if (displacement >= HEADING_MIN_MOVE_M) break;
    }
    if (displacement >= HEADING_MIN_MOVE_M) {
      rawHeading[k] = bearingDeg(fixes[ka].fix, fixes[kb].fix);
    }
  }
}

// The leading unknowns are back-filled from the FIRST known heading, never
// the flight's final heading, which would point the arrow the wrong way on
// clips that start hovering and turn later.
function fillHeadingGaps(rawHeading: (number | null)[]): void {
  let last: number | null = null;
  for (let k = 0; k < rawHeading.length; k++) {
    if (rawHeading[k] !== null) last = rawHeading[k];
    else rawHeading[k] = last;
  }
  const firstKnown = firstKnownHeading(rawHeading);
  if (firstKnown !== null) {
    for (let k = 0; k < rawHeading.length; k++) {
      if (rawHeading[k] === null) rawHeading[k] = firstKnown;
      else break;
    }
  }
  for (let k = 0; k < rawHeading.length; k++) {
    rawHeading[k] ??= firstKnown ?? 0;
  }
}

function firstKnownHeading(rawHeading: (number | null)[]): number | null {
  for (const heading of rawHeading) {
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
      fix: pos.fix,
      alt: pos.alt,
      speed: Math.round(speedBySample[si] * 10) / 10,
      headingDeg: Math.round(headingBySample[si] * 10) / 10,
    });
  }
  return frameData;
}

// Bridge fully-missing frame positions at the very ends: frames before the
// first fix hold the first fix, frames after the last fix hold the last fix
// (the hold-earlier policy from positionAt, applied past its ends).
function bridgeMissingFramePositions(frameData: FrameData[]): void {
  const first = frameData.find((d) => d.fix !== null);
  const last = [...frameData].reverse().find((d) => d.fix !== null);
  if (!first || !last) return;
  let lead = 0;
  while (lead < frameData.length && frameData[lead].fix === null) {
    frameData[lead].fix = first.fix;
    lead++;
  }
  let trail = frameData.length - 1;
  while (trail >= lead && frameData[trail].fix === null) {
    frameData[trail].fix = last.fix;
    trail--;
  }
}

// The pure pipeline: samples in, per-frame telemetry and track stats out.
export function buildTelemetry(
  loaded: TelemetrySamples,
  timing: { frames: number; fpsValue: number },
): Telemetry {
  const { samples, source, method, noLock } = loaded;
  const fixes = fixRefs(samples);
  if (fixes.length < 2) throw new Error('telemetry has fewer than 2 GPS fixes');

  const { bbox, trackDistanceM } = computeTrackStats(fixes);
  const speedBySample = computeSpeedBySample(samples.length, fixes);
  const { headingBySample, headingMode } = computeHeadingBySample(
    samples,
    fixes,
    speedBySample,
  );

  const frameData = buildFrameData(
    samples,
    timing.frames,
    timing.fpsValue,
    speedBySample,
    headingBySample,
  );
  bridgeMissingFramePositions(frameData);

  return {
    source,
    method,
    headingMode,
    sampleCount: samples.length,
    fixCount: fixes.length,
    noLock,
    frames: frameData,
    bbox,
    trackDistanceM,
  };
}
