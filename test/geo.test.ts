import { describe, expect, it } from 'vitest';

import {
  bearingDeg,
  circularMeanDeg,
  haversineM,
  isGpsFix,
  project,
  unproject,
} from '../src/geo.js';

describe('isGpsFix', () => {
  it.for([
    { name: 'regular fix', lat: 46.61307, lon: 14.262388, want: true },
    { name: 'prime meridian crossing', lat: 10.2, lon: 0.2, want: true },
    { name: 'equator crossing', lat: 0.2, lon: 10.2, want: true },
    { name: 'near-null-island coordinates', lat: 0.1, lon: 0.1, want: true },
    { name: 'the 0.5 boundary', lat: 0.5, lon: 0.5, want: true },
    { name: 'exactly the 0/0 placeholder', lat: 0, lon: 0, want: false },
    { name: 'negative-zero placeholder', lat: -0, lon: 0, want: false },
    { name: 'out-of-range latitude', lat: 91, lon: 0, want: false },
    { name: 'out-of-range longitude', lat: 0, lon: 181, want: false },
    { name: 'north pole edge', lat: 90, lon: 0, want: false },
    { name: 'NaN', lat: NaN, lon: 1, want: false },
    { name: 'Infinity', lat: 1, lon: Infinity, want: false },
  ])('$name -> $want', ({ lat, lon, want }) => {
    expect(isGpsFix(lat, lon)).toBe(want);
  });
});

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
