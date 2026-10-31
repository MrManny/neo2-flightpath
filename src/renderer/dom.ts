// Renderer markup and styling, shared verbatim by the generated page and the
// app's map island so both look and measure identically. Element ids are the
// renderer's DOM contract.

import type { HudSpec } from '../config.js';
import type { TileSource } from './tilesources.js';
import type { Theme } from './theme.js';

export function sceneCss(
  src: TileSource,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
): string {
  return `
  html, body { margin: 0; padding: 0; overflow: hidden; background: ${src.bg}; }
  * { animation: none !important; transition: none !important; }
  #map-frame {
    position: absolute; inset: 0; overflow: hidden; background: ${src.bg};
  }
  #map { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; }
  .leaflet-tile-pane { filter: ${src.tileFilter || 'none'}; }
  #vignette {
    position: absolute; inset: 0; z-index: 500; pointer-events: none;
    background: radial-gradient(ellipse 78% 78% at 50% 44%,
      rgba(0,0,0,0) 52%, rgba(0,0,0,${theme.vignette}) 100%);
  }
  .drone-wrap {
    width: ${Math.round(46 * scale)}px; height: ${Math.round(46 * scale)}px;
    border-radius: 50%;
    background: ${theme.discBg};
    border: ${Math.max(2, Math.round(2.2 * scale))}px solid rgba(255,255,255,0.92);
    box-shadow:
      0 0 0 ${Math.round(7 * scale)}px ${theme.glow},
      0 ${Math.round(3 * scale)}px ${Math.round(12 * scale)}px rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    box-sizing: border-box;
  }
  .drone-arrow { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  .drone-arrow svg { width: 72%; height: 72%; display: block; }
  #hud {
    position: absolute; top: ${Math.round(16 * scale)}px; left: ${Math.round(16 * scale)}px;
    display: flex; flex-direction: column; gap: ${Math.round(8 * scale)}px;
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    z-index: 1200; pointer-events: none;
  }
  .chip {
    background: rgba(14,19,28,0.58);
    backdrop-filter: blur(${Math.round(14 * scale)}px) saturate(1.25);
    -webkit-backdrop-filter: blur(${Math.round(14 * scale)}px) saturate(1.25);
    color: #ffffff;
    padding: ${Math.round(6 * scale)}px ${Math.round(14 * scale)}px ${Math.round(6 * scale)}px ${Math.round(13 * scale)}px;
    border-radius: ${Math.round(13 * scale)}px;
    font-size: ${Math.round(21 * scale)}px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.3px;
    display: inline-flex; align-items: baseline; gap: ${Math.round(7 * scale)}px;
    width: fit-content;
    border: 1px solid rgba(255,255,255,0.20);
    box-shadow:
      inset ${Math.max(3, Math.round(3 * scale))}px 0 0 ${theme.core},
      0 ${Math.round(6 * scale)}px ${Math.round(18 * scale)}px rgba(0,0,0,0.30);
  }
  .chip .label {
    font-size: 0.55em; font-weight: 700; letter-spacing: 1.2px;
    color: ${theme.core}; opacity: 0.95;
  }
  .chip .unit { font-weight: 500; opacity: 0.72; font-size: 0.68em; }
  #attr {
    position: absolute; right: 0; bottom: 0; z-index: 1000; max-width: 72%;
    background: rgba(12, 14, 22, 0.62); color: rgba(255,255,255,0.78);
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: ${Math.round(11 * scale)}px; line-height: 1.35;
    padding: ${Math.round(2 * scale)}px ${Math.round(8 * scale)}px;
    border-radius: ${Math.round(4 * scale)}px 0 0 0;
    pointer-events: none;
  }
  #attr a { color: rgba(255,255,255,0.92); text-decoration: none; }
  #scalebar {
    position: absolute; left: ${Math.round(10 * scale)}px; bottom: ${Math.round(8 * scale)}px;
    z-index: 1000; pointer-events: none;
    font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  #scaletext {
    display: block; color: #ffffff; font-size: ${Math.round(11 * scale)}px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.8); margin-bottom: 2px;
  }
  #scaleline {
    height: ${Math.max(4, Math.round(5 * scale))}px;
    border: 1px solid rgba(255,255,255,0.85); border-top: none;
    box-shadow: 0 1px 2px rgba(0,0,0,0.6);
  }`;
}

export function hudMarkup(hud: HudSpec): string {
  const chips: string[] = [];
  if (hud.alt) {
    chips.push(
      '<div class="chip" id="chip-alt"><span class="label">ALT</span><span class="num">--</span><span class="unit">m</span></div>',
    );
  }
  if (hud.speed) {
    chips.push(
      '<div class="chip" id="chip-speed"><span class="label">SPD</span><span class="num">--</span><span class="unit">m/s</span></div>',
    );
  }
  return chips.map((chip) => `  ${chip}`).join('\n');
}

export function mapMarkup(hud: HudSpec, attribution: string): string {
  return `<div id="map-frame">
<div id="map"></div>
<div id="vignette"></div>
<div id="hud">
${hudMarkup(hud)}
</div>
<div id="attr">${attribution}</div>
<div id="scalebar"><span id="scaletext"></span><div id="scaleline"></div></div>
</div>`;
}

/** The drone marker's inner markup: the arrow glyph in the track color. */
export function droneMarkerMarkup(coreColor: string): string {
  return (
    '<div class="drone-wrap"><div class="drone-arrow" id="drone-arrow">' +
    '<svg viewBox="0 0 24 24"><path d="M12 1.8 L21 22 L12 16.9 L3 22 Z" fill="' +
    coreColor +
    '" stroke="rgba(255,255,255,0.9)" stroke-width="0.9" stroke-linejoin="round"/></svg>' +
    '</div></div>'
  );
}

/** Returns the element the renderer's DOM contract guarantees. */
export function el<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`renderer element missing: ${selector}`);
  return found;
}
