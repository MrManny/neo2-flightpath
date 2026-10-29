// The shared map renderer: it receives all telemetry inline (no fetch), paints
// the map once, and exposes setFrame(i) for per-frame marker/trail updates.
// Headless capture workers (via the generated page's window.__setFrame bridge)
// and the app's React map island both drive this one implementation;
// setFrame resolves after the canvas has painted so screenshots are
// frame-exact. update(data) restyles in place for the app's settings panel,
// rebuilding only the decorations the new settings actually invalidate.
//
// Views:
//   overview - static map fitted to the whole track (trail grows with time)
//   follow   - drone marker stays in the frame center and the map slides under
//              it (all tiles are loaded once up-front; the per-frame move is a
//              pure CSS transform, so no tile loads happen mid-render)

import type { HudSpec, Style, View } from '../config.js';
import type { LatLon } from '../geo.js';
import { TILE_SOURCES } from './tilesources.js';
import { el, hudMarkup, mapMarkup, sceneCss } from './dom.js';
import type { LatLngTuple, LayerHandle, LeafletApi, MapHandle, MarkerHandle, Point, PolylineHandle } from './leaflet.js';
import { computeScale, introOutroScale, metersPerPixel, scaleBarMeters } from './framemath.js';
import { themeFor } from './theme.js';
import { createTrailController } from './trail.js';
import type { TrailController } from './trail.js';

export interface SceneData {
  style: Style;
  /** Leaflet tile URL template, e.g. "/tiles/satellite/{z}/{x}/{y}.png". */
  tileUrl: string;
  view: View;
  width: number;
  height: number;
  zoom: number;
  center: LatLon;
  attribution: string;
  introN: number;
  outroN: number;
  lat: number[];
  lon: number[];
  alt: (number | null)[];
  speed: (number | null)[];
  headingDeg: number[];
  hud: HudSpec;
  trailLat: number[];
  trailLon: number[];
  trailFrame: number[];
}

export interface Scene {
  /** Aligns everything with frame i; resolves after the canvas has painted. */
  setFrame(i: number): Promise<void>;
  /** Re-lays out after a frame size change and repaints the current frame. */
  relayout(): void;
  /** Applies new settings-derived data in place; repaints the current frame. */
  update(data: SceneData): Promise<void>;
  /** Resolves once the first tile pass finished (or the warm-up timeout hit). */
  ready: Promise<void>;
}

function hudEq(a: HudSpec, b: HudSpec): boolean {
  return (
    a.heading === b.heading && a.alt === b.alt && a.speed === b.speed
  );
}

