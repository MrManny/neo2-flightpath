// The generated headless page receives all telemetry inline (no fetch) and
// exposes window.__setFrame(i) for per-frame marker/trail updates; it resolves
// after the canvas has painted so screenshots are frame-exact. The map scene
// itself lives in src/renderer/ - one shared implementation with the app's
// React map island.
//
// Views:
//   overview - static map fitted to the whole track (trail grows with time)
//   follow   - drone marker stays in the frame center and the map slides under
//              it (all tiles are loaded once up-front; the per-frame move is a
//              pure CSS transform, so no tile loads happen mid-render)

import type { HudSpec, Style, View } from './config.js';
import type { DecimatedTrack } from './decimate.js';
import type { LatLon } from './geo.js';
import type { SceneData } from './renderer/scene.js';
import { TILE_SOURCES } from './tilesources.js';

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
  decimated: DecimatedTrack;
  introN?: number;
  outroN?: number;
}

// The scene data both consumers drive: the generated page inlines it as
// window.__DATA, the app delivers it as the session payload. Tile URLs are
// rooted at the consumer's serving base ("/tiles" or "app://bundle/tiles").
export function buildSceneData(opts: PageOpts, tileBase: string): SceneData {
  const {
    width, height, style, view, center, zoom, attribution,
    lat, lon, alt, speed, headingDeg, hud, decimated,
    introN = 0, outroN = 0,
  } = opts;
  return {
    style,
    tileUrl: tileBase + '/' + style + '/{z}/{x}/{y}.png',
    view,
    width,
    height,
    zoom,
    center: { lat: center.lat, lon: center.lon },
    attribution,
    introN,
    outroN,
    lat, lon, alt, speed, headingDeg,
    hud,
    trailLat: decimated.lat,
    trailLon: decimated.lon,
    trailFrame: decimated.frame,
  };
}

// The module boot: instantiates the shared scene and bridges the globals the
// headless capture uses. Runs after the DOM is parsed (module semantics), so
// the scene always finds its host element.
function bootScript(dataJson: string): string {
  return `import { createScene } from '/renderer/scene.js';
var D = window.__DATA = ${dataJson};
var scene = createScene(document.getElementById('scene-host'), D, { L: window.L });
window.__setFrame = function (i) { return scene.setFrame(i); };
window.__relayout = function () { scene.relayout(); };
scene.ready.then(function () { window.__READY = true; });`;
}

export function buildPageHtml(opts: PageOpts): string {
  const data = buildSceneData(opts, '/tiles');
  // "</" must not appear verbatim: the JSON is inlined into a <script> tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>flight map</title>
<link rel="stylesheet" href="/leaflet/leaflet.css">
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: ${TILE_SOURCES[opts.style].bg}; }
</style>
</head>
<body>
<div id="scene-host"></div>
<script src="/leaflet/leaflet.js"></script>
<script type="module">
${bootScript(json)}
</script>
</body>
</html>`;
}
