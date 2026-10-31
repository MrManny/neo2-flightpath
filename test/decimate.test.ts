import { describe, expect, it } from 'vitest';

import { decimateTrack } from '../src/decimate.js';
import { project, unproject } from '../src/geo.js';
import type { Pixel } from '../src/geo.js';

const ZOOM = 17;

// Pixel-space fixtures make the ~1 px guarantee directly assertable: at a
// fixed zoom, projected pixels and the epsilon share one unit.
function trackFromPixels(points: Pixel[]): { lat: number[]; lon: number[] } {
  const lat: number[] = [];
  const lon: number[] = [];
  for (const p of points) {
    const ll = unproject(p.x, p.y, ZOOM);
    lat.push(ll.lat);
    lon.push(ll.lon);
  }
  return { lat, lon };
}

function linePixels(n: number): Pixel[] {
  return Array.from({ length: n }, (_, i) => ({ x: i * 2, y: 500 }));
}

// Deterministic zigzag that is never within epsilon of its own chord.
function zigzagPixels(n: number, amplitude: number): Pixel[] {
  return Array.from({ length: n }, (_, i) => ({
    x: i * 2,
    y: 500 + (i % 2 === 0 ? 0 : amplitude),
  }));
}

function deviationFromPolylinePx(points: Pixel[], kept: Pixel[]): number {
  let worst = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 0; i + 1 < kept.length; i++) {
      best = Math.min(best, distanceToSegmentPx(p, kept[i], kept[i + 1]));
    }
    if (kept.length === 1) best = Math.hypot(p.x - kept[0].x, p.y - kept[0].y);
    worst = Math.max(worst, best);
  }
  return worst;
}

function distanceToSegmentPx(p: Pixel, a: Pixel, b: Pixel): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

describe('decimateTrack', () => {
  it.for([
    { name: 'empty track', lat: [], lon: [], want: 0 },
    { name: 'single point', lat: [46.61], lon: [14.26], want: 1 },
    { name: 'two points', lat: [46.61, 46.62], lon: [14.26, 14.27], want: 2 },
  ])('keeps trivial tracks intact: $name', ({ lat, lon, want }) => {
    const t = decimateTrack(lat, lon, ZOOM);
    expect(t.frame).toHaveLength(want);
    expect(t.lat).toEqual(lat);
    expect(t.lon).toEqual(lon);
  });

  it('collapses a straight line to its endpoints', () => {
    const { lat, lon } = trackFromPixels(linePixels(100));
    const t = decimateTrack(lat, lon, ZOOM);
    expect(t.frame).toEqual([0, 99]);
  });

  it.for([
    { name: 'epsilon 1 keeps a 3 px bump', epsilonPx: 1, wantBump: true },
    { name: 'epsilon 5 drops a 3 px bump', epsilonPx: 5, wantBump: false },
  ])('$name', ({ epsilonPx, wantBump }) => {
    const { lat, lon } = trackFromPixels([
      { x: 0, y: 500 },
      { x: 25, y: 500 },
      { x: 50, y: 497 },
      { x: 75, y: 500 },
      { x: 100, y: 500 },
    ]);
    const t = decimateTrack(lat, lon, ZOOM, { epsilonPx });
    expect(t.frame.includes(2)).toBe(wantBump);
    expect(t.frame).toContain(0);
    expect(t.frame).toContain(4);
  });

  it.for([
    { name: 'straight line', points: linePixels(50) },
    { name: 'zigzag', points: zigzagPixels(50, 6) },
    {
      name: 'hover cluster',
      points: [
        ...linePixels(10).map(() => ({ x: 20, y: 500 })),
        ...linePixels(10),
      ],
    },
  ])('stays within epsilon of the original track: $name', ({ points }) => {
    const { lat, lon } = trackFromPixels(points);
    const t = decimateTrack(lat, lon, ZOOM, { epsilonPx: 1 });
    const kept = t.lat.map((la, i) => project(t.lon[i], la, ZOOM));
    expect(deviationFromPolylinePx(points, kept)).toBeLessThanOrEqual(1.0000001);
  });

  it.for([
    {
      name: 'long noisy track',
      points: zigzagPixels(12000, 3),
      maxPoints: 300,
    },
    {
      name: 'cap barely below input size',
      points: zigzagPixels(100, 2),
      maxPoints: 40,
    },
  ])('honors the point cap: $name', ({ points, maxPoints }) => {
    const { lat, lon } = trackFromPixels(points);
    const t = decimateTrack(lat, lon, ZOOM, { maxPoints });
    expect(t.frame.length).toBeLessThanOrEqual(maxPoints);
    expect(t.frame[0]).toBe(0);
    expect(t.frame[t.frame.length - 1]).toBe(points.length - 1);
    for (let i = 1; i < t.frame.length; i++) {
      expect(t.frame[i]).toBeGreaterThan(t.frame[i - 1]);
    }
    for (let i = 0; i < t.frame.length; i++) {
      expect(t.lat[i]).toBe(lat[t.frame[i]]);
      expect(t.lon[i]).toBe(lon[t.frame[i]]);
    }
  });

  it('is deterministic across runs', () => {
    const { lat, lon } = trackFromPixels(zigzagPixels(500, 4));
    const a = decimateTrack(lat, lon, ZOOM);
    const b = decimateTrack(lat, lon, ZOOM);
    expect(a).toEqual(b);
  });

  it('keeps every vertex of a zigzag that exceeds the epsilon', () => {
    const { lat, lon } = trackFromPixels(zigzagPixels(21, 40));
    const t = decimateTrack(lat, lon, ZOOM, { epsilonPx: 1 });
    expect(t.frame).toEqual(lat.map((_, i) => i));
  });

  it.for([
    { name: 'negative epsilon', epsilonPx: -1, maxPoints: 100, mismatch: false },
    { name: 'zero maxPoints', epsilonPx: 1, maxPoints: 0, mismatch: false },
    { name: 'fractional maxPoints', epsilonPx: 1, maxPoints: 2.5, mismatch: false },
    { name: 'mismatched arrays', epsilonPx: 1, maxPoints: 100, mismatch: true },
  ])('rejects invalid options: $name', ({ epsilonPx, maxPoints, mismatch }) => {
    expect(() =>
      decimateTrack(
        mismatch ? [46.6, 46.7] : [46.6],
        [14.2],
        ZOOM,
        { epsilonPx, maxPoints },
      ),
    ).toThrow();
  });
});