export function createScene(
  host: HTMLElement,
  firstData: SceneData,
  deps: { L: LeafletApi },
): Scene {
  const { L } = deps;
  let data = firstData;

  const styleEl = document.createElement('style');
  document.head.appendChild(styleEl);
  host.innerHTML = mapMarkup(data.hud, data.attribution);
  const attrEl = el<HTMLElement>(host, '#attr');

  function applyChrome(): void {
    styleEl.textContent = sceneCss(
      TILE_SOURCES[data.style],
      themeFor(data.style),
      data.width,
      data.height,
      computeScale(data.width, data.height),
    );
    attrEl.innerHTML = data.attribution;
  }
  applyChrome();

  const mapEl = el<HTMLElement>(host, '#map');
  const map: MapHandle = L.map(mapEl, {
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
    preferCanvas: true,
    zoomSnap: 1,
  });
  let tiles = L.tileLayer(data.tileUrl, {
    maxZoom: TILE_SOURCES[data.style].maxZoom,
    maxNativeZoom: TILE_SOURCES[data.style].maxNativeZoom || undefined,
  });
  tiles.addTo(map);

  let latlngs: LatLngTuple[] = data.lat.map(
    (la, i): LatLngTuple => [la, data.lon[i]],
  );
  let bb = L.latLngBounds(latlngs);
  const frameEl = el<HTMLElement>(host, '#map-frame');
  const scalelineEl = el<HTMLElement>(host, '#scaleline');
  const scaletextEl = el<HTMLElement>(host, '#scaletext');

  // The element is larger than the frame:
  // in follow mode it slides under the centered drone marker, and the intro/
  // outro zoom-out shows up to 2x the frame area (scale 0.5 = one level out).
  let vw = data.width;
  let vh = data.height;
  let bigW = 0;
  let bigH = 0;
  let c0: Point = { x: 0, y: 0 };
  let bestM = 0;
  let mPerPx = 0;
  let curIdx = 0;

  // The map fills its frame at any size (headless: the export canvas; app:
  // the pane currently holding it), so every frame size change re-lays out.
  function layoutMap(): void {
    vw = frameEl.clientWidth || data.width;
    vh = frameEl.clientHeight || data.height;
    if (data.view === 'follow') {
      const pb1 = map.project(bb.getNorthWest(), data.zoom);
      const pb2 = map.project(bb.getSouthEast(), data.zoom);
      bigW = Math.max(2 * vw, Math.ceil(Math.abs(pb2.x - pb1.x) + 2 * vw));
      bigH = Math.max(2 * vh, Math.ceil(Math.abs(pb2.y - pb1.y) + 2 * vh));
    } else {
      bigW = 2 * vw;
      bigH = 2 * vh;
    }
    mapEl.style.width = bigW + 'px';
    mapEl.style.height = bigH + 'px';
    map.invalidateSize();
    map.setView(data.view === 'follow' ? bb.getCenter() : [data.center.lat, data.center.lon], data.zoom);
    c0 = map.project(map.getCenter(), data.zoom);

    // Static scale bar (the map never zooms during a render).
    const latC = data.view === 'follow' ? bb.getCenter().lat : data.center.lat;
    mPerPx = metersPerPixel(latC, data.zoom);
    bestM = scaleBarMeters(mPerPx, 110 * scale());
    scalelineEl.style.width = Math.round(bestM / mPerPx) + 'px';
    scaletextEl.textContent = bestM >= 1000 ? bestM / 1000 + ' km' : bestM + ' m';
  }
  // Before the layers below: Leaflet defers marker DOM creation until the map
  // has a view, so the arrow/wrap elements only exist after this first call.
  layoutMap();

  // Everything theme-dependent (colors, sizes): layered trail (ghost ->
  // glow -> casing -> core), start dot and the drone marker. Rebuilt as a
  // whole when the style or the decimated trail changes.
  let decorLayers: LayerHandle[] = [];
  let trailLayers: PolylineHandle[] = [];
  let drone: MarkerHandle;
  let trailCtl: TrailController;
  let arrowEl: HTMLElement | null = null;
  let wrapEl: HTMLElement | null = null;

  function scale(): number {
    return computeScale(data.width, data.height);
  }

  function buildDecor(): void {
    const theme = themeFor(data.style);
    const s = scale();

    // All geometry is pre-decimated (smoothFactor 0 skips Leaflet's own
    // simplification) and the canvas renderer keeps redraws rAF-batched.
    const ghostLatlngs: LatLngTuple[] = data.trailLat.map(
      (la, i): LatLngTuple => [la, data.trailLon[i]],
    );
    const ghostDash = Math.round(7 * s) + ' ' + Math.round(9 * s);
    const layers: LayerHandle[] = [];
    if (theme.ghostCasing) {
      const ghostCasing = L.polyline(ghostLatlngs, {
        color: theme.ghostCasing,
        weight: Math.max(3, 4.6 * s),
        opacity: 1,
        dashArray: ghostDash,
        lineCap: 'round',
        smoothFactor: 0,
      });
      ghostCasing.addTo(map);
      layers.push(ghostCasing);
    }
    const ghost = L.polyline(ghostLatlngs, {
      color: theme.ghost,
      weight: Math.max(2, 2.8 * s),
      opacity: theme.ghostOpacity,
      dashArray: ghostDash,
      lineCap: 'round',
      smoothFactor: 0,
    });
    ghost.addTo(map);
    layers.push(ghost);

    const wCore = Math.max(3, 5.5 * s);
    const trailGlow: PolylineHandle = L.polyline([], {
      color: theme.glow,
      weight: wCore * 2.6,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 0,
    });
    trailGlow.addTo(map);
    const trailCasing: PolylineHandle = L.polyline([], {
      color: theme.casing,
      weight: wCore * 1.6,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 0,
    });
    trailCasing.addTo(map);
    const trail: PolylineHandle = L.polyline([], {
      color: theme.core,
      weight: wCore,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 0,
    });
    trail.addTo(map);
    const startDot = L.circleMarker(latlngs[0], {
      radius: Math.round(7 * s),
      color: '#ffffff',
      weight: Math.max(2, 2 * s),
      fillColor: theme.core,
      fillOpacity: 1,
    });
    startDot.addTo(map);

    const arrowHtml =
      '<div class="drone-wrap"><div class="drone-arrow" id="drone-arrow">' +
      '<svg viewBox="0 0 24 24"><path d="M12 1.8 L21 22 L12 16.9 L3 22 Z" fill="' + theme.core +
      '" stroke="rgba(255,255,255,0.9)" stroke-width="0.9" stroke-linejoin="round"/></svg>' +
      '</div></div>';
    const marker: MarkerHandle = L.marker(latlngs[0], {
      icon: L.divIcon({
        className: 'drone-icon',
        html: arrowHtml,
        iconSize: [Math.round(46 * s), Math.round(46 * s)],
        iconAnchor: [Math.round(23 * s), Math.round(23 * s)],
      }),
      interactive: false,
      keyboard: false,
    });
    marker.addTo(map);

    decorLayers = [trailGlow, trailCasing, trail, startDot, marker, ...layers];
    trailLayers = [trail, trailGlow, trailCasing];
    drone = marker;
    arrowEl = host.querySelector<HTMLElement>('#drone-arrow');
    wrapEl = host.querySelector<HTMLElement>('.drone-wrap');
    trailCtl = createTrailController(
      data.trailLat,
      data.trailLon,
      data.trailFrame,
      trailLayers,
    );
    if (!data.hud.heading && arrowEl) arrowEl.style.display = 'none';
  }

  function rebuildDecor(): void {
    for (const layer of decorLayers) layer.remove();
    buildDecor();
  }

  let altEl: HTMLElement | null = null;
  let speedEl: HTMLElement | null = null;

  function rebuildHud(): void {
    el<HTMLElement>(host, '#hud').innerHTML = hudMarkup(data.hud);
    altEl = host.querySelector<HTMLElement>('#chip-alt .num');
    speedEl = host.querySelector<HTMLElement>('#chip-speed .num');
    if (arrowEl) arrowEl.style.display = data.hud.heading ? '' : 'none';
  }

  buildDecor();
  rebuildHud();

  function setFrame(i: number): Promise<void> {
    curIdx = i;
    trailCtl.setFrame(i);
    drone.setLatLng(latlngs[i]);
    const k = introOutroScale(i, data.introN, data.outroN, data.lat.length);
    let dx = 0;
    let dy = 0;
    if (data.view === 'follow') {
      const p = map.project(latlngs[i], data.zoom);
      dx = p.x - c0.x;
      dy = p.y - c0.y;
    }
    mapEl.style.transform =
      'translate(' + (vw / 2 - bigW / 2 - k * dx) + 'px,' +
      (vh / 2 - bigH / 2 - k * dy) + 'px) scale(' + k + ')';
    if (wrapEl) {
      wrapEl.style.transform = k === 1 ? '' : 'scale(' + 1 / k + ')';
    }
    scalelineEl.style.width = Math.round((bestM / mPerPx) * k) + 'px';
    if (data.hud.heading && arrowEl) {
      arrowEl.style.transform = 'rotate(' + data.headingDeg[i] + 'deg)';
    }
    if (altEl) {
      const a = data.alt[i];
      altEl.textContent = a === null || a === undefined ? '--' : String(Math.round(a));
    }
    if (speedEl) {
      const s = data.speed[i];
      speedEl.textContent = s === null || s === undefined ? '--' : s.toFixed(1);
    }
    // Canvas painting is deferred to requestAnimationFrame; the headless
    // capture awaits this barrier so screenshots never catch the previous
    // frame.
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  function relayout(): void {
    layoutMap();
    void setFrame(curIdx);
  }

  function update(next: SceneData): Promise<void> {
    const prev = data;
    data = next;
    if (next.lat !== prev.lat) {
      latlngs = next.lat.map((la, i): LatLngTuple => [la, next.lon[i]]);
      bb = L.latLngBounds(latlngs);
    }
    applyChrome();
    if (next.style !== prev.style) {
      // The zoom constraints are per source (topo tiles are native to z17),
      // so a style switch swaps the layer instead of only its URL.
      tiles.remove();
      tiles = L.tileLayer(next.tileUrl, {
        maxZoom: TILE_SOURCES[next.style].maxZoom,
        maxNativeZoom: TILE_SOURCES[next.style].maxNativeZoom || undefined,
      });
      tiles.addTo(map);
    } else if (next.tileUrl !== prev.tileUrl) {
      tiles.setUrl(next.tileUrl);
    }
    const decorInvalidated =
      next.style !== prev.style ||
      next.trailLat !== prev.trailLat ||
      next.width !== prev.width ||
      next.height !== prev.height;
    if (decorInvalidated) rebuildDecor();
    if (!hudEq(prev.hud, next.hud)) rebuildHud();
    layoutMap();
    return setFrame(curIdx);
  }

  const ready = new Promise<void>((resolve) => {
    let done = false;
    const markReady = (): void => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    tiles.on('load', markReady);
    setTimeout(markReady, 12000);
  });

  return { setFrame, relayout, update, ready };
}
