import { describe, expect, it } from 'vitest';

import { buildPageHtml, buildSceneData, planPageOpts } from '../src/page.js';
import type { PageOpts } from '../src/page.js';
import type { Bbox } from '../src/geo.js';

function baseOpts(overrides: Partial<PageOpts> = {}): PageOpts {
  return {
    width: 768,
    height: 768,
    style: 'satellite',
    view: 'follow',
    center: { lat: 46.61, lon: 14.26 },
    zoom: 15,
    attribution: 'Test Attribution',
    lat: [46.61, 46.611, 46.612],
    lon: [14.26, 14.261, 14.262],
    alt: [10, 11, null],
    speed: [null, 2.5, 3.1],
    headingDeg: [0, 90, 180],
    hud: { heading: true, alt: false, speed: false },
    decimated: { lat: [46.61, 46.612], lon: [14.26, 14.262], frame: [0, 2] },
    ...overrides,
  };
}

function dataOf(html: string): Record<string, unknown> {
  const m = /window\.__DATA = (\{.*\});/.exec(html);
  expect(m, 'page embeds __DATA').toBeTruthy();
  return JSON.parse((m as RegExpExecArray)[1]) as Record<string, unknown>;
}

describe('buildSceneData', () => {
  it('roots tile URLs at the consumer serving base', () => {
    expect(buildSceneData(baseOpts(), '/tiles')['tileUrl']).toBe(
      '/tiles/satellite/{z}/{x}/{y}.png',
    );
    expect(buildSceneData(baseOpts(), 'app://bundle/tiles')['tileUrl']).toBe(
      'app://bundle/tiles/satellite/{z}/{x}/{y}.png',
    );
  });

  it('defaults intro and outro to zero and passes overrides through', () => {
    expect(buildSceneData(baseOpts(), '/tiles')['introN']).toBe(0);
    expect(buildSceneData(baseOpts(), '/tiles')['outroN']).toBe(0);
    const data = buildSceneData(baseOpts({ introN: 25, outroN: 12 }), '/tiles');
    expect(data['introN']).toBe(25);
    expect(data['outroN']).toBe(12);
  });
});

describe('planPageOpts', () => {
  const BBOX: Bbox = {
    minLat: 46.6129,
    maxLat: 46.6132,
    minLon: 14.2622,
    maxLon: 14.2626,
  };

  const FRAMES = {
    lat: [46.613, 46.6131],
    lon: [14.2623, 14.2624],
    alt: [3.3, 3.4],
    speed: [1.2, 1.3],
    headingDeg: [90, 91],
  };

  const CONFIG = {
    style: 'satellite' as const,
    view: 'overview' as const,
    zoom: 0,
    zoomOut: 0,
    introSec: 2,
    outroSec: 3,
    hud: { heading: true, alt: true, speed: true },
  };

  it('computes the planning triple when none is passed', () => {
    const opts = planPageOpts({
      bbox: BBOX,
      width: 768,
      height: 768,
      config: CONFIG,
      source: { fps: 30, frames: 3000 },
      frames: FRAMES,
    });
    expect(opts.introN).toBe(60);
    expect(opts.outroN).toBe(90);
    expect(opts.zoom).toBeGreaterThanOrEqual(2);
    expect(opts.hud).toEqual({ heading: true, alt: true, speed: true });
  });

  it('uses precomputed planning values instead of recomputing', () => {
    const planned = {
      overview: { centerPx: { x: 1024, y: 2048 }, zoom: 12, tiles: [] },
      introOutro: { introN: 5, outroN: 7, clamped: true },
      hud: { heading: true, alt: false, speed: false },
    };
    const opts = planPageOpts({
      bbox: BBOX,
      width: 768,
      height: 768,
      config: CONFIG,
      source: { fps: 30, frames: 3000 },
      frames: FRAMES,
      planned,
    });
    expect(opts.zoom).toBe(12);
    expect(opts.introN).toBe(5);
    expect(opts.outroN).toBe(7);
    expect(opts.hud).toEqual({ heading: true, alt: false, speed: false });
  });

  it('drops the altitude chip without altitude data', () => {
    const opts = planPageOpts({
      bbox: BBOX,
      width: 768,
      height: 768,
      config: CONFIG,
      source: { fps: 30, frames: 3000 },
      frames: { ...FRAMES, alt: [null, null] },
    });
    expect(opts.hud).toEqual({ heading: true, alt: false, speed: true });
  });
});

describe('buildPageHtml (headless)', () => {
  it('mounts the shared scene with no app chrome', () => {
    const html = buildPageHtml(baseOpts());
    expect(html).toContain('<div id="scene-host"></div>');
    expect(html).toContain('/leaflet/leaflet.js');
    expect(html).toContain('<title>flight map</title>');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('id="controls"');
    expect(html).not.toContain('/api/pick');
    expect(html).not.toContain('requestVideoFrameCallback');
  });

  it('imports the shared renderer and bridges the capture globals', () => {
    const html = buildPageHtml(baseOpts());
    expect(html).toContain("import { bootScene } from '/renderer/boot.js'");
    expect(html).toContain("bootScene(document.getElementById('scene-host'), D, window.L)");
    expect(html).toContain('window.__setFrame = function (i)');
    expect(html).toContain('window.__relayout = function');
    expect(html).toContain('scene.ready.then(function () { window.__READY = true; })');
  });

  it('passes the scene data and the decimated trail arrays through to the page', () => {
    const data = dataOf(buildPageHtml(baseOpts()));
    expect(data['tileUrl']).toBe('/tiles/satellite/{z}/{x}/{y}.png');
    expect(data['style']).toBe('satellite');
    expect(data['trailLat']).toEqual([46.61, 46.612]);
    expect(data['trailLon']).toEqual([14.26, 14.262]);
    expect(data['trailFrame']).toEqual([0, 2]);
  });

  it('escapes "</" in the inlined JSON', () => {
    const html = buildPageHtml(baseOpts({ attribution: 'x</script>y' }));
    expect(html).toContain('x\\u003c/script>y');
  });
});
