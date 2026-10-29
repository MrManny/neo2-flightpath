import { describe, expect, it } from 'vitest';

import { TILE_SOURCES } from '../src/tilesources.js';

describe('TILE_SOURCES', () => {
  it.for(['satellite', 'topo'] as const)('%s source is complete and usable', (style) => {
    const src = TILE_SOURCES[style];
    expect(src.cacheKey).toBeTruthy();
    expect(src.url).toContain('{z}');
    expect(src.url).toContain('{x}');
    expect(src.url).toContain('{y}');
    expect(src.subdomains.length).toBeGreaterThan(0);
    expect(src.attribution).toBeTruthy();
    expect(src.bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(src.placeholderBg).toMatch(/^#[0-9a-f]{6}$/);
    expect(src.maxZoom).toBeGreaterThanOrEqual(1);
    if (src.maxNativeZoom !== undefined) {
      expect(src.maxNativeZoom).toBeLessThan(src.maxZoom);
    }
  });
});
