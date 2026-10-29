import { describe, expect, it } from 'vitest';

import { buildPageHtml } from '../src/page.js';
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

describe('buildPageHtml (headless)', () => {
  it('mounts the shared scene with no app chrome', () => {
    const html = buildPageHtml(baseOpts());
    expect(html).toContain('<div id="scene-host"></div>');
    expect(html).toContain('/leaflet/leaflet.js');
    expect(html).toContain('<title>flight map</title>');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('id="controls"');
    expect(html).not.toContain('/api/pick');
  });

  it('imports the shared renderer and bridges the capture globals', () => {
    const html = buildPageHtml(baseOpts());
    expect(html).toContain("import { createScene } from '/renderer/scene.js'");
    expect(html).toContain("createScene(document.getElementById('scene-host'), D, { L: window.L })");
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
    expect(data['video']).toBeNull();
  });

  it('defaults intro and outro to zero and passes overrides through', () => {
    expect(dataOf(buildPageHtml(baseOpts()))['introN']).toBe(0);
    expect(dataOf(buildPageHtml(baseOpts()))['outroN']).toBe(0);
    const data = dataOf(buildPageHtml(baseOpts({ introN: 25, outroN: 12 })));
    expect(data['introN']).toBe(25);
    expect(data['outroN']).toBe(12);
  });

  it('escapes "</" in the inlined JSON', () => {
    const html = buildPageHtml(baseOpts({ attribution: 'x</script>y' }));
    expect(html).toContain('x\\u003c/script>y');
  });

  it('keeps the interactive driver out of headless pages', () => {
    expect(buildPageHtml(baseOpts())).not.toContain('requestVideoFrameCallback');
    expect(buildPageHtml(baseOpts())).not.toContain('id="scrub"');
  });
});

describe('buildPageHtml (interactive)', () => {
  it('adds video, scrubber and the swappable picture-in-picture layout', () => {
    const html = buildPageHtml(
      baseOpts({ video: { src: '/video', fps: 29.97, frames: 3, width: 1920, height: 1080 } }),
    );
    expect(html).toContain('<title>neo2-flightpath</title>');
    expect(html).toContain('<video id="video" src="/video"');
    expect(html).toContain('id="scene-host"');
    expect(html).toContain('id="slot-main"');
    expect(html).toContain('id="slot-pip"');
    expect(html).toContain('id="scrub"');
    expect(html).toContain('id="btn-play"');
    expect(html).toContain('id="btn-open"');
    expect(html).toContain('id="btn-swap"');
    expect(html).toContain('body class="ui"');
    expect(html).toContain("document.getElementById('btn-open')");
  });

  it('derives the frame index from the presented frame and seeks to i / fps', () => {
    const html = buildPageHtml(
      baseOpts({ video: { src: '/video', fps: 30, frames: 3, width: 1920, height: 1080 } }),
    );
    expect(html).toContain('requestVideoFrameCallback');
    expect(html).toContain('Math.floor(meta.mediaTime * V.fps + 1e-6)');
    expect(html).toContain('Math.floor(videoEl.currentTime * V.fps + 1e-6)');
    expect(html).not.toContain('Math.round(videoEl.currentTime');
    expect(html).toContain('videoEl.currentTime = seekTo / V.fps');
    expect(html).toContain('requestAnimationFrame(loop)');
  });

  it('carries the video parameters in the page data', () => {
    const html = buildPageHtml(
      baseOpts({ video: { src: '/video', fps: 29.97, frames: 3, width: 1920, height: 1080 } }),
    );
    const data = dataOf(html);
    expect(data['video']).toEqual({
      src: '/video',
      fps: 29.97,
      frames: 3,
      width: 1920,
      height: 1080,
    });
  });

  it('sizes the picture-in-picture box by the video aspect, height-bound for portrait', () => {
    const html = buildPageHtml(
      baseOpts({ video: { src: '/video', fps: 30, frames: 3, width: 1512, height: 2688 } }),
    );
    expect(html).toContain("slotPip.style.aspectRatio = V.width + ' / ' + V.height");
    expect(html).toContain('var portrait = V.height > V.width');
    expect(html).toContain("slotPip.style.width = portrait ? 'auto' : '30%'");
    expect(html).toContain("slotPip.style.height = portrait ? '45%' : 'auto'");
  });
});
