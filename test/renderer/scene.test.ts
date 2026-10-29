// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LatLngExpr, LeafletApi, MarkerHandle, PolylineHandle, TileLayerHandle } from '../../src/renderer/leaflet.js';
import { createScene } from '../../src/renderer/scene.js';
import type { SceneData } from '../../src/renderer/scene.js';

interface PolylineRecord {
  points: Array<[number, number]>;
  sets: Array<Array<[number, number]>>;
  adds: Array<[number, number]>;
}

interface MarkerRecord {
  kind: 'marker' | 'circle';
  latlngs: LatLngExpr[];
}

function latOf(ll: LatLngExpr): number {
  return Array.isArray(ll) ? ll[0] : ll.lat;
}

function lngOf(ll: LatLngExpr): number {
  return Array.isArray(ll) ? ll[1] : ll.lng;
}

function fakeL(host: HTMLElement): {
  L: LeafletApi;
  polylines: PolylineRecord[];
  markers: MarkerRecord[];
  tile: { url: string; urls: string[]; handlers: Record<string, () => void> };
  map: { views: Array<[LatLngExpr, number]>; invalidations: number };
  removals: { count: number };
} {
  const polylines: PolylineRecord[] = [];
  const markers: MarkerRecord[] = [];
  const removals = { count: 0 };
  const tile = {
    url: '',
    urls: [] as string[],
    handlers: {} as Record<string, () => void>,
  };
  const map = { views: [] as Array<[LatLngExpr, number]>, invalidations: 0 };

  const L: LeafletApi = {
    map: () => ({
      setView(center, zoom) {
        map.views.push([center, zoom]);
      },
      getCenter: () => ({ lat: 46.6, lng: 14.26 }),
      project: (latlng) => ({ x: latOf(latlng) * 1000, y: lngOf(latlng) * 1000 }),
      invalidateSize() {
        map.invalidations++;
      },
    }),
    tileLayer: (url): TileLayerHandle => {
      tile.url = url;
      tile.urls.push(url);
      return {
        addTo: () => {},
        remove: () => {
          removals.count++;
        },
        setUrl: (next) => {
          tile.url = next;
          tile.urls.push(next);
        },
        on: (event, handler) => {
          tile.handlers[event] = handler;
        },
      };
    },
    latLngBounds: (points) => {
      const lats = points.map((p) => p[0]);
      const lngs = points.map((p) => p[1]);
      return {
        getCenter: () => ({
          lat: (Math.min(...lats) + Math.max(...lats)) / 2,
          lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
        }),
        getNorthWest: () => ({ lat: Math.max(...lats), lng: Math.min(...lngs) }),
        getSouthEast: () => ({ lat: Math.min(...lats), lng: Math.max(...lngs) }),
      };
    },
    polyline: (points): PolylineHandle => {
      const rec: PolylineRecord = { points, sets: [], adds: [] };
      polylines.push(rec);
      return {
        addTo: () => {},
        remove: () => {
          removals.count++;
        },
        addLatLng: (p) => {
          rec.adds.push(p);
        },
        setLatLngs: (pts) => {
          rec.sets.push(pts);
        },
      };
    },
    circleMarker: (latlng) => {
      markers.push({ kind: 'circle', latlngs: [latlng] });
      return {
        addTo: () => {},
        remove: () => {
          removals.count++;
        },
      };
    },
    marker: (latlng, options): MarkerHandle => {
      const rec: MarkerRecord = { kind: 'marker', latlngs: [latlng] };
      markers.push(rec);
      return {
        addTo: () => {
          // Leaflet materializes the divIcon HTML only after the map has a
          // view; the fake does it on add so the DOM contract holds.
          const icon = options.icon as { html?: string };
          if (icon?.html) host.insertAdjacentHTML('beforeend', icon.html);
        },
        remove: () => {
          removals.count++;
        },
        setLatLng: (ll) => {
          rec.latlngs.push(ll);
        },
      };
    },
    divIcon: (options) => options,
  };
  return { L, polylines, markers, tile, map, removals };
}

function sceneData(overrides: Partial<SceneData> = {}): SceneData {
  return {
    style: 'satellite',
    tileUrl: '/tiles/satellite/{z}/{x}/{y}.png',
    view: 'overview',
    width: 768,
    height: 768,
    zoom: 15,
    center: { lat: 46.61, lon: 14.26 },
    attribution: 'Test Attribution',
    introN: 0,
    outroN: 0,
    lat: [46.61, 46.611, 46.612],
    lon: [14.26, 14.261, 14.262],
    alt: [10, 11, null],
    speed: [null, 2.5, 3.1],
    headingDeg: [0, 90, 180],
    hud: { heading: true, alt: true, speed: true },
    trailLat: [46.61, 46.612],
    trailLon: [14.26, 14.262],
    trailFrame: [0, 2],
    ...overrides,
  };
}

