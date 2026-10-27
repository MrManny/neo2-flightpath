import { describe, expect, it } from 'vitest';

import { computeOverview, solidPng } from '../src/tiles.js';
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

describe('solidPng', () => {
  it('writes a valid PNG signature and 256x256 IHDR', () => {
    const buf = solidPng('#2a2f38');
    expect([...buf.subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(buf.readUInt32BE(16)).toBe(256); // IHDR width
    expect(buf.readUInt32BE(20)).toBe(256); // IHDR height
  });
});
