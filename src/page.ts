// page.ts - builds the self-contained Leaflet page rendered by Playwright.
// The page receives all telemetry inline (no fetch), paints the map once, and
// exposes window.__setFrame(i) for per-frame marker/trail updates.
//
// Views:
//   overview - static map fitted to the whole track (trail grows with time)
//   follow   - drone marker stays in the frame center and the map slides under
//              it (all tiles are loaded once up-front; the per-frame move is a
//              pure CSS transform, so no tile loads happen mid-render)
//
// Visual treatment is theme-driven (THEMES): each map style gets its own trail
// palette (glow + casing + core), ghost-route casing, drone marker colors and
// vignette strength; optional HUD chips share a glass look with the accent.

import { TILE_SOURCES } from './tiles.js';
import type { TileSource } from './tiles.js';
import type { HudSpec, Style, Trail, View } from './config.js';
import type { LatLon } from './geo.js';

export interface PageOpts {
  width: number;
  height: number;
  style: Style;
  view: View;
  center: LatLon;
  zoom: number;
  attribution: string;
  lat: number[];
  lon: number[];
  alt: (number | null)[];
  speed: (number | null)[];
  headingDeg: number[];
  hud: HudSpec;
  introN?: number;
  outroN?: number;
  trail?: Trail;
}

interface Theme {
  core: string;
  glow: string;
  casing: string;
  ghost: string;
  ghostOpacity: number;
  ghostCasing: string | null;
  discBg: string;
  vignette: number;
}

const THEMES: Record<Style, Theme> = {
  satellite: {
    core: '#41f0ff',
    glow: 'rgba(65,240,255,0.32)',
    casing: 'rgba(10,14,20,0.9)',
    ghost: '#ffffff',
    ghostOpacity: 0.85,
    ghostCasing: 'rgba(8,12,18,0.55)',
    discBg: 'rgba(10,14,20,0.82)',
    vignette: 0.16,
  },
  topo: {
    core: '#e63946',
    glow: 'rgba(230,57,70,0.26)',
    casing: '#ffffff',
    ghost: '#6b6252',
    ghostOpacity: 0.7,
    ghostCasing: 'rgba(255,255,255,0.8)',
    discBg: 'rgba(26,22,18,0.85)',
    vignette: 0.06,
  },
};

