import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONFIG,
  normalizeOverrides,
  PANEL_PRESETS,
  parseHud,
  resolveHudSpec,
  validateRenderConfig,
} from '../src/config.js';
import type { RenderConfig } from '../src/config.js';

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

describe('PANEL_PRESETS', () => {
  const PANEL_KEYS: Array<keyof RenderConfig> = [
    'style',
    'view',
    'zoom',
    'zoomOut',
    'introSec',
    'outroSec',
    'hud',
  ];

  it('names the two documented presets', () => {
    expect(PANEL_PRESETS.map((p) => p.label)).toEqual([
      'Quick render',
      'Topo + full HUD',
    ]);
  });

  it('has unique ids', () => {
    const ids = PANEL_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('bundles every panel knob so no stale values survive a switch', () => {
    for (const preset of PANEL_PRESETS) {
      for (const key of PANEL_KEYS) {
        expect(preset.overrides).toHaveProperty(key);
      }
    }
  });

  it('resolves each bundle to a valid config', () => {
    for (const preset of PANEL_PRESETS) {
      const config = {
        ...DEFAULT_CONFIG,
        ...preset.overrides,
        hud: preset.overrides.hud ?? DEFAULT_CONFIG.hud,
      };
      expect(() => validateRenderConfig(config)).not.toThrow();
    }
  });
});
