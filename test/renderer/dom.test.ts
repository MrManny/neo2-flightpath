// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { el, mapMarkup, sceneCss } from '../../src/renderer/dom.js';
import { themeFor } from '../../src/renderer/theme.js';
import type { Style } from '../../src/config.js';
import { TILE_SOURCES } from '../../src/tilesources.js';

describe('sceneCss', () => {
  it.for([
    { style: 'satellite' as Style, want: ['saturate(1.06) contrast(1.03)', '#0b0e14', '#41f0ff'] },
    { style: 'topo' as Style, want: ['none', '#eae5da', '#e63946'] },
  ])('renders the $style look', ({ style, want }) => {
    const css = sceneCss(TILE_SOURCES[style], themeFor(style), 768, 768, 1);
    for (const fragment of want) expect(css).toContain(fragment);
  });

  it('sizes the drone disc and HUD from the frame scale', () => {
    const css = sceneCss(TILE_SOURCES.satellite, themeFor('satellite'), 768, 768, 2);
    expect(css).toContain('width: 92px');
    expect(css).toContain('font-size: 42px');
  });

  it('keeps the map frame canvas-sized for the export', () => {
    const css = sceneCss(TILE_SOURCES.satellite, themeFor('satellite'), 1920, 1080, 1);
    expect(css).toContain('#map { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }');
    expect(css).toContain('animation: none !important');
  });
});

describe('mapMarkup', () => {
  it('carries the renderer DOM contract', () => {
    const markup = mapMarkup({ heading: true, alt: true, speed: true }, 'Test Attribution');
    for (const id of [
      'map-frame', 'map', 'vignette', 'hud', 'chip-alt', 'chip-speed',
      'attr', 'scalebar', 'scaletext', 'scaleline',
    ]) {
      expect(markup).toContain(`id="${id}"`);
    }
    expect(markup).toContain('Test Attribution');
  });

  it.for([
    { name: 'heading only', hud: { heading: true, alt: false, speed: false }, want: [] },
    { name: 'all chips', hud: { heading: true, alt: true, speed: true }, want: ['chip-alt', 'chip-speed'] },
    { name: 'no chips', hud: { heading: false, alt: false, speed: false }, want: [] },
  ])('renders $name', ({ hud, want }) => {
    const markup = mapMarkup(hud, 'attr');
    for (const id of want) expect(markup).toContain(`id="${id}"`);
    if (!hud.alt) expect(markup).not.toContain('id="chip-alt"');
    if (!hud.speed) expect(markup).not.toContain('id="chip-speed"');
  });
});

describe('el', () => {
  it('returns the element the renderer DOM contract guarantees', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span id="x">hi</span>';
    expect(el<HTMLElement>(root, '#x').textContent).toBe('hi');
  });

  it('throws a plain error when the element is missing', () => {
    const root = document.createElement('div');
    expect(() => el(root, '#gone')).toThrow('renderer element missing: #gone');
  });
});
