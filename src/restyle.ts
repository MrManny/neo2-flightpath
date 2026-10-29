// Settings -> scene mapping for the app's live restyle: it re-plans the view,
// intro/outro timing, HUD and trail with the very functions the pipeline uses,
// so a preview and an export from the same settings agree frame for frame.
// Pure (no DOM, no I/O): the browser UI and unit tests drive it directly.

import { resolveHudSpec } from './config.js';
import type { RenderConfig } from './config.js';
import { decimateTrack } from './decimate.js';
import { bboxOf, unproject } from './geo.js';
import { buildSceneData } from './page.js';
import { computeOverview, planIntroOutroFrames } from './plan.js';
import type { SceneData } from './renderer/scene.js';
import { TILE_SOURCES } from './renderer/tilesources.js';

export interface RestyleMeta {
  /** Frames per second and total count of the probed source. */
  fps: number;
  frames: number;
  /** Where the consumer serves tiles from ("/tiles", "app://bundle/tiles"). */
  tileBase: string;
}

export function restyleSceneData(
  prev: SceneData,
  config: RenderConfig,
  meta: RestyleMeta,
): SceneData {
  const src = TILE_SOURCES[config.style];
  const overview = computeOverview({
    bbox: bboxOf(prev.lat, prev.lon),
    width: prev.width,
    height: prev.height,
    maxZoom: src.maxZoom || 19,
    maxNativeZoom: src.maxNativeZoom || null,
    zoomOut: config.zoomOut,
    zoomOverride: config.zoom,
    follow: config.view === 'follow',
  });
  const introOutro = planIntroOutroFrames(
    config,
    { fps: meta.fps, frames: meta.frames },
    () => {},
  );
  return buildSceneData(
    {
      width: prev.width,
      height: prev.height,
      style: config.style,
      view: config.view,
      center: unproject(overview.centerPx.x, overview.centerPx.y, overview.zoom),
      zoom: overview.zoom,
      attribution: src.attribution,
      introN: introOutro.introN,
      outroN: introOutro.outroN,
      lat: prev.lat,
      lon: prev.lon,
      alt: prev.alt,
      speed: prev.speed,
      headingDeg: prev.headingDeg,
      hud: resolveHudSpec(config.hud, prev.alt.some((a) => a !== null)),
      // Decimation depends only on the track and the working zoom, so an
      // unchanged zoom keeps the identical arrays (the scene then knows no
      // trail work is needed).
      decimated:
        overview.zoom === prev.zoom
          ? { lat: prev.trailLat, lon: prev.trailLon, frame: prev.trailFrame }
          : decimateTrack(prev.lat, prev.lon, overview.zoom),
    },
    meta.tileBase,
  );
}
