import { describe, expect, it } from 'vitest';

import { buildPageHtml, buildSceneData } from '../src/page.js';
import type { PageOpts } from '../src/page.js';

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
