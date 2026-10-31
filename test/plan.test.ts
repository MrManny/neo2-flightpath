import { describe, expect, it, vi } from 'vitest';

import { computeOverview, planIntroOutroFrames } from '../src/plan.js';
import type { Bbox } from '../src/geo.js';

const BBOX: Bbox = {
  minLat: 46.6129,
  maxLat: 46.6132,
  minLon: 14.2622,
  maxLon: 14.2626,
};

describe('computeOverview', () => {
  it('auto-fits a small track inside the frame', () => {
    const r = computeOverview({ bbox: BBOX, width: 768, height: 768 });
    expect(r.zoom).toBeGreaterThanOrEqual(2);
    expect(r.zoom).toBeLessThanOrEqual(19);
    expect(r.tiles.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.centerPx.x)).toBe(true);
    expect(Number.isFinite(r.centerPx.y)).toBe(true);
  });

  it('clamps hover-scale spans at zoom 16 for a useful close-up', () => {
    // ~0.1 m span: the >=80 px rule pulls the camera out to the zoom-16 floor.
    const hover: Bbox = {
      minLat: 46.6130705,
      maxLat: 46.61307051,
      minLon: 14.2623885,
      maxLon: 14.26238851,
    };
    const r = computeOverview({ bbox: hover, width: 768, height: 768 });
    expect(r.zoom).toBe(16);
    expect(r.tiles.length).toBeGreaterThan(0);
  });

  it('honors a fixed zoom override', () => {
    const r = computeOverview({
      bbox: BBOX,
      width: 768,
      height: 768,
      zoomOverride: 15,
    });
    expect(r.zoom).toBe(15);
  });

  it('pulls the camera back with zoomOut', () => {
    const base = computeOverview({ bbox: BBOX, width: 768, height: 768 });
    const out = computeOverview({
      bbox: BBOX,
      width: 768,
      height: 768,
      zoomOut: 2,
    });
    expect(out.zoom).toBeLessThanOrEqual(base.zoom);
  });

  it('fetches topo tiles at the native zoom level when zoomed in', () => {
    const r = computeOverview({
      bbox: BBOX,
      width: 768,
      height: 768,
      zoomOverride: 18,
      maxNativeZoom: 17,
    });
    expect(r.zoom).toBe(18);
    expect(r.tiles.every((t) => t.z === 17)).toBe(true);
  });
});

describe.for([
  {
    name: 'maps seconds to frames at the source rate',
    config: { introSec: 2, outroSec: 3 },
    source: { fps: 30, frames: 3000 },
    want: { introN: 60, outroN: 90 },
  },
  {
    name: 'accepts a zero intro and outro',
    config: { introSec: 0, outroSec: 0 },
    source: { fps: 24, frames: 100 },
    want: { introN: 0, outroN: 0 },
  },
  {
    name: 'rounds fractional frame rates',
    config: { introSec: 1, outroSec: 0 },
    source: { fps: 29.97, frames: 9000 },
    want: { introN: 30, outroN: 0 },
  },
])('planIntroOutroFrames: $name', ({ config, source, want }) => {
  it('plans the frame counts', () => {
    expect(planIntroOutroFrames(config, source, () => {})).toEqual(want);
  });
});

describe('planIntroOutroFrames clamping', () => {
  it('shortens intro and outro for a very short clip and logs it', () => {
    const log = vi.fn();
    const r = planIntroOutroFrames(
      { introSec: 2, outroSec: 2 },
      { fps: 30, frames: 60 },
      log,
    );
    expect(r).toEqual({ introN: 15, outroN: 15 });
    expect(log).toHaveBeenCalledWith(
      'intro/outro shortened to 15/15 frames for this clip',
    );
  });

  it('keeps tiny clips playable with a two-frame budget', () => {
    const r = planIntroOutroFrames(
      { introSec: 2, outroSec: 2 },
      { fps: 30, frames: 3 },
      () => {},
    );
    expect(r.introN + r.outroN).toBeLessThanOrEqual(2);
    expect(r.introN).toBeGreaterThanOrEqual(0);
    expect(r.outroN).toBeGreaterThanOrEqual(0);
  });
});
