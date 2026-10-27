// telemetry.ts - unify SRT / CAM-meta telemetry into per-video-frame arrays
// with derived speed and heading (yaw when available, else course over ground).

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

// Find the .SRT sidecar for a video (same basename, case-insensitive).
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

interface Pos {
  lat: number | null;
  lon: number | null;
  alt: number | null;
}

// Position at time t (seconds), linear interpolation across the sample series.
// Gaps of missing fixes longer than maxGapSec are bridged by holding the
// earlier fix instead of interpolating across them.
function positionAt(samples: TelSample[], t: number, maxGapSec = 3): Pos {
  const n = samples.length;
  if (n === 0) return { lat: null, lon: null, alt: null };
  if (t <= samples[0].tSec) return pick(samples[0]);
  if (t >= samples[n - 1].tSec) return pick(samples[n - 1]);

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].tSec <= t) lo = mid;
    else hi = mid;
  }
  const a = nearestFix(samples, lo, -1);
  const b = nearestFix(samples, hi, 1);
  if (a !== null && b === null) return pick(a);
  if (a === null && b !== null) return pick(b);
  if (a === null || b === null) return { lat: null, lon: null, alt: null };

  const dt = b.tSec - a.tSec;
  const gapOk = dt > 0 && dt <= maxGapSec;
  const f = gapOk && dt > 0 ? (t - a.tSec) / dt : 0;
  return {
    lat: a.lat !== null ? a.lat + ((b.lat ?? a.lat) - a.lat) * (gapOk ? f : 0) : null,
    lon: a.lon !== null ? a.lon + ((b.lon ?? a.lon) - a.lon) * (gapOk ? f : 0) : null,
    alt: pickAlt(a, b, gapOk ? f : 0),
  };
}

function pick(s: TelSample): Pos {
  return { lat: s.lat, lon: s.lon, alt: s.relAlt ?? s.absAlt ?? null };
}

function pickAlt(a: TelSample, b: TelSample, f: number): number | null {
  const va = a.relAlt ?? a.absAlt ?? null;
  const vb = b.relAlt ?? b.absAlt ?? null;
  if (va === null) return vb;
  if (vb === null) return va;
  return va + (vb - va) * f;
}

function nearestFix(
  samples: TelSample[],
  idx: number,
  dir: number,
): TelSample | null {
  let i = idx;
  while (i >= 0 && i < samples.length) {
    if (samples[i].lat !== null && samples[i].lat !== undefined) return samples[i];
    i += dir;
  }
  return null;
}

// Narrow a sample that is known (via validIdx) to carry a GPS fix.
function fixOf(s: TelSample): LatLon {
  if (s.lat === null || s.lon === null) {
    throw new Error('internal: sample without GPS fix');
  }
  return { lat: s.lat, lon: s.lon };
}

