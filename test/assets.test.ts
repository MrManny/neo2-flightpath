import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { mimeFor, resolveAsset, resolveTileRoute } from '../src/assets.js';
import type { AssetRoutes } from '../src/assets.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';

afterEach(cleanupTmpDirs);

function routes(overrides: Partial<AssetRoutes> = {}): AssetRoutes {
  const root = tmpDir();
  return {
    leafletDir: path.join(root, 'leaflet'),
    style: 'satellite',
    tileCache: path.join(root, 'tiles'),
    rendererDir: path.join(root, 'renderer'),
    ...overrides,
  };
}

describe('mimeFor', () => {
  it.for([
    { name: 'HTML pages', filePath: '/x/index.html', want: 'text/html; charset=utf-8' },
    { name: 'ES modules', filePath: '/x/boot.js', want: 'text/javascript; charset=utf-8' },
    { name: 'stylesheets', filePath: '/x/leaflet.css', want: 'text/css; charset=utf-8' },
    { name: 'tiles', filePath: '/x/3.png', want: 'image/png' },
    { name: 'recordings', filePath: '/x/clip.mp4', want: 'video/mp4' },
    { name: 'uppercase extensions', filePath: '/x/CLIP.MP4', want: 'video/mp4' },
    {
      name: 'unknown extensions',
      filePath: '/x/leaflet.js.map',
      want: 'application/octet-stream',
    },
  ])('maps $name to one content type', ({ filePath, want }) => {
    expect(mimeFor(filePath)).toBe(want);
  });
});

describe('resolveTileRoute', () => {
  it('resolves the configured style with its placeholder fallback', () => {
    const r = routes();
    expect(
      resolveTileRoute('/tiles/satellite/1/2/3.png', r.tileCache, {
        style: 'satellite',
      }),
    ).toEqual({
      style: 'satellite',
      tile: { z: 1, x: 2, y: 3 },
      filePath: path.join(r.tileCache, 'esri-imagery', '1', '2', '3.png'),
      placeholderPath: path.join(
        r.tileCache,
        'esri-imagery',
        '1',
        '2',
        '3.placeholder.png',
      ),
    });
  });

  it('refuses a style the single-style policy does not serve', () => {
    expect(
      resolveTileRoute('/tiles/topo/1/2/3.png', routes().tileCache, {
        style: 'satellite',
      }),
    ).toBeNull();
  });

  it.for(['satellite', 'topo'] as const)(
    'accepts %s under the any-style policy',
    (style) => {
      expect(
        resolveTileRoute(`/tiles/${style}/1/2/3.png`, routes().tileCache, {
          anyStyle: true,
        })?.style,
      ).toBe(style);
    },
  );

  it.for([
    { name: 'an unknown style', pathname: '/tiles/evil/1/2/3.png' },
    { name: 'a non-png tile path', pathname: '/tiles/satellite/1/2/3.jpg' },
    { name: 'a non-tile path', pathname: '/index.html' },
  ])('resolves $name to null', ({ pathname }) => {
    expect(
      resolveTileRoute(pathname, routes().tileCache, { anyStyle: true }),
    ).toBeNull();
  });
});

describe('resolveAsset', () => {
  it.for([
    {
      name: 'leaflet.js',
      url: '/leaflet/leaflet.js',
      want: 'text/javascript; charset=utf-8',
    },
    {
      name: 'leaflet.css',
      url: '/leaflet/leaflet.css',
      want: 'text/css; charset=utf-8',
    },
    {
      name: 'source maps',
      url: '/leaflet/leaflet.js.map',
      want: 'application/octet-stream',
    },
    {
      name: 'marker images',
      url: '/leaflet/images/marker-icon.png',
      want: 'image/png',
    },
  ])('routes $name from the Leaflet distribution', ({ url, want }) => {
    const r = routes();
    const asset = resolveAsset(url, r);
    expect(asset.kind).toBe('file');
    if (asset.kind === 'file') {
      expect(asset.filePath).toBe(
        path.join(r.leafletDir, url.slice('/leaflet/'.length)),
      );
      expect(asset.mime).toBe(want);
      expect(asset.fallbackPath).toBeUndefined();
    }
  });

  it.for([
    { name: 'a non-whitelisted file', url: '/leaflet/evil.txt' },
    { name: 'a directory escape', url: '/leaflet/../secret.js' },
    { name: 'an unlisted image', url: '/leaflet/images/evil.txt' },
    { name: 'a nested image path', url: '/leaflet/images/deep/x.png' },
  ])('claims but refuses $name in /leaflet/', ({ url }) => {
    expect(resolveAsset(url, routes())).toEqual({ kind: 'missing' });
  });

  it('routes the configured tile style with the placeholder as fallback', () => {
    const r = routes();
    expect(resolveAsset('/tiles/satellite/1/2/3.png', r)).toEqual({
      kind: 'file',
      filePath: path.join(r.tileCache, 'esri-imagery', '1', '2', '3.png'),
      fallbackPath: path.join(
        r.tileCache,
        'esri-imagery',
        '1',
        '2',
        '3.placeholder.png',
      ),
      mime: 'image/png',
    });
  });

  it.for([
    { name: 'a non-active style', url: '/tiles/topo/1/2/3.png' },
    { name: 'an unknown style', url: '/tiles/evil/1/2/3.png' },
  ])('claims but refuses $name in /tiles/', ({ url }) => {
    expect(resolveAsset(url, routes())).toEqual({ kind: 'missing' });
  });

  it('routes compiled renderer modules as JavaScript', () => {
    const r = routes();
    expect(resolveAsset('/renderer/scene.js', r)).toEqual({
      kind: 'file',
      filePath: path.join(r.rendererDir, 'scene.js'),
      mime: 'text/javascript; charset=utf-8',
    });
  });

  it.for([
    { name: 'a path traversal', url: '/renderer/../secret.js' },
    { name: 'a non-JavaScript file', url: '/renderer/scene.ts' },
    { name: 'an uppercase name', url: '/renderer/Scene.js' },
    { name: 'a nested path', url: '/renderer/sub/scene.js' },
  ])('claims but refuses $name in /renderer/', ({ url }) => {
    expect(resolveAsset(url, routes())).toEqual({ kind: 'missing' });
  });

  it.for(['/', '/other', '/index.html'])(
    'leaves %s to the caller',
    (url) => {
      expect(resolveAsset(url, routes())).toEqual({ kind: 'unrouted' });
    },
  );
});
