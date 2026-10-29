import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, PANEL_PRESETS } from '../../src/config.js';
import { applyPreset, patchConfig, setHudChip } from '../../ui/lib/settings.js';

describe('patchConfig', () => {
  it('applies a valid patch', () => {
    const next = patchConfig(DEFAULT_CONFIG, { style: 'topo', zoom: 14 });
    expect(next?.style).toBe('topo');
    expect(next?.zoom).toBe(14);
  });

  it('rejects values the CLI would reject', () => {
    expect(patchConfig(DEFAULT_CONFIG, { zoom: -1 })).toBeNull();
    expect(patchConfig(DEFAULT_CONFIG, { introSec: -0.5 })).toBeNull();
    expect(patchConfig(DEFAULT_CONFIG, { outSuffix: '' })).toBeNull();
  });

  it('keeps the hud object whole across patches', () => {
    const next = patchConfig(DEFAULT_CONFIG, { zoom: 3 });
    expect(next?.hud).toEqual(DEFAULT_CONFIG.hud);
  });
});

describe('applyPreset', () => {
  it('applies a complete bundle in one call', () => {
    const preset = PANEL_PRESETS.find((p) => p.id === 'topo-full-hud');
    const next = applyPreset(DEFAULT_CONFIG, preset!);
    expect(next).toMatchObject({
      style: 'topo',
      view: 'follow',
      zoom: 0,
      zoomOut: 1,
      introSec: 2,
      outroSec: 2,
      hud: { heading: true, alt: true, speed: true },
    });
  });

  it('leaves no stale look value behind when switching presets', () => {
    const quick = PANEL_PRESETS.find((p) => p.id === 'quick-render')!;
    const topo = PANEL_PRESETS.find((p) => p.id === 'topo-full-hud')!;
    const tweaked = patchConfig(applyPreset(DEFAULT_CONFIG, quick), {
      zoom: 17,
    })!;
    const next = applyPreset(tweaked, topo);
    expect(next.zoom).toBe(0);
    expect(next.introSec).toBe(2);
  });

  it('manual tweaks after a preset still work', () => {
    const quick = PANEL_PRESETS.find((p) => p.id === 'quick-render')!;
    const next = patchConfig(applyPreset(DEFAULT_CONFIG, quick), {
      introSec: 1.5,
    })!;
    expect(next.introSec).toBe(1.5);
    expect(next.style).toBe('satellite');
  });
});

describe('setHudChip', () => {
  it('flips one chip and keeps the others', () => {
    expect(setHudChip(DEFAULT_CONFIG.hud, 'speed', true)).toEqual({
      heading: true,
      alt: false,
      speed: true,
    });
    expect(setHudChip(DEFAULT_CONFIG.hud, 'heading', false)).toEqual({
      heading: false,
      alt: false,
      speed: false,
    });
  });
});
