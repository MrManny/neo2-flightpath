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

import { hasAltitude, resolveHudSpec } from './config.js';
import type { HudSpec, RenderConfig, Style, View } from './config.js';
import { decimateTrack } from './decimate.js';
import type { DecimatedTrack } from './decimate.js';
import { unproject } from './geo.js';
import type { Bbox, LatLon } from './geo.js';
import { planIntroOutroFrames, planView } from './plan.js';
import type { SceneData } from './renderer/scene.js';
import { TILE_SOURCES } from './renderer/tilesources.js';

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

// The one settings + telemetry -> page mapping. The pipeline's recording
// mapping and the app's live restyle both plan through here, so a preview and
// an export from the same settings agree frame for frame. The bbox must be
// the telemetry's fix bbox (what the tile prefetch warms), never the smaller
// frame-sample bbox.
export function planPageOpts(opts: {
  bbox: Bbox;
  width: number;
  height: number;
  config: Pick<
    RenderConfig,
    'style' | 'view' | 'zoom' | 'zoomOut' | 'introSec' | 'outroSec' | 'hud'
  >;
  source: { fps: number; frames: number };
  frames: Pick<PageOpts, 'lat' | 'lon' | 'alt' | 'speed' | 'headingDeg'>;
  /** Reuse the previous decimated track when the planned zoom matches it. */
  previous?: { zoom: number; decimated: DecimatedTrack };
}): PageOpts {
  const { bbox, width, height, config, source, frames, previous } = opts;
  const overview = planView(bbox, width, height, config);
  const introOutro = planIntroOutroFrames(config, source, () => {});
  // Decimation depends only on the track and the working zoom, so an
  // unchanged zoom keeps the identical arrays and consumers can tell that no
  // trail work is needed.
  const decimated =
    previous && previous.zoom === overview.zoom
      ? previous.decimated
      : decimateTrack(frames.lat, frames.lon, overview.zoom);
  return {
    width,
    height,
    style: config.style,
    view: config.view,
    center: unproject(overview.centerPx.x, overview.centerPx.y, overview.zoom),
    zoom: overview.zoom,
    attribution: TILE_SOURCES[config.style].attribution,
    introN: introOutro.introN,
    outroN: introOutro.outroN,
    lat: frames.lat,
    lon: frames.lon,
    alt: frames.alt,
    speed: frames.speed,
    headingDeg: frames.headingDeg,
    hud: resolveHudSpec(config.hud, hasAltitude(frames.alt)),
    decimated,
  };
}

// The scene data both consumers drive: the generated page inlines it as
// window.__DATA, the app delivers it as the session payload. Tile URLs are
// rooted at the consumer's serving base ("/tiles" or "app://bundle/tiles").
export function buildSceneData(opts: PageOpts, tileBase: string): SceneData {  const {
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

// The module boot: boots the shared scene and bridges the globals the
// headless capture uses. Runs after the DOM is parsed (module semantics), so
// the scene always finds its host element.
function bootScript(dataJson: string): string {
  return `import { bootScene } from '/renderer/boot.js';
var D = window.__DATA = ${dataJson};
var scene = bootScene(document.getElementById('scene-host'), D, window.L);
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
