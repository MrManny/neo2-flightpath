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
    style: 'satellite',
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
  ])('refuses $name', ({ pathname }) => {
    expect(resolveAppAsset(pathname, routes()).kind).toBe('not-found');
  });
});

describe('resolveAppAsset (tiles)', () => {
  it('maps an active-style tile to the cache with its placeholder', () => {
    const r = routes();
    const asset = resolveAppAsset('/tiles/satellite/1/2/3.png', r);
    expect(asset.kind).toBe('tile');
    if (asset.kind === 'tile') {
      expect(asset.filePath).toBe(path.join(r.tileCache, 'esri-imagery', '1', '2', '3.png'));
      expect(asset.placeholderPath).toBe(
        path.join(r.tileCache, 'esri-imagery', '1', '2', '3.placeholder.png'),
      );
    }
  });

  it('refuses tiles of a style that is not active', () => {
    expect(resolveAppAsset('/tiles/topo/1/2/3.png', routes()).kind).toBe('not-found');
    expect(resolveAppAsset('/tiles/evil/1/2/3.png', routes()).kind).toBe('not-found');
    expect(resolveAppAsset('/tiles/satellite/1/2/3.jpg', routes()).kind).not.toBe('tile');
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
