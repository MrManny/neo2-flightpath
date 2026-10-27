import { describe, expect, it } from 'vitest';

import {
  bearingDeg,
  circularMeanDeg,
  haversineM,
  project,
  unproject,
} from '../src/geo.js';

describe('haversineM', () => {
  it('measures 0.01 degrees of latitude as ~1112 m', () => {
    const d = haversineM({ lat: 46.6, lon: 14.2 }, { lat: 46.61, lon: 14.2 });
    expect(d).toBeGreaterThan(1110);
    expect(d).toBeLessThan(1114);
  });

  it('returns 0 for identical points', () => {
    expect(haversineM({ lat: 46.6, lon: 14.2 }, { lat: 46.6, lon: 14.2 })).toBe(0);
  });
});

describe('bearingDeg', () => {
  it('points north for a northward leg', () => {
    const b = bearingDeg({ lat: 46.6, lon: 14.2 }, { lat: 46.61, lon: 14.2 });
    expect(Math.min(b, 360 - b)).toBeLessThan(1e-6);
  });

  it('points east for an eastward leg on the equator', () => {
    const b = bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 });
    expect(b).toBeCloseTo(90, 6);
  });
});

describe('circularMeanDeg', () => {
  it('averages across the north wrap', () => {
    const m = circularMeanDeg([350, 10]);
    expect(Math.min(m, 360 - m)).toBeLessThan(1e-6);
  });
});

describe('project/unproject', () => {
  it('round-trips a WGS84 coordinate', () => {
    const p = project(14.262388, 46.61307, 15);
    const u = unproject(p.x, p.y, 15);
    expect(u.lat).toBeCloseTo(46.61307, 8);
    expect(u.lon).toBeCloseTo(14.262388, 8);
  });
});