function pageCss(
  src: TileSource,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
): string {
  return `
  html, body { margin: 0; padding: 0; overflow: hidden; background: ${src.bg}; }
  * { animation: none !important; transition: none !important; }
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

function hudMarkup(hud: HudSpec): string {
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

function pageScript(dataJson: string, scale: number): string {
  return `(function () {
  var D = window.__DATA = ${dataJson};
  var T = D.theme;
  var S = ${Math.round(scale * 1000) / 1000};
  var mapEl = document.getElementById('map');
  var map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    fadeAnimation: false,
    zoomAnimation: false,
    markerZoomAnimation: false,
    zoomSnap: 1
  });
  var tiles = L.tileLayer('/tiles/' + D.style + '/{z}/{x}/{y}.png', {
    maxZoom: D.maxZoom,
    maxNativeZoom: D.maxNativeZoom || undefined
  });
  tiles.addTo(map);

  var latlngs = D.lat.map(function (la, i) { return [la, D.lon[i]]; });
  var bb = L.latLngBounds(latlngs);

  // Map element size and initial view. The element is larger than the frame:
  // in follow mode it slides under the centered drone marker, and the intro/
  // outro zoom-out shows up to 2x the frame area (scale 0.5 = one level out).
  var bigW;
  var bigH;
  if (D.view === 'follow') {
    var pb1 = map.project(bb.getNorthWest(), D.zoom);
    var pb2 = map.project(bb.getSouthEast(), D.zoom);
    bigW = Math.max(2 * D.width, Math.ceil(Math.abs(pb2.x - pb1.x) + 2 * D.width));
    bigH = Math.max(2 * D.height, Math.ceil(Math.abs(pb2.y - pb1.y) + 2 * D.height));
  } else {
    bigW = 2 * D.width;
    bigH = 2 * D.height;
  }
  mapEl.style.width = bigW + 'px';
  mapEl.style.height = bigH + 'px';
  map.invalidateSize();
  map.setView(D.view === 'follow' ? bb.getCenter() : [D.center.lat, D.center.lon], D.zoom);
  var c0 = map.project(map.getCenter(), D.zoom);

  // Static scale bar (the map never zooms during a render).
  var latC = (D.view === 'follow' ? bb.getCenter().lat : D.center.lat);
  var mPerPx = 156543.033928 * Math.cos(latC * Math.PI / 180) / Math.pow(2, D.zoom);
  var steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
  var bestM = steps[0];
  for (var s = 0; s < steps.length; s++) {
    if (steps[s] / mPerPx <= 110 * S) bestM = steps[s];
  }
  var scalelineEl = document.getElementById('scaleline');
  scalelineEl.style.width = Math.round(bestM / mPerPx) + 'px';
  document.getElementById('scaletext').textContent =
    bestM >= 1000 ? (bestM / 1000) + ' km' : bestM + ' m';

  // Layered trail: ghost (whole route, optional casing) -> glow -> casing -> core.
  var ghostDash = Math.round(7 * S) + ' ' + Math.round(9 * S);
  if (T.ghostCasing) {
    L.polyline(latlngs, {
      color: T.ghostCasing,
      weight: Math.max(3, 4.6 * S),
      opacity: 1,
      dashArray: ghostDash,
      lineCap: 'round'
    }).addTo(map);
  }
  L.polyline(latlngs, {
    color: T.ghost,
    weight: Math.max(2, 2.8 * S),
    opacity: T.ghostOpacity,
    dashArray: ghostDash,
    lineCap: 'round'
  }).addTo(map);
  var wCore = Math.max(3, 5.5 * S);
  var trailGlow = L.polyline([latlngs[0]], {
    color: T.glow,
    weight: wCore * 2.6,
    opacity: 1,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);
  var trailCasing = L.polyline([latlngs[0]], {
    color: T.casing,
    weight: wCore * 1.6,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);
  var trail = L.polyline([latlngs[0]], {
    color: T.core,
    weight: wCore,
    opacity: 1,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);
  L.circleMarker(latlngs[0], {
    radius: Math.round(7 * S),
    color: '#ffffff',
    weight: Math.max(2, 2 * S),
    fillColor: T.core,
    fillOpacity: 1
  }).addTo(map);

  var arrowHtml =
    '<div class="drone-wrap"><div class="drone-arrow" id="drone-arrow">' +
    '<svg viewBox="0 0 24 24"><path d="M12 1.8 L21 22 L12 16.9 L3 22 Z" fill="' + T.core +
    '" stroke="rgba(255,255,255,0.9)" stroke-width="0.9" stroke-linejoin="round"/></svg>' +
    '</div></div>';
  var drone = L.marker(latlngs[0], {
    icon: L.divIcon({
      className: 'drone-icon',
      html: arrowHtml,
      iconSize: [Math.round(46 * S), Math.round(46 * S)],
      iconAnchor: [Math.round(23 * S), Math.round(23 * S)]
    }),
    interactive: false,
    keyboard: false
  }).addTo(map);
  var arrowEl = document.getElementById('drone-arrow');
  var wrapEl = document.querySelector('.drone-wrap');
  var altEl = document.querySelector('#chip-alt .num');
  var speedEl = document.querySelector('#chip-speed .num');
  if (!D.hud.heading && arrowEl) arrowEl.style.display = 'none';

  // Intro/outro zoom: scale 0.5 = one zoom level further out, smoothstepped.
  var N = D.lat.length;
  function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

  var trailIdx = 0;
  window.__setFrame = function (i) {
    if (D.trail === 'incr') {
      if (i > trailIdx) {
        for (var j = trailIdx + 1; j <= i; j++) {
          trail.addLatLng(latlngs[j]);
          trailGlow.addLatLng(latlngs[j]);
          trailCasing.addLatLng(latlngs[j]);
        }
        trailIdx = i;
      } else if (i < trailIdx) {
        var ptsBack = latlngs.slice(0, i + 1);
        trail.setLatLngs(ptsBack);
        trailGlow.setLatLngs(ptsBack);
        trailCasing.setLatLngs(ptsBack);
        trailIdx = i;
      }
    } else if (i > 0) {
      var pts = latlngs.slice(0, i + 1);
      trail.setLatLngs(pts);
      trailGlow.setLatLngs(pts);
      trailCasing.setLatLngs(pts);
    }
    drone.setLatLng(latlngs[i]);
    var kIn = 1;
    var kOut = 1;
    if (D.introN > 0 && i < D.introN) {
      kIn = Math.pow(2, -(1 - smooth(i / D.introN)));
    }
    if (D.outroN > 0 && i > N - 1 - D.outroN) {
      kOut = Math.pow(2, -(1 - smooth((N - 1 - i) / D.outroN)));
    }
    var k = Math.min(kIn, kOut);
    var dx = 0;
    var dy = 0;
    if (D.view === 'follow') {
      var p = map.project(latlngs[i], D.zoom);
      dx = p.x - c0.x;
      dy = p.y - c0.y;
    }
    mapEl.style.transform =
      'translate(' + (D.width / 2 - bigW / 2 - k * dx) + 'px,' +
      (D.height / 2 - bigH / 2 - k * dy) + 'px) scale(' + k + ')';
    if (wrapEl) {
      wrapEl.style.transform = k === 1 ? '' : 'scale(' + (1 / k) + ')';
    }
    scalelineEl.style.width = Math.round(bestM / mPerPx * k) + 'px';
    if (D.hud.heading && arrowEl) {
      arrowEl.style.transform = 'rotate(' + D.headingDeg[i] + 'deg)';
    }
    if (altEl) {
      altEl.textContent = (D.alt[i] === null || D.alt[i] === undefined) ? '--' : String(Math.round(D.alt[i]));
    }
    if (speedEl) {
      speedEl.textContent = (D.speed[i] === null || D.speed[i] === undefined) ? '--' : D.speed[i].toFixed(1);
    }
  };
  window.__setFrame(0);

  var done = false;
  function ready() { if (!done) { done = true; window.__READY = true; } }
  tiles.on('load', ready);
  tiles.on('tileerror', function () { /* placeholder tiles are fine */ });
  setTimeout(ready, 12000);
})();`;
}

export function buildPageHtml(opts: PageOpts): string {
  const {
    width, height, style, view, center, zoom, attribution,
    lat, lon, alt, speed, headingDeg, hud,
    introN = 0, outroN = 0, trail = 'full',
  } = opts;

  const src = TILE_SOURCES[style];
  const theme = THEMES[style];
  const scale = Math.max(0.7, Math.min(2.2, Math.min(width, height) / 1024));
  const data = {
    style,
    view,
    width,
    height,
    zoom,
    maxZoom: src.maxZoom || 19,
    maxNativeZoom: src.maxNativeZoom || 0,
    center: { lat: center.lat, lon: center.lon },
    attribution,
    theme,
    introN,
    outroN,
    trail,
    lat, lon, alt, speed, headingDeg,
    hud,
  };
  // "</" must not appear verbatim: the JSON is inlined into a <script> tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>flight map</title>
<link rel="stylesheet" href="/leaflet/leaflet.css">
<style>${pageCss(src, theme, width, height, scale)}
</style>
</head>
<body>
<div id="map"></div>
<div id="vignette"></div>
<div id="hud">
${hudMarkup(hud)}
</div>
<div id="attr">${attribution}</div>
<div id="scalebar"><span id="scaletext"></span><div id="scaleline"></div></div>
<script src="/leaflet/leaflet.js"></script>
<script>
${pageScript(json, scale)}
</script>
</body>
</html>`;
}
