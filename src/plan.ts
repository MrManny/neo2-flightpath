// Pure planning shared by the headless pipeline and the app UI: which zoom,
// center and tiles cover a track at a given frame size, and how intro/outro
// timing maps to frames. No I/O lives here, so the browser bundle can import
// it; the preview and an export therefore always plan identically.

import type { RenderConfig } from './config.js';
import { project } from './geo.js';
import type { Bbox, Pixel } from './geo.js';

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export interface OverviewOptions {
  bbox: Bbox;
  width: number;
  height: number;
  maxZoom?: number;
  zoomOut?: number;
  follow?: boolean;
  maxNativeZoom?: number | null;
  zoomOverride?: number;
}

export interface Overview {
  centerPx: Pixel;
  zoom: number;
  tiles: TileCoord[];
}

const MIN_ZOOM = 2;
const HOVER_ZOOM_FLOOR = 16;
const MIN_TRACK_SPAN_PX = 80; // tiny/hovering tracks stay a useful close-up
const TILE_SIZE_PX = 256;

function fitZoomToTrack(
  bbox: Bbox,
  availW: number,
  availH: number,
  maxZoom: number,
): number {
  for (let zoom = maxZoom; zoom >= MIN_ZOOM; zoom--) {
    const northWest = project(bbox.minLon, bbox.maxLat, zoom);
    const southEast = project(bbox.maxLon, bbox.minLat, zoom);
    const fits =
      southEast.x - northWest.x <= availW &&
      southEast.y - northWest.y <= availH;
    if (fits) return zoom;
  }
  return MIN_ZOOM;
}

// Never zoom a tiny (hovering) track past a useful overview.
function pullBackTinyTracks(zoom: number, bbox: Bbox): number {
  while (zoom > HOVER_ZOOM_FLOOR) {
    const northWest = project(bbox.minLon, bbox.maxLat, zoom);
    const southEast = project(bbox.maxLon, bbox.minLat, zoom);
    const spansEnough =
      southEast.x - northWest.x >= MIN_TRACK_SPAN_PX ||
      southEast.y - northWest.y >= MIN_TRACK_SPAN_PX;
    if (spansEnough) break;
    zoom--;
  }
  return zoom;
}

// The map element is 2x the frame (intro/outro zoom-out shows up to 2x the
// area) and in follow mode it also slides across the track extent. With a
// native-zoom limit the tiles live one or more levels below the view zoom.
function tilesCovering(
  centerPx: Pixel,
  trackSpanPx: Pixel,
  zoom: number,
  width: number,
  height: number,
  follow: boolean,
  maxNativeZoom: number | null,
): TileCoord[] {
  const tileZoom = maxNativeZoom
    ? Math.min(zoom, maxNativeZoom)
    : zoom;
  const scale = 2 ** (tileZoom - zoom);
  const halfW = (width + TILE_SIZE_PX + (follow ? trackSpanPx.x / 2 : 0)) * scale;
  const halfH = (height + TILE_SIZE_PX + (follow ? trackSpanPx.y / 2 : 0)) * scale;

  const maxTileIndex = 2 ** tileZoom - 1;
  const xMin = Math.max(0, Math.floor((centerPx.x * scale - halfW) / TILE_SIZE_PX));
  const xMax = Math.min(maxTileIndex, Math.floor((centerPx.x * scale + halfW) / TILE_SIZE_PX));
  const yMin = Math.max(0, Math.floor((centerPx.y * scale - halfH) / TILE_SIZE_PX));
  const yMax = Math.min(maxTileIndex, Math.floor((centerPx.y * scale + halfH) / TILE_SIZE_PX));

  const tiles: TileCoord[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) tiles.push({ z: tileZoom, x, y });
  }
  return tiles;
}

// zoomOut adds surroundings context; follow mode slides the map under a
// centered marker. When the source has a maxNativeZoom below the view zoom,
// tiles are fetched at the native level (Leaflet scales them).
export function computeOverview({
  bbox,
  width,
  height,
  maxZoom = 19,
  zoomOut = 0,
  follow = false,
  maxNativeZoom = null,
  zoomOverride = 0,
}: OverviewOptions): Overview {
  const padX = Math.round(width * 0.08);
  const padY = Math.round(height * 0.08);
  const availW = Math.max(64, width - 2 * padX);
  const availH = Math.max(64, height - 2 * padY);

  let zoom: number;
  if (zoomOverride > 0) {
    zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, Math.round(zoomOverride)));
  } else {
    zoom = pullBackTinyTracks(
      fitZoomToTrack(bbox, availW, availH, maxZoom),
      bbox,
    );
    zoom = Math.max(MIN_ZOOM, zoom - Math.max(0, Math.floor(zoomOut)));
  }

  // Degenerate (hovering) track: show a close-up around the single point.
  const northWest = project(bbox.minLon, bbox.maxLat, zoom);
  const southEast = project(bbox.maxLon, bbox.minLat, zoom);
  const centerPx: Pixel = {
    x: (northWest.x + southEast.x) / 2,
    y: (northWest.y + southEast.y) / 2,
  };
  const trackSpanPx: Pixel = {
    x: southEast.x - northWest.x,
    y: southEast.y - northWest.y,
  };

  return {
    centerPx,
    zoom,
    tiles: tilesCovering(
      centerPx, trackSpanPx, zoom, width, height, follow, maxNativeZoom,
    ),
  };
}

export interface IntroOutroFrames {
  introN: number;
  outroN: number;
}

// Intro/outro zoom timing (frames); clamp for very short clips.
export function planIntroOutroFrames(
  config: Pick<RenderConfig, 'introSec' | 'outroSec'>,
  source: { fps: number; frames: number },
  log: (msg: string) => void,
): IntroOutroFrames {
  let introN = Math.max(0, Math.round(config.introSec * source.fps));
  let outroN = Math.max(0, Math.round(config.outroSec * source.fps));
  const budget = Math.max(2, Math.floor(source.frames / 2));
  if (introN + outroN > budget) {
    const scale = budget / (introN + outroN);
    introN = Math.floor(introN * scale);
    outroN = Math.floor(outroN * scale);
    log(`intro/outro shortened to ${introN}/${outroN} frames for this clip`);
  }
  return { introN, outroN };
}
