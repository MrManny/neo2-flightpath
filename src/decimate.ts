// Up-front trail simplification: Douglas-Peucker in Web Mercator pixel space
// at the working zoom, so the drawn trail deviates from the flown track by
// less than about one pixel while its point count stays bounded regardless
// of flight length. Input arrays are index-aligned to video frames.

import { project } from './geo.js';
import type { Pixel } from './geo.js';

export interface DecimatedTrack {
  lat: number[];
  lon: number[];
  /** Source frame index of each kept point; strictly increasing. */
  frame: number[];
}

export interface DecimateOptions {
  /** Maximum tolerated deviation from the track, in pixels at the working zoom. */
  epsilonPx?: number;
  /** Upper bound for kept points; the epsilon grows until the bound holds. */
  maxPoints?: number;
}

export const DEFAULT_EPSILON_PX = 1;
export const DEFAULT_MAX_POINTS = 3000;

export function decimateTrack(
  lat: readonly number[],
  lon: readonly number[],
  zoom: number,
  options: DecimateOptions = {},
): DecimatedTrack {
  const epsilonPx = options.epsilonPx ?? DEFAULT_EPSILON_PX;
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  if (!(epsilonPx >= 0)) throw new Error('epsilon must be >= 0');
  if (!Number.isInteger(maxPoints) || maxPoints < 2) {
    throw new Error('maxPoints must be an integer >= 2');
  }

  if (lat.length !== lon.length) {
    throw new Error('lat and lon must have the same length');
  }
  const n = lat.length;
  if (n === 0) return { lat: [], lon: [], frame: [] };
  if (n === 1) return { lat: [lat[0]], lon: [lon[0]], frame: [0] };

  const px: Pixel[] = new Array(n);
  for (let i = 0; i < n; i++) px[i] = project(lon[i], lat[i], zoom);

  let keep = douglasPeucker(px, epsilonPx);
  if (keep.length > maxPoints) {
    // The cap is a promise (<=3k visible points on a 20 min flight), so the
    // epsilon doubles until it holds; geometric growth keeps that
    // deterministic and cheap (one or two extra passes in practice).
    let hi = epsilonPx > 0 ? epsilonPx * 2 : 1;
    while (douglasPeucker(px, hi).length > maxPoints) hi *= 2;
    keep = douglasPeucker(px, hi);
  }

  const track: DecimatedTrack = { lat: [], lon: [], frame: [] };
  for (const i of keep) {
    track.lat.push(lat[i]);
    track.lon.push(lon[i]);
    track.frame.push(i);
  }
  return track;
}

// Iterative (stack-based) so adversarial tracks cannot blow the call stack.
function douglasPeucker(px: readonly Pixel[], epsilon: number): number[] {
  const n = px.length;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length > 0) {
    const end = stack.pop() as number;
    const start = stack.pop() as number;
    if (end - start < 2) continue;
    const a = px[start];
    const b = px[end];
    const mid = (start + end) / 2;
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(px[i], a, b);
      // Ties go to the middle-most point so regular patterns (hover
      // jitter, zigzags) split evenly instead of degenerating to O(n^2).
      if (
        d > maxDist ||
        (d === maxDist && Math.abs(i - mid) < Math.abs(maxIdx - mid))
      ) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon) {
      keep[maxIdx] = 1;
      stack.push(start, maxIdx, maxIdx, end);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) indices.push(i);
  return indices;
}

function distanceToSegment(p: Pixel, a: Pixel, b: Pixel): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq),
  );
  return Math.sqrt((p.x - (a.x + t * dx)) ** 2 + (p.y - (a.y + t * dy)) ** 2);
}
