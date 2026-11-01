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
import { droneMarkerMarkup, el, hudMarkup, mapMarkup, sceneCss } from './dom.js';
import type {
  BoundsHandle,
  LatLngTuple,
  LayerHandle,
  LeafletApi,
  MapHandle,
  MarkerHandle,
  Point,
  PolylineHandle,
  TileLayerHandle,
} from './leaflet.js';
import { computeScale, introOutroScale, metersPerPixel, scaleBarMeters } from './framemath.js';
import type { Theme } from './theme.js';
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

interface Layout {
  vw: number;
  vh: number;
  bigW: number;
  bigH: number;
  c0: Point;
  bestM: number;
  mPerPx: number;
}

interface Decor {
  layers: LayerHandle[];
  trailLayers: PolylineHandle[];
  drone: MarkerHandle;
  trailCtl: TrailController;
  arrowEl: HTMLElement | null;
  wrapEl: HTMLElement | null;
}

function setChipText(
  chip: HTMLElement | null,
  value: number | null | undefined,
  format: (v: number) => string,
): void {
  if (!chip) return;
  chip.textContent = value === null || value === undefined ? '--' : format(value);
}

class SceneState implements Scene {
  readonly ready: Promise<void>;

  private data: SceneData;
  private readonly L: LeafletApi;
  private readonly host: HTMLElement;
  private readonly styleEl: HTMLStyleElement;
  private readonly attrEl: HTMLElement;
  private readonly mapEl: HTMLElement;
  private readonly frameEl: HTMLElement;
  private readonly scalelineEl: HTMLElement;
  private readonly scaletextEl: HTMLElement;
  private readonly map: MapHandle;
  private tiles: TileLayerHandle;
  private latlngs: LatLngTuple[];
  private bb: BoundsHandle;
  private layout!: Layout;
  private decor!: Decor;
  private altEl: HTMLElement | null = null;
  private speedEl: HTMLElement | null = null;
  private curIdx = 0;

