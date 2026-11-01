import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseTilePathname, tilePaths } from '../src/tilecache.js';

describe('parseTilePathname', () => {
  it.for(['satellite', 'topo'])('parses a %s tile into a typed ref', (style) => {
    expect(parseTilePathname(`/tiles/${style}/12/34/56.png`)).toEqual({
      style,
      tile: { z: 12, x: 34, y: 56 },
    });
  });

  it.for([
    '/tiles/evil/1/2/3.png',
    '/tiles/satellite/1/2/3.jpg',
    '/tiles/satellite/1/2.png',
    '/elsewhere/satellite/1/2/3.png',
  ])('returns null for the non-tile path %s', (pathname) => {
    expect(parseTilePathname(pathname)).toBeNull();
  });
});

describe('tilePaths', () => {
  it('lays out the tile and its placeholder under the style cache key', () => {
    const paths = tilePaths(path.join('cache'), 'satellite', { z: 12, x: 34, y: 56 });
    expect(paths.file).toBe(path.join('cache', 'esri-imagery', '12', '34', '56.png'));
    expect(paths.placeholder).toBe(
      path.join('cache', 'esri-imagery', '12', '34', '56.placeholder.png'),
    );
  });
});
