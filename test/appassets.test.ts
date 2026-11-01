import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveAppAsset } from '../src/appassets.js';
import type { AppRoutes } from '../src/appassets.js';
import { cleanupTmpDirs, tmpDir } from './fixtures.js';
import { afterEach } from 'vitest';

function routes(overrides: Partial<AppRoutes> = {}): AppRoutes {
  const root = tmpDir();
  return {
    exportRoot: path.join(root, 'out'),
    tileCache: path.join(root, 'tiles'),
    videoPath: null,
    ...overrides,
  };
}

afterEach(cleanupTmpDirs);

describe('resolveAppAsset (export files)', () => {
  it.for([
    { name: 'root', pathname: '/', rel: 'index.html' },
    { name: 'explicit index', pathname: '/index.html', rel: 'index.html' },
    { name: 'client route', pathname: '/watch/', rel: path.join('watch', 'index.html') },
    { name: 'static chunk', pathname: '/_next/static/x.js', rel: path.join('_next', 'static', 'x.js') },
  ])('maps $name to its export file', ({ pathname, rel }) => {
    const r = routes();
    const asset = resolveAppAsset(pathname, r);
    expect(asset.kind).toBe('export');
    if (asset.kind === 'export') {
      expect(asset.filePath).toBe(path.join(r.exportRoot, rel));
    }
  });

  it('serves an HTML mime for pages and JS for chunks', () => {
    const html = resolveAppAsset('/index.html', routes());
    const js = resolveAppAsset('/_next/static/x.js', routes());
    expect(html.kind === 'export' && html.mime).toContain('text/html');
    expect(js.kind === 'export' && js.mime).toContain('text/javascript');
  });

  it.for([
    { name: 'parent traversal', pathname: '/../secret.txt' },
    { name: 'nested traversal', pathname: '/a/../../secret.txt' },
    { name: 'absolute path escape', pathname: '/C:/secret.txt' },
    { name: 'backslash traversal', pathname: '/..\\secret.txt' },
    { name: 'drive prefix mid-path', pathname: '/a/C:/secret.txt' },
    { name: 'backslash separators', pathname: '/a\\b.js' },
  ])('refuses $name', ({ pathname }) => {
    expect(resolveAppAsset(pathname, routes()).kind).toBe('not-found');
  });
});

describe('resolveAppAsset (tiles)', () => {
  it.for([
    { style: 'satellite', cacheKey: 'esri-imagery' },
    { style: 'topo', cacheKey: 'opentopomap' },
  ])('maps a $style tile to the cache with its placeholder', ({ style, cacheKey }) => {
    const r = routes();
    const asset = resolveAppAsset(`/tiles/${style}/1/2/3.png`, r);
    expect(asset.kind).toBe('tile');
    if (asset.kind === 'tile') {
      expect(asset.filePath).toBe(path.join(r.tileCache, cacheKey, '1', '2', '3.png'));
      expect(asset.placeholderPath).toBe(
        path.join(r.tileCache, cacheKey, '1', '2', '3.placeholder.png'),
      );
      expect(asset.style).toBe(style);
      expect(asset.tile).toEqual({ z: 1, x: 2, y: 3 });
    }
  });

  it('treats unknown tile styles and non-png tile paths as plain export paths', () => {
    // The parser accepts vocabulary styles only; anything tile-shaped but not
    // a tile resolves like any other static path (404 at serve time when the
    // export root has no such file).
    const r = routes();
    expect(resolveAppAsset('/tiles/evil/1/2/3.png', r)).toEqual({
      kind: 'export',
      filePath: path.join(r.exportRoot, 'tiles', 'evil', '1', '2', '3.png'),
      mime: 'image/png',
    });
    expect(resolveAppAsset('/tiles/satellite/1/2/3.jpg', r).kind).toBe('export');
  });
});

describe('resolveAppAsset (video)', () => {
  it('maps /media/video to the loaded recording', () => {
    const asset = resolveAppAsset('/media/video', routes({ videoPath: '/x/y.mp4' }));
    expect(asset).toEqual({ kind: 'video', filePath: '/x/y.mp4' });
  });

  it('refuses video without a loaded recording', () => {
    expect(resolveAppAsset('/media/video', routes()).kind).toBe('not-found');
  });
});
