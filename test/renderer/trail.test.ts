import { describe, expect, it } from 'vitest';

import { createTrailController, lastIndexAtOrBefore } from '../../src/renderer/trail.js';
import type { TrailLayer } from '../../src/renderer/trail.js';

interface Call {
  kind: 'add' | 'set';
  points: Array<[number, number]>;
}

function spyLayer(): { calls: Call[]; layer: TrailLayer } {
  const calls: Call[] = [];
  return {
    calls,
    layer: {
      addLatLng(latlng: [number, number]): void {
        calls.push({ kind: 'add', points: [[latlng[0], latlng[1]]] });
      },
      setLatLngs(points: Array<[number, number]>): void {
        calls.push({
          kind: 'set',
          points: points.map((p) => [p[0], p[1]] as [number, number]),
        });
      },
    },
  };
}

// Decimated track where point j sits at frame 2j (frames 0, 2, 4, ...).
function track(points: number): { lat: number[]; lon: number[]; frame: number[] } {
  const lat: number[] = [];
  const lon: number[] = [];
  const frame: number[] = [];
  for (let j = 0; j < points; j++) {
    lat.push(46 + j * 0.001);
    lon.push(14 + j * 0.001);
    frame.push(j * 2);
  }
  return { lat, lon, frame };
}

describe('lastIndexAtOrBefore', () => {
  it.for([
    { name: 'empty array has no index', frames: [], i: 5, want: -1 },
    { name: 'all frames greater than i', frames: [2, 4, 6], i: 1, want: -1 },
    { name: 'before the first frame', frames: [2, 4, 6], i: 0, want: -1 },
    { name: 'exact hit lands on its index', frames: [2, 4, 6], i: 4, want: 1 },
    { name: 'exact hit on the first frame', frames: [2, 4, 6], i: 2, want: 0 },
    { name: 'exact hit on the last frame', frames: [2, 4, 6], i: 6, want: 2 },
    { name: 'between hits lands on the earlier index', frames: [2, 4, 6], i: 3, want: 0 },
    { name: 'between later hits lands on the earlier index', frames: [2, 4, 6], i: 5, want: 1 },
    { name: 'past the last frame lands on it', frames: [2, 4, 6], i: 100, want: 2 },
    { name: 'single point hit', frames: [7], i: 7, want: 0 },
  ])('$name', ({ frames, i, want }) => {
    expect(lastIndexAtOrBefore(frames, i)).toBe(want);
  });
});

describe('createTrailController', () => {
  it('appends decimated points forward without any array copies', () => {
    const t = track(5);
    const a = spyLayer();
    const ctl = createTrailController(t.lat, t.lon, t.frame, [a.layer]);
    for (let i = 0; i <= 8; i++) ctl.setFrame(i);
    expect(a.calls.map((c) => c.kind)).toEqual(['add', 'add', 'add', 'add', 'add']);
    a.calls.forEach((c, j) => expect(c.points).toEqual([[t.lat[j], t.lon[j]]]));
  });

  it('truncates the trail on backward seeks with no stale segments', () => {
    const t = track(5);
    const a = spyLayer();
    const ctl = createTrailController(t.lat, t.lon, t.frame, [a.layer]);
    ctl.setFrame(8);
    a.calls.length = 0;
    ctl.setFrame(5);
    expect(a.calls).toEqual([{ kind: 'set', points: [[t.lat[0], t.lon[0]], [t.lat[1], t.lon[1]], [t.lat[2], t.lon[2]]] }]);
  });

  it('truncates back to the very first point', () => {
    const t = track(5);
    const a = spyLayer();
    const ctl = createTrailController(t.lat, t.lon, t.frame, [a.layer]);
    ctl.setFrame(8);
    a.calls.length = 0;
    ctl.setFrame(0);
    expect(a.calls).toEqual([{ kind: 'set', points: [[t.lat[0], t.lon[0]]] }]);
  });

  it('rebuilds once on a large forward jump instead of appending per point', () => {
    const t = track(101);
    const a = spyLayer();
    const ctl = createTrailController(t.lat, t.lon, t.frame, [a.layer]);
    ctl.setFrame(0);
    a.calls.length = 0;
    ctl.setFrame(100);
    expect(a.calls.map((c) => c.kind)).toEqual(['set']);
    expect(a.calls[0].points).toHaveLength(51);
  });

  it('keeps appending for small forward advances', () => {
    const t = track(101);
    const a = spyLayer();
    const ctl = createTrailController(t.lat, t.lon, t.frame, [a.layer]);
    for (let i = 0; i <= 8; i++) ctl.setFrame(i);
    expect(a.calls.map((c) => c.kind)).toEqual(['add', 'add', 'add', 'add', 'add']);
  });

  it('is idempotent for repeated frame indices', () => {
    const t = track(5);
    const a = spyLayer();
    const ctl = createTrailController(t.lat, t.lon, t.frame, [a.layer]);
    ctl.setFrame(4);
    a.calls.length = 0;
    ctl.setFrame(4);
    ctl.setFrame(4);
    expect(a.calls).toEqual([]);
  });

  it('drives all layers with identical updates', () => {
    const t = track(3);
    const a = spyLayer();
    const b = spyLayer();
    const ctl = createTrailController(t.lat, t.lon, t.frame, [a.layer, b.layer]);
    ctl.setFrame(0);
    ctl.setFrame(1);
    ctl.setFrame(4);
    ctl.setFrame(2);
    expect(a.calls).toEqual(b.calls);
  });

  it('stays quiet for an empty track', () => {
    const a = spyLayer();
    const ctl = createTrailController([], [], [], [a.layer]);
    ctl.setFrame(100);
    expect(a.calls).toEqual([]);
  });

  it('truncates fully when the target precedes the first decimated point', () => {
    const t = track(3);
    const a = spyLayer();
    const ctl = createTrailController(t.lat, t.lon, t.frame, [a.layer]);
    ctl.setFrame(4);
    a.calls.length = 0;
    ctl.setFrame(-1);
    expect(a.calls).toEqual([{ kind: 'set', points: [] }]);
  });
});
