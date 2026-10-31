import { describe, expect, it } from 'vitest';

import {
  computeScale,
  introOutroScale,
  metersPerPixel,
  scaleBarMeters,
  smoothstep,
} from '../../src/renderer/framemath.js';

describe('computeScale', () => {
  it.for([
    { name: 'square frame', width: 1024, height: 1024, want: 1 },
    { name: 'width-bound frame', width: 1920, height: 1080, want: 1080 / 1024 },
    { name: 'clamped small frame', width: 320, height: 240, want: 0.7 },
    { name: 'clamped large frame', width: 4096, height: 4096, want: 2.2 },
  ])('$name scales to $want', ({ width, height, want }) => {
    expect(computeScale(width, height)).toBeCloseTo(want);
  });
});

describe('smoothstep', () => {
  it.for([
    { t: 0, want: 0 },
    { t: 1, want: 1 },
    { t: 0.5, want: 0.5 },
    { t: -3, want: 0 },
    { t: 7, want: 1 },
  ])('smoothstep($t) = $want', ({ t, want }) => {
    expect(smoothstep(t)).toBeCloseTo(want);
  });
});

describe('introOutroScale', () => {
  it.for([
    { name: 'no intro or outro', i: 5, introN: 0, outroN: 0, totalN: 10, want: 1 },
    { name: 'intro start', i: 0, introN: 4, outroN: 0, totalN: 10, want: 0.5 },
    { name: 'intro end is full size', i: 4, introN: 4, outroN: 0, totalN: 10, want: 1 },
    { name: 'outro end', i: 9, introN: 0, outroN: 2, totalN: 10, want: 0.5 },
    { name: 'outro start boundary is full size', i: 7, introN: 0, outroN: 2, totalN: 10, want: 1 },
    { name: 'mid outro', i: 8, introN: 0, outroN: 2, totalN: 10, want: Math.pow(2, -0.5) },
    { name: 'both ends take the minimum', i: 0, introN: 4, outroN: 4, totalN: 4, want: 0.5 },
  ])('$name', ({ i, introN, outroN, totalN, want }) => {
    expect(introOutroScale(i, introN, outroN, totalN)).toBeCloseTo(want);
  });
});

describe('metersPerPixel', () => {
  it.for([
    { name: 'equator at zoom 0', lat: 0, zoom: 0, want: 156543.033928 },
    { name: 'halves per zoom level', lat: 0, zoom: 1, want: 78271.516964 },
    { name: 'shrinks with latitude', lat: 60, zoom: 0, want: 156543.033928 * Math.cos(Math.PI / 3) },
  ])('$name', ({ lat, zoom, want }) => {
    expect(metersPerPixel(lat, zoom)).toBeCloseTo(want);
  });
});

describe('scaleBarMeters', () => {
  it.for([
    { name: 'largest step that fits', mPerPx: 1, maxPx: 110, want: 100 },
    { name: 'smallest step when none fits', mPerPx: 0.02, maxPx: 110, want: 5 },
    { name: 'largest step when all fit', mPerPx: 1000, maxPx: 110, want: 10000 },
    { name: 'exact fit counts as fitting', mPerPx: 2, maxPx: 110, want: 200 },
  ])('picks the $name', ({ mPerPx, maxPx, want }) => {
    expect(scaleBarMeters(mPerPx, maxPx)).toBe(want);
  });
});
