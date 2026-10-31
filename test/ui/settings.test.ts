import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../src/config.js';
import { patchConfig, setHudChip } from '../../ui/lib/settings.js';

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
