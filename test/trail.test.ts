import { describe, expect, it } from 'vitest';

import { createTrailController } from '../src/trail.js';
import type { TrailLayer } from '../src/trail.js';

interface Call {
  kind: 'add' | 'set';
  points: Array<[number, number]>;
}

function spyLayer(): { calls: Call[]; layer: TrailLayer } {
  const calls: Call[] = [];
  return {
    calls,
    layer: {
      addLatLng(lat: number, lon: number): void {
        calls.push({ kind: 'add', points: [[lat, lon]] });
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

  // The page embeds the function source verbatim; this guards the
  // self-containment contract that toString() embedding depends on.
  it('evaluates standalone from its toString() source', () => {
    const src = createTrailController.toString();
    const revived = new Function(`return (${src})`)() as typeof createTrailController;
    const t = track(30);
    const a = spyLayer();
    const ctl = revived(t.lat, t.lon, t.frame, [a.layer]);
    ctl.setFrame(20);
    ctl.setFrame(0);
    expect(a.calls.map((c) => c.kind)).toEqual(['set', 'set']);
  });
});
