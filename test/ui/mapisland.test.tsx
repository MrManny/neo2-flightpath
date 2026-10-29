// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Scene, SceneData } from '../../src/renderer/scene.js';
import type { LeafletApi } from '../../src/renderer/leaflet.js';
import { MapIsland } from '../../ui/components/MapIsland.js';

const fakeL = vi.hoisted((): LeafletApi => {
  const layer = { addTo: () => {}, remove: () => {} };
  return {
    map: () => ({
      setView: () => {},
      getCenter: () => ({ lat: 46.6, lng: 14.26 }),
      project: (latlng) => ({
        x: (Array.isArray(latlng) ? latlng[0] : latlng.lat) * 1000,
        y: (Array.isArray(latlng) ? latlng[1] : latlng.lng) * 1000,
      }),
      invalidateSize: () => {},
    }),
    tileLayer: () => ({ ...layer, on: () => {}, setUrl: () => {} }),
    latLngBounds: () => ({
      getCenter: () => ({ lat: 46.61, lng: 14.26 }),
      getNorthWest: () => ({ lat: 46.62, lng: 14.25 }),
      getSouthEast: () => ({ lat: 46.6, lng: 14.27 }),
    }),
    polyline: () => ({ ...layer, addLatLng: () => {}, setLatLngs: () => {} }),
    circleMarker: () => layer,
    marker: () => ({ ...layer, setLatLng: () => {} }),
    divIcon: (options) => options,
  };
});

vi.mock('leaflet', () => ({ default: fakeL }));

const DATA: SceneData = {
  style: 'satellite',
  tileUrl: 'app://bundle/tiles/satellite/{z}/{x}/{y}.png',
  view: 'follow',
  width: 768,
  height: 768,
  zoom: 15,
  center: { lat: 46.61, lon: 14.26 },
  attribution: 'Test Attribution',
  introN: 0,
  outroN: 0,
  lat: [46.61, 46.611],
  lon: [14.26, 14.261],
  alt: [10, 11],
  speed: [2.5, 3.1],
  headingDeg: [0, 90],
  hud: { heading: true, alt: true, speed: true },
  trailLat: [46.61],
  trailLon: [14.26],
  trailFrame: [0],
};

interface FakeObserver {
  cb: ResizeObserverCallback;
  observed: boolean;
  disconnected: boolean;
}

const observers: FakeObserver[] = [];
const rafQueue: Array<() => void> = [];

function flushRaf(): void {
  for (const cb of rafQueue.splice(0)) cb();
}

beforeEach(() => {
  observers.length = 0;
  rafQueue.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: ResizeObserverCallback) {
        observers.push({ cb, observed: false, disconnected: false });
      }
      observe(): void {
        observers[observers.length - 1]!.observed = true;
      }
      disconnect(): void {
        observers[observers.length - 1]!.disconnected = true;
      }
    },
  );
  vi.stubGlobal('requestAnimationFrame', (cb: () => void): number => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MapIsland', () => {
  it('creates the shared scene and reports it', async () => {
    const onScene = vi.fn();
    render(<MapIsland data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    expect(observers[0]?.observed).toBe(true);
  });

  it('re-lays out after creation once the layout settles', async () => {
    const onScene = vi.fn();
    render(<MapIsland data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    const scene = onScene.mock.calls[0]![0] as Scene;
    const relayout = vi.spyOn(scene, 'relayout').mockImplementation(() => {});
    act(() => flushRaf());
    expect(relayout).toHaveBeenCalledTimes(1);
  });

  it('re-lays out the scene when the host resizes', async () => {
    const onScene = vi.fn();
    render(<MapIsland data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    const scene = onScene.mock.calls[0]![0] as Scene;
    const relayout = vi.spyOn(scene, 'relayout').mockImplementation(() => {});

    act(() => observers[0]!.cb([] as never, {} as never));
    expect(relayout).toHaveBeenCalledTimes(1);
  });

  it('stops observing on unmount', async () => {
    const onScene = vi.fn();
    const { unmount } = render(<MapIsland data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    unmount();
    expect(observers[0]?.disconnected).toBe(true);
  });

  it('restyles the scene in place when the data changes', async () => {
    const onScene = vi.fn();
    const { rerender } = render(<MapIsland data={DATA} onScene={onScene} />);
    await waitFor(() => expect(onScene).toHaveBeenCalledTimes(1));
    const scene = onScene.mock.calls[0]![0] as Scene;
    const update = vi
      .spyOn(scene, 'update')
      .mockImplementation(() => Promise.resolve());

    const changed = { ...DATA, style: 'topo' as const };
    rerender(<MapIsland data={changed} onScene={onScene} />);

    expect(update).toHaveBeenCalledWith(changed);
    expect(onScene).toHaveBeenCalledTimes(1); // no new scene, no remount
  });
});
