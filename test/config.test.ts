import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONFIG,
  formatHud,
  normalizeOverrides,
  parseExportRequest,
  parseFrameRange,
  parseHud,
  resolveHudSpec,
  validateRenderConfig,
} from '../src/config.js';

describe('parseHud', () => {
  it('parses comma lists', () => {
    expect(parseHud('heading,alt')).toEqual({
      heading: true,
      alt: true,
      speed: false,
    });
  });

  it('parses none', () => {
    expect(parseHud('none')).toEqual({
      heading: false,
      alt: false,
      speed: false,
    });
  });

  it('rejects unknown components', () => {
    expect(() => parseHud('heading,bogus')).toThrow(/unknown --hud component/);
  });
});

describe('normalizeOverrides', () => {
  it('converts and validates known keys', () => {
    expect(
      normalizeOverrides(
        { zoom: '5', hud: 'heading,alt', skipExisting: true },
        'test',
      ),
    ).toEqual({
      zoom: 5,
      hud: { heading: true, alt: true, speed: false },
      skipExisting: true,
    });
  });

  it('rejects unknown keys', () => {
    expect(() => normalizeOverrides({ bogus: 1 }, 'test')).toThrow(
      /unknown config key/,
    );
  });

  it('skips null and undefined values', () => {
    expect(normalizeOverrides({ outDir: null, zoom: undefined }, 'test')).toEqual({});
  });
});

describe('validateRenderConfig', () => {
  it('accepts the built-in defaults', () => {
    expect(() => validateRenderConfig({ ...DEFAULT_CONFIG })).not.toThrow();
  });

  it.for([
    { name: 'zero workers', patch: { workers: 0 } },
    { name: 'tiny width', patch: { width: 10 } },
    { name: 'negative zoom', patch: { zoom: -1 } },
    { name: 'negative zoom-out', patch: { zoomOut: -1 } },
    { name: 'negative intro', patch: { introSec: -1 } },
    { name: 'negative outro', patch: { outroSec: -1 } },
    { name: 'empty out-suffix', patch: { outSuffix: '' } },
    { name: 'NaN zoom', patch: { zoom: NaN } },
  ])('rejects $name', ({ patch }) => {
    expect(() =>
      validateRenderConfig({ ...DEFAULT_CONFIG, ...patch }),
    ).toThrow();
  });
});

describe('resolveHudSpec', () => {
  it('keeps the alt chip when the telemetry has altitude', () => {
    const hud = { heading: true, alt: true, speed: false };
    expect(resolveHudSpec(hud, true)).toEqual(hud);
  });

  it('drops the alt chip when the telemetry has no altitude', () => {
    expect(
      resolveHudSpec({ heading: true, alt: true, speed: true }, false),
    ).toEqual({ heading: true, alt: false, speed: true });
  });

  it('leaves the other chips untouched when alt is already off', () => {
    const hud = { heading: true, alt: false, speed: true };
    expect(resolveHudSpec(hud, false)).toEqual(hud);
  });
});

describe('formatHud', () => {
  it('round-trips through parseHud', () => {
    for (const list of ['heading', 'heading,alt', 'alt,speed', 'heading,alt,speed', 'none']) {
      expect(formatHud(parseHud(list))).toBe(list);
    }
  });
});

describe('parseFrameRange', () => {
  it('accepts an inclusive start < end range', () => {
    expect(parseFrameRange({ start: 10, end: 29 })).toEqual({ start: 10, end: 29 });
  });

  it.each([
    ['start equal to end', { start: 5, end: 5 }],
    ['start after end', { start: 9, end: 2 }],
    ['negative start', { start: -1, end: 4 }],
    ['fractional index', { start: 1.5, end: 4 }],
    ['non-numeric end', { start: 0, end: 'x' }],
    ['unknown key', { start: 0, end: 4, fps: 30 }],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseFrameRange(raw)).toThrow(/invalid|unknown/);
  });

  it('rejects non-object input', () => {
    expect(() => parseFrameRange(null)).toThrow('invalid frame range');
    expect(() => parseFrameRange([0, 4])).toThrow('invalid frame range');
  });
});

describe('parseExportRequest', () => {
  const base = { ...DEFAULT_CONFIG, outDir: null, tileCache: '/cache' };
  const validConfig = { width: 1280, height: 720, style: 'topo', hud: { heading: true, alt: true, speed: false } };

  it('builds the snapshot on top of the base config, with the range', () => {
    const request = parseExportRequest(
      { outPath: '/exports/flight_map.mp4', config: validConfig, range: { start: 4, end: 9 } },
      base,
    );
    expect(request.outPath).toBe('/exports/flight_map.mp4');
    expect(request.range).toEqual({ start: 4, end: 9 });
    expect(request.config).toMatchObject({ width: 1280, height: 720, style: 'topo', tileCache: '/cache' });
    expect(request.config.hud).toEqual({ heading: true, alt: true, speed: false });
  });

  it('treats a missing or null range as the full recording', () => {
    expect(parseExportRequest({ outPath: '/x/a.mp4', config: {} }, base).range).toBeNull();
    expect(parseExportRequest({ outPath: '/x/a.mp4', config: {}, range: null }, base).range).toBeNull();
  });

  it.each([
    ['a non-mp4 path', { outPath: '/x/a.mov', config: {} }, /must be an \.mp4/],
    ['an unknown top-level key', { outPath: '/x/a.mp4', config: {}, extra: 1 }, /unknown export request key/],
    ['a missing config', { outPath: '/x/a.mp4' }, /invalid export request: config/],
    ['an unknown config key', { outPath: '/x/a.mp4', config: { bogus: 1 } }, /unknown config key bogus/],
    ['a too-small width', { outPath: '/x/a.mp4', config: { width: 32 } }, /at least 64/],
    ['a malformed hud object', { outPath: '/x/a.mp4', config: { hud: { heading: 'yes' } } }, /heading/],
    ['an invalid range', { outPath: '/x/a.mp4', config: {}, range: { start: 8, end: 3 } }, /invalid/],
  ])('rejects %s', (_label, raw, pattern) => {
    expect(() => parseExportRequest(raw, base)).toThrow(pattern);
  });

  it('rejects a non-object request', () => {
    expect(() => parseExportRequest('nope', base)).toThrow('invalid export request');
  });
});
