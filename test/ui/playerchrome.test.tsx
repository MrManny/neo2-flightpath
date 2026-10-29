// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiSession } from '../../src/appsession.js';
import type { Scene } from '../../src/renderer/scene.js';
import { PlayerChrome } from '../../ui/components/PlayerChrome.js';

const fakeScene = vi.hoisted((): Scene => ({
  setFrame: vi.fn(() => Promise.resolve()),
  relayout: vi.fn(),
  ready: Promise.resolve(),
}));

vi.mock('../../ui/components/MapIsland.js', () => ({
  MapIsland: ({ onScene }: { onScene: (scene: Scene) => void }) => {
    onScene(fakeScene);
    return <div data-testid="map-island" />;
  },
}));

const SESSION: UiSession = {
  scene: {
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
  },
  video: { src: '/video', fps: 30, frames: 90, width: 1512, height: 2688 },
};

const rafQueue: Array<(now: number) => void> = [];
let rafNow = 0;

function flushRaf(): void {
  for (const cb of rafQueue.splice(0)) {
    rafNow += 100;
    cb(rafNow);
  }
}

beforeEach(() => {
  rafQueue.length = 0;
  rafNow = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void): number => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', (): void => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe('PlayerChrome', () => {
  it('loads the recording and gates playback on tile warm-up', async () => {
    render(<PlayerChrome session={SESSION} onOpen={() => {}} />);
    const warmup = screen.getByRole('button', { name: 'Warming tiles…' }) as HTMLButtonElement;
    expect(warmup.disabled).toBe(true);
    await waitFor(() => {
      const play = screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement;
      expect(play.disabled).toBe(false);
    });
  });

  it('renders the video and the swap control', () => {
    render(<PlayerChrome session={SESSION} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Swap view' })).toBeTruthy();
    const video = document.querySelector('video');
    expect(video?.getAttribute('src')).toBe('/video');
  });

  it('seeks the video to i / fps and repaints the scene when scrubbing', () => {
    render(<PlayerChrome session={SESSION} onOpen={() => {}} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    // jsdom's media element ignores currentTime writes; track them instead.
    let currentTime = 0;
    Object.defineProperty(video, 'currentTime', {
      get: () => currentTime,
      set: (v: number) => {
        currentTime = v;
      },
      configurable: true,
    });
    const scrub = document.querySelector('input[type="range"]');
    fireEvent.change(scrub as HTMLInputElement, { target: { value: '30' } });
    act(() => flushRaf());
    expect(currentTime).toBeCloseTo(1);
    expect(fakeScene.setFrame).toHaveBeenCalledWith(30);
  });

  it('swaps the picture-in-picture layout', () => {
    render(<PlayerChrome session={SESSION} onOpen={() => {}} />);
    const mapPane = screen.getByTestId('map-island').parentElement as HTMLElement;
    expect(mapPane.className).toContain('pane-pip');
    fireEvent.click(screen.getByRole('button', { name: 'Swap view' }));
    expect(mapPane.className).toContain('pane-main');
  });
});
