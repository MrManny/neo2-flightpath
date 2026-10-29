// Settings -> scene mapping for the app's live restyle. It runs the very
// planning the pipeline runs (page.planPageOpts over the telemetry's fix
// bbox), so a preview and an export from the same settings agree frame for
// frame. Pure (no DOM, no I/O): the browser UI and unit tests drive it
// directly.

import type { RenderConfig } from './config.js';
import type { Bbox } from './geo.js';
import { buildSceneData, planPageOpts } from './page.js';
import type { SceneData } from './renderer/scene.js';

export interface RestyleMeta {
  /** Frames per second and total count of the probed source. */
  fps: number;
  frames: number;
  /** Where the consumer serves tiles from ("/tiles", "app://bundle/tiles"). */
  tileBase: string;
  /** The telemetry's fix bbox - the same one the pipeline plans from. */
  bbox: Bbox;
}

export function restyleSceneData(
  prev: SceneData,
  config: RenderConfig,
  meta: RestyleMeta,
): SceneData {
  const planned = planPageOpts({
    bbox: meta.bbox,
    width: prev.width,
    height: prev.height,
    config,
    source: { fps: meta.fps, frames: meta.frames },
    frames: prev,
    previous: {
      zoom: prev.zoom,
      decimated: { lat: prev.trailLat, lon: prev.trailLon, frame: prev.trailFrame },
    },
  });
  return buildSceneData(planned, meta.tileBase);
}