  constructor(host: HTMLElement, firstData: SceneData, L: LeafletApi) {
    this.host = host;
    this.data = firstData;
    this.L = L;

    this.styleEl = document.createElement('style');
    document.head.appendChild(this.styleEl);
    host.innerHTML = mapMarkup(firstData.hud, firstData.attribution);
    this.attrEl = el<HTMLElement>(host, '#attr');
    this.applyChrome();

    this.mapEl = el<HTMLElement>(host, '#map');
    this.map = L.map(this.mapEl, {
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
    this.tiles = this.makeTileLayer(firstData.tileUrl, firstData.style);
    this.tiles.addTo(this.map);
    this.latlngs = this.latlngsOf(firstData);
    this.bb = L.latLngBounds(this.latlngs);

    this.frameEl = el<HTMLElement>(host, '#map-frame');
    this.scalelineEl = el<HTMLElement>(host, '#scaleline');
    this.scaletextEl = el<HTMLElement>(host, '#scaletext');

    // Before the decorations below: Leaflet defers marker DOM creation until
    // the map has a view, so the arrow/wrap elements only exist after this
    // first call.
    this.layoutMap();
    this.decor = this.buildDecor();
    this.rebuildHud();

    this.ready = new Promise<void>((resolve) => {
      const markReady = (): void => resolve();
      this.tiles.on('load', markReady);
      setTimeout(markReady, 12000);
    });
  }

  private scale(): number {
    return computeScale(this.data.width, this.data.height);
  }

  private makeTileLayer(tileUrl: string, style: Style): TileLayerHandle {
    return this.L.tileLayer(tileUrl, {
      maxZoom: TILE_SOURCES[style].maxZoom,
      maxNativeZoom: TILE_SOURCES[style].maxNativeZoom ?? undefined,
    });
  }

  private latlngsOf(data: SceneData): LatLngTuple[] {
    return data.lat.map((la, i): LatLngTuple => [la, data.lon[i]]);
  }

  private applyChrome(): void {
    this.styleEl.textContent = sceneCss(
      TILE_SOURCES[this.data.style],
      themeFor(this.data.style),
      this.data.width,
      this.data.height,
      this.scale(),
    );
    this.attrEl.innerHTML = this.data.attribution;
  }

  // The map fills its frame at any size (headless: the export canvas; app:
  // the pane currently holding it), so every frame size change re-lays out.
  private layoutMap(): void {
    const { data, map, mapEl, frameEl } = this;
    const vw = frameEl.clientWidth || data.width;
    const vh = frameEl.clientHeight || data.height;
    let bigW: number;
    let bigH: number;
    if (data.view === 'follow') {
      const pb1 = map.project(this.bb.getNorthWest(), data.zoom);
      const pb2 = map.project(this.bb.getSouthEast(), data.zoom);
      bigW = Math.max(2 * vw, Math.ceil(Math.abs(pb2.x - pb1.x) + 2 * vw));
      bigH = Math.max(2 * vh, Math.ceil(Math.abs(pb2.y - pb1.y) + 2 * vh));
    } else {
      bigW = 2 * vw;
      bigH = 2 * vh;
    }
    mapEl.style.width = bigW + 'px';
    mapEl.style.height = bigH + 'px';
    map.invalidateSize();
    map.setView(data.view === 'follow' ? this.bb.getCenter() : [data.center.lat, data.center.lon], data.zoom);
    const c0 = map.project(map.getCenter(), data.zoom);

    // Static scale bar (the map never zooms during a render).
    const latC = data.view === 'follow' ? this.bb.getCenter().lat : data.center.lat;
    const mPerPx = metersPerPixel(latC, data.zoom);
    const bestM = scaleBarMeters(mPerPx, 110 * this.scale());
    this.scalelineEl.style.width = Math.round(bestM / mPerPx) + 'px';
    this.scaletextEl.textContent = bestM >= 1000 ? bestM / 1000 + ' km' : bestM + ' m';
    this.layout = { vw, vh, bigW, bigH, c0, bestM, mPerPx };
  }

  private buildGhostLayers(theme: Theme, ghostLatlngs: LatLngTuple[], ghostDash: string): LayerHandle[] {
    const s = this.scale();
    const layers: LayerHandle[] = [];
    if (theme.ghostCasing) {
      const ghostCasing = this.L.polyline(ghostLatlngs, {
        color: theme.ghostCasing,
        weight: Math.max(3, 4.6 * s),
        opacity: 1,
        dashArray: ghostDash,
        lineCap: 'round',
        smoothFactor: 0,
      });
      ghostCasing.addTo(this.map);
      layers.push(ghostCasing);
    }
    const ghost = this.L.polyline(ghostLatlngs, {
      color: theme.ghost,
      weight: Math.max(2, 2.8 * s),
      opacity: theme.ghostOpacity,
      dashArray: ghostDash,
      lineCap: 'round',
      smoothFactor: 0,
    });
    ghost.addTo(this.map);
    layers.push(ghost);
    return layers;
  }

  // The live trail layers (empty until the controller fills them): glow,
  // casing and core, thickest first so the core stays on top.
  private buildTrailLayers(theme: Theme): PolylineHandle[] {
    // All geometry is pre-decimated (smoothFactor 0 skips Leaflet's own
    // simplification) and the canvas renderer keeps redraws rAF-batched.
    const wCore = Math.max(3, 5.5 * this.scale());
    const trailGlow: PolylineHandle = this.L.polyline([], {
      color: theme.glow,
      weight: wCore * 2.6,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 0,
    });
    trailGlow.addTo(this.map);
    const trailCasing: PolylineHandle = this.L.polyline([], {
      color: theme.casing,
      weight: wCore * 1.6,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 0,
    });
    trailCasing.addTo(this.map);
    const trail: PolylineHandle = this.L.polyline([], {
      color: theme.core,
      weight: wCore,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
      smoothFactor: 0,
    });
    trail.addTo(this.map);
    return [trail, trailGlow, trailCasing];
  }

  private buildMarker(theme: Theme, s: number): { startDot: LayerHandle; drone: MarkerHandle } {
    const startDot = this.L.circleMarker(this.latlngs[0], {
      radius: Math.round(7 * s),
      color: '#ffffff',
      weight: Math.max(2, 2 * s),
      fillColor: theme.core,
      fillOpacity: 1,
    });
    startDot.addTo(this.map);
    const drone: MarkerHandle = this.L.marker(this.latlngs[0], {
      icon: this.L.divIcon({
        className: 'drone-icon',
        html: droneMarkerMarkup(theme.core),
        iconSize: [Math.round(46 * s), Math.round(46 * s)],
        iconAnchor: [Math.round(23 * s), Math.round(23 * s)],
      }),
      interactive: false,
      keyboard: false,
    });
    drone.addTo(this.map);
    return { startDot, drone };
  }

  private buildDecor(): Decor {
    const theme = themeFor(this.data.style);
    const s = this.scale();
    const ghostLatlngs: LatLngTuple[] = this.data.trailLat.map(
      (la, i): LatLngTuple => [la, this.data.trailLon[i]],
    );
    const ghostDash = Math.round(7 * s) + ' ' + Math.round(9 * s);

    const ghostLayers = this.buildGhostLayers(theme, ghostLatlngs, ghostDash);
    const trailLayers = this.buildTrailLayers(theme);
    const { startDot, drone } = this.buildMarker(theme, s);

    const decor: Decor = {
      layers: [...trailLayers, startDot, drone, ...ghostLayers],
      trailLayers,
      drone,
      trailCtl: createTrailController(
        this.data.trailLat,
        this.data.trailLon,
        this.data.trailFrame,
        trailLayers,
      ),
      arrowEl: this.host.querySelector<HTMLElement>('#drone-arrow'),
      wrapEl: this.host.querySelector<HTMLElement>('.drone-wrap'),
    };
    if (!this.data.hud.heading && decor.arrowEl) decor.arrowEl.style.display = 'none';
    return decor;
  }

  private rebuildDecor(): void {
    for (const layer of this.decor.layers) layer.remove();
    this.decor = this.buildDecor();
  }

  private rebuildHud(): void {
    el<HTMLElement>(this.host, '#hud').innerHTML = hudMarkup(this.data.hud);
    this.altEl = this.host.querySelector<HTMLElement>('#chip-alt .num');
    this.speedEl = this.host.querySelector<HTMLElement>('#chip-speed .num');
    if (this.decor.arrowEl) {
      this.decor.arrowEl.style.display = this.data.hud.heading ? '' : 'none';
    }
  }

  private updateTransform(i: number, k: number): void {
    const { data, layout, decor, mapEl } = this;
    let dx = 0;
    let dy = 0;
    if (data.view === 'follow') {
      const p = this.map.project(this.latlngs[i], data.zoom);
      dx = p.x - layout.c0.x;
      dy = p.y - layout.c0.y;
    }
    mapEl.style.transform =
      'translate(' + (layout.vw / 2 - layout.bigW / 2 - k * dx) + 'px,' +
      (layout.vh / 2 - layout.bigH / 2 - k * dy) + 'px) scale(' + k + ')';
    if (decor.wrapEl) {
      decor.wrapEl.style.transform = k === 1 ? '' : 'scale(' + 1 / k + ')';
    }
    this.scalelineEl.style.width = Math.round((layout.bestM / layout.mPerPx) * k) + 'px';
    if (data.hud.heading && decor.arrowEl) {
      decor.arrowEl.style.transform = 'rotate(' + data.headingDeg[i] + 'deg)';
    }
  }

  private updateHud(i: number): void {
    setChipText(this.altEl, this.data.alt[i], (a) => String(Math.round(a)));
    setChipText(this.speedEl, this.data.speed[i], (s) => s.toFixed(1));
  }

  setFrame(i: number): Promise<void> {
    this.curIdx = i;
    this.decor.trailCtl.setFrame(i);
    this.decor.drone.setLatLng(this.latlngs[i]);
    const k = introOutroScale(i, this.data.introN, this.data.outroN, this.data.lat.length);
    this.updateTransform(i, k);
    this.updateHud(i);
    // Canvas painting is deferred to requestAnimationFrame; the headless
    // capture awaits this barrier so screenshots never catch the previous
    // frame.
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  relayout(): void {
    this.layoutMap();
    void this.setFrame(this.curIdx);
  }

  update(next: SceneData): Promise<void> {
    const prev = this.data;
    this.data = next;
    if (next.lat !== prev.lat) {
      this.latlngs = this.latlngsOf(next);
      this.bb = this.L.latLngBounds(this.latlngs);
    }
    const chromeChanged =
      next.style !== prev.style ||
      next.width !== prev.width ||
      next.height !== prev.height ||
      next.attribution !== prev.attribution;
    if (chromeChanged) this.applyChrome();
    if (next.style !== prev.style) {
      // The zoom constraints are per source (topo tiles are native to z17),
      // so a style switch swaps the layer instead of only its URL.
      this.tiles.remove();
      this.tiles = this.makeTileLayer(next.tileUrl, next.style);
      this.tiles.addTo(this.map);
    } else if (next.tileUrl !== prev.tileUrl) {
      this.tiles.setUrl(next.tileUrl);
    }
    const decorInvalidated =
      next.style !== prev.style ||
      next.trailLat !== prev.trailLat ||
      next.width !== prev.width ||
      next.height !== prev.height;
    if (decorInvalidated) this.rebuildDecor();
    if (!hudEq(prev.hud, next.hud)) this.rebuildHud();
    this.layoutMap();
    return this.setFrame(this.curIdx);
  }
}

export function createScene(
  host: HTMLElement,
  firstData: SceneData,
  deps: { L: LeafletApi },
): Scene {
  return new SceneState(host, firstData, deps.L);
}