// Load telemetry for one video and return per-frame derived values.
export async function loadTelemetry(
  videoPath: string,
  { frames, fpsValue, durationSec }: { frames: number; fpsValue: number; durationSec: number },
): Promise<Telemetry> {
  const srtPath = findSrtSidecar(videoPath);
  let samples: TelSample[];
  let source: 'srt' | 'cammeta';
  let method: string;
  let noLock = 0;

  if (srtPath) {
    const parsed = await parseSrt(srtPath);
    if (parsed.count === 0) throw new Error(`SRT sidecar has no cues: ${srtPath}`);
    samples = parsed.cues.map((c) => ({
      tSec: c.tSec,
      lat: c.lat,
      lon: c.lon,
      relAlt: c.relAlt,
      absAlt: c.absAlt,
      yawDeg: null,
    }));
    source = 'srt';
    method = 'srt-cues';
    noLock = parsed.noLock;
  } else {
    const cam = await parseCamMeta(videoPath, durationSec);
    if (!cam || cam.samples.length === 0) {
      throw new Error(
        'no telemetry found: no .SRT sidecar and no GPS pairs in the CAM meta stream',
      );
    }
    samples = cam.samples;
    source = 'cammeta';
    method = cam.method;
  }

  // Sample-level derived values.
  const validIdx: number[] = [];
  samples.forEach((s, i) => {
    if (s.lat !== null && s.lat !== undefined) validIdx.push(i);
  });
  if (validIdx.length < 2) throw new Error('telemetry has fewer than 2 GPS fixes');

  const bbox: Bbox = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLon: Infinity,
    maxLon: -Infinity,
  };
  let trackDistanceM = 0;
  let prev: number | null = null;
  for (const i of validIdx) {
    const f = fixOf(samples[i]);
    bbox.minLat = Math.min(bbox.minLat, f.lat);
    bbox.maxLat = Math.max(bbox.maxLat, f.lat);
    bbox.minLon = Math.min(bbox.minLon, f.lon);
    bbox.maxLon = Math.max(bbox.maxLon, f.lon);
    if (prev !== null) {
      trackDistanceM += haversineM(fixOf(samples[prev]), f);
    }
    prev = i;
  }

  // Speed per sample: centered difference over neighboring fixes (m/s), then
  // smoothed with a +-5 sample moving average to tame GPS jitter for the HUD.
  const rawSpeed: (number | null)[] = new Array(samples.length).fill(null);
  for (let k = 1; k < validIdx.length - 1; k++) {
    const i0 = validIdx[k - 1];
    const i1 = validIdx[k + 1];
    const dt = samples[i1].tSec - samples[i0].tSec;
    if (dt > 0.001) {
      rawSpeed[validIdx[k]] = haversineM(fixOf(samples[i0]), fixOf(samples[i1])) / dt;
    }
  }
  rawSpeed[validIdx[0]] = rawSpeed[validIdx[1]] ?? 0;
  rawSpeed[validIdx[validIdx.length - 1]] =
    rawSpeed[validIdx[validIdx.length - 2]] ?? 0;
  const speedBySample = new Array<number>(samples.length).fill(0);
  const SPAN = 5;
  for (let k = 0; k < validIdx.length; k++) {
    const lo = Math.max(0, k - SPAN);
    const hi = Math.min(validIdx.length - 1, k + SPAN);
    let sum = 0;
    let n = 0;
    for (let j = lo; j <= hi; j++) {
      const v = rawSpeed[validIdx[j]];
      if (v !== null) {
        sum += v;
        n++;
      }
    }
    speedBySample[validIdx[k]] = n ? sum / n : 0;
  }

  // Heading per sample. Preferred source: drone body yaw (DVTM EulerAngle,
  // deci-degrees) - valid even while hovering. Fallback: course over ground
  // measured across a ~0.7 s baseline (consecutive fixes are only centimeters
  // apart at 60 fps, so neighbor bearings are pure GPS jitter). Held while
  // nearly stationary.
  const hasYaw = samples.some((s) => s.yawDeg !== null && s.yawDeg !== undefined);
  const headingMode: 'yaw' | 'cog' = hasYaw ? 'yaw' : 'cog';
  const MIN_MOVE_M = 1.5; // ignore bearings from sub-meter displacement
  const WINDOW_S = 0.35; // half-window around the sample
  const MIN_SPEED = 0.5; // m/s - below this the course is meaningless
  const rawHeading: (number | null)[] = new Array(samples.length).fill(null);
  if (hasYaw) {
    for (const i of validIdx) {
      const y = samples[i].yawDeg;
      if (y !== null && Number.isFinite(y)) rawHeading[i] = ((y % 360) + 360) % 360;
    }
  } else {
    for (let k = 0; k < validIdx.length; k++) {
      const ik = validIdx[k];
      const tk = samples[ik].tSec;
      let ka = k;
      let kb = k;
      while (ka > 0 && samples[validIdx[ka]].tSec > tk - WINDOW_S) ka--;
      while (kb < validIdx.length - 1 && samples[validIdx[kb]].tSec < tk + WINDOW_S) kb++;
      const a = samples[validIdx[ka]];
      const b = samples[validIdx[kb]];
      const d = haversineM(fixOf(a), fixOf(b));
      const v = speedBySample[ik] ?? 0;
      if (d >= MIN_MOVE_M && v >= MIN_SPEED) {
        rawHeading[ik] = bearingDeg(fixOf(a), fixOf(b));
      }
    }
  }
  // Forward-fill, then back-fill the leading unknowns from the FIRST known
  // heading - never from the flight's final heading, which would point the
  // arrow the wrong way on clips that start hovering and turn later.
  let last: number | null = null;
  for (const i of validIdx) {
    if (rawHeading[i] !== null) last = rawHeading[i];
    else rawHeading[i] = last;
  }
  let firstKnown: number | null = null;
  for (const i of validIdx) {
    const h = rawHeading[i];
    if (h !== null) {
      firstKnown = h;
      break;
    }
  }
  if (firstKnown !== null) {
    for (const i of validIdx) {
      if (rawHeading[i] === null) rawHeading[i] = firstKnown;
      else break;
    }
  }
  const defaultHeading = firstKnown ?? 0;
  for (const i of validIdx) {
    if (rawHeading[i] === null) rawHeading[i] = defaultHeading;
  }

  // Circular smoothing of the heading over a +-4 sample window.
  const headingBySample = new Array<number>(samples.length).fill(defaultHeading);
  const WIN = 4;
  for (let k = 0; k < validIdx.length; k++) {
    const lo = Math.max(0, k - WIN);
    const hi = Math.min(validIdx.length - 1, k + WIN);
    const window: number[] = [];
    for (let j = lo; j <= hi; j++) window.push(rawHeading[validIdx[j]] ?? defaultHeading);
    headingBySample[validIdx[k]] = circularMeanDeg(window);
  }

  // Per-video-frame values at t = frame / fps.
  const frameData: FrameData[] = [];
  for (let f = 0; f < frames; f++) {
    const t = f / fpsValue;
    const p = positionAt(samples, t);
    const si = nearestSampleIndex(samples, t);
    const sp = speedBySample[si];
    frameData.push({
      lat: p.lat,
      lon: p.lon,
      alt: p.alt,
      speed: Math.round(sp * 10) / 10,
      headingDeg: Math.round(headingBySample[si] * 10) / 10,
    });
  }
  // Bridge any fully-missing frame positions at the very ends.
  const firstFrame = frameData.find((d) => d.lat !== null);
  const lastFrame = [...frameData].reverse().find((d) => d.lat !== null);
  for (const d of frameData) {
    if (d.lat === null && firstFrame && lastFrame) {
      d.lat = firstFrame.lat;
      d.lon = firstFrame.lon;
    }
  }

  return {
    source,
    method,
    headingMode,
    sampleCount: samples.length,
    noLock,
    frames: frameData,
    bbox,
    trackDistanceM,
  };
}

function nearestSampleIndex(samples: TelSample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].tSec <= t) lo = mid;
    else hi = mid;
  }
  return t - samples[lo].tSec <= samples[hi].tSec - t ? lo : hi;
}