const rafQueue: Array<() => void> = [];

function flushRaf(): void {
  for (const cb of rafQueue.splice(0)) cb();
}

// setFrame's side effects land immediately; the returned promise resolves
// only after the two-rAF paint barrier, which the stubbed queue must flush.
async function applyFrame(
  scene: { setFrame(i: number): Promise<void> },
  i: number,
): Promise<void> {
  const done = scene.setFrame(i);
  flushRaf();
  flushRaf();
  await done;
}

function mount(): { host: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return { host };
}

beforeEach(() => {
  rafQueue.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void): number => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('createScene', () => {
  it('paints the renderer markup and the theme style', () => {
    const { host } = mount();
    const { L, tile } = fakeL(host);
    createScene(host, sceneData(), { L });
    expect(host.querySelector('#map-frame')).toBeTruthy();
    expect(host.querySelector('#attr')?.textContent).toBe('Test Attribution');
    expect(tile.url).toBe('/tiles/satellite/{z}/{x}/{y}.png');
    expect(document.head.textContent).toContain('#map-frame');
    expect(document.head.textContent).toContain('#41f0ff');
  });

  it('centers the overview view on the configured center', () => {
    const { host } = mount();
    const { L, map } = fakeL(host);
    createScene(host, sceneData(), { L });
    expect(map.views.at(-1)).toEqual([[46.61, 14.26], 15]);
  });

  it('renders HUD chips only for enabled chips', () => {
    const { host } = mount();
    const { L } = fakeL(host);
    createScene(host, sceneData({ hud: { heading: false, alt: true, speed: false } }), { L });
    expect(host.querySelector('#chip-alt')).toBeTruthy();
    expect(host.querySelector('#chip-speed')).toBeNull();
    expect((host.querySelector('#drone-arrow') as HTMLElement).style.display).toBe('none');
  });

  it('keeps trail, marker, arrow and HUD on the same frame index', async () => {
    const { host } = mount();
    const { L, polylines, markers } = fakeL(host);
    const scene = createScene(host, sceneData(), { L });
    const drone = markers.find((m) => m.kind === 'marker') as MarkerRecord;

    await applyFrame(scene, 1);
    expect(drone.latlngs.at(-1)).toEqual([46.611, 14.261]);
    expect(host.querySelector('#chip-alt .num')?.textContent).toBe('11');
    expect(host.querySelector('#chip-speed .num')?.textContent).toBe('2.5');
    expect((host.querySelector('#drone-arrow') as HTMLElement).style.transform).toBe('rotate(90deg)');
    expect(polylines.at(-1)?.adds).toEqual([[46.61, 14.26]]);

    await applyFrame(scene, 2);
    expect(drone.latlngs.at(-1)).toEqual([46.612, 14.262]);
    expect(host.querySelector('#chip-alt .num')?.textContent).toBe('--');
    expect(host.querySelector('#chip-speed .num')?.textContent).toBe('3.1');
    expect(polylines.at(-1)?.adds).toEqual([[46.61, 14.26], [46.612, 14.262]]);
  });

  it('resolves setFrame only after the canvas paint barrier', async () => {
    const { host } = mount();
    const { L } = fakeL(host);
    const scene = createScene(host, sceneData(), { L });
    let resolved = false;
    const done = scene.setFrame(1).then(() => {
      resolved = true;
    });
    flushRaf();
    expect(resolved).toBe(false);
    flushRaf();
    await done;
    expect(resolved).toBe(true);
  });

  it('resolves ready when the first tile pass finishes', async () => {
    const { host } = mount();
    const { L, tile } = fakeL(host);
    const scene = createScene(host, sceneData(), { L });
    tile.handlers['load']?.();
    await expect(scene.ready).resolves.toBeUndefined();
  });

  it('falls back to the warm-up timeout when tiles never finish', async () => {
    vi.useFakeTimers();
    const { host } = mount();
    const { L } = fakeL(host);
    const scene = createScene(host, sceneData(), { L });
    await vi.advanceTimersByTimeAsync(12000);
    await expect(scene.ready).resolves.toBeUndefined();
  });

  it('re-lays out and repaints the current frame on relayout', async () => {
    const { host } = mount();
    const { L, map, markers } = fakeL(host);
    const scene = createScene(host, sceneData({ view: 'follow' }), { L });
    const drone = markers.find((m) => m.kind === 'marker') as MarkerRecord;
    await applyFrame(scene, 2);
    const before = drone.latlngs.length;

    scene.relayout();
    expect(map.invalidations).toBeGreaterThan(0);
    expect(drone.latlngs.length).toBeGreaterThan(before);
    expect(drone.latlngs.at(-1)).toEqual([46.612, 14.262]);
  });

  it('zooms the map out during the intro', async () => {
    const { host } = mount();
    const { L } = fakeL(host);
    const scene = createScene(host, sceneData({ introN: 4 }), { L });
    await applyFrame(scene, 0);
    const style = (host.querySelector('#map') as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain('scale(0.5)');
  });

  it('stays quiet on an empty trail', async () => {
    const { host } = mount();
    const { L, polylines } = fakeL(host);
    const scene = createScene(
      host,
      sceneData({ trailLat: [], trailLon: [], trailFrame: [] }),
      { L },
    );
    await applyFrame(scene, 2);
    expect(polylines.at(-1)?.adds).toEqual([]);
    expect(polylines.at(-1)?.sets).toEqual([]);
  });
});

async function restyle(
  scene: { update(data: SceneData): Promise<void> },
  data: SceneData,
): Promise<void> {
  const done = scene.update(data);
  flushRaf();
  flushRaf();
  await done;
}

describe('Scene.update', () => {
  it('restyles in place on a style change', async () => {
    const { host } = mount();
    const { L, polylines, tile, removals } = fakeL(host);
    const scene = createScene(host, sceneData(), { L });
    const layersBefore = polylines.length;

    await restyle(
      scene,
      sceneData({
        style: 'topo',
        tileUrl: '/tiles/topo/{z}/{x}/{y}.png',
        attribution: 'Topo Attribution',
      }),
    );

    expect(tile.urls).toContain('/tiles/topo/{z}/{x}/{y}.png');
    expect(document.head.textContent).toContain('#e63946');
    expect(host.querySelector('#attr')?.textContent).toBe('Topo Attribution');
    expect(removals.count).toBeGreaterThan(0);
    expect(polylines.length).toBeGreaterThan(layersBefore);
  });

  it('applies hud changes without touching tiles or decorations', async () => {
    const { host } = mount();
    const { L, polylines, tile, removals } = fakeL(host);
    const base = sceneData();
    const scene = createScene(host, base, { L });
    const layersBefore = polylines.length;

    await restyle(scene, {
      ...base,
      hud: { heading: false, alt: false, speed: true },
    });

    expect(host.querySelector('#chip-alt')).toBeNull();
    expect(host.querySelector('#chip-speed')).toBeTruthy();
    expect((host.querySelector('#drone-arrow') as HTMLElement).style.display).toBe('none');
    expect(tile.urls).toHaveLength(1);
    expect(removals.count).toBe(0);
    expect(polylines.length).toBe(layersBefore);
  });

  it('keeps the current frame painted after an update', async () => {
    const { host } = mount();
    const { L, markers } = fakeL(host);
    const base = sceneData();
    const scene = createScene(host, base, { L });
    const drone = markers.find((m) => m.kind === 'marker') as MarkerRecord;
    await applyFrame(scene, 1);

    await restyle(scene, { ...base, alt: [100, 101, null] });

    expect(drone.latlngs.at(-1)).toEqual([46.611, 14.261]);
    expect(host.querySelector('#chip-alt .num')?.textContent).toBe('101');
  });

  it('rebuilds the decorations when the decimated track changes', async () => {
    const { host } = mount();
    const { L, polylines, removals } = fakeL(host);
    const base = sceneData();
    const scene = createScene(host, base, { L });
    const layersBefore = polylines.length;

    await restyle(scene, {
      ...base,
      trailLat: [46.61],
      trailLon: [14.26],
      trailFrame: [0],
    });

    expect(removals.count).toBeGreaterThan(0);
    expect(polylines.length).toBeGreaterThan(layersBefore);
  });

  it('re-plans the view on a view change', async () => {
    const { host } = mount();
    const { L, map } = fakeL(host);
    const base = sceneData();
    const scene = createScene(host, base, { L });

    await restyle(scene, { ...base, view: 'follow', zoom: 13 });

    expect(map.views.at(-1)).toEqual([
      { lat: expect.closeTo(46.611, 6), lng: expect.closeTo(14.261, 6) },
      13,
    ]);
  });
});
