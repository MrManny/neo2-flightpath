// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiSession } from '../../src/appsession.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { RenderConfig } from '../../src/config.js';
import type { Scene } from '../../src/renderer/scene.js';
import { PlayerChrome } from '../../ui/components/PlayerChrome.js';

const fakeScene = vi.hoisted((): Scene => ({
  setFrame: vi.fn(() => Promise.resolve()),
  relayout: vi.fn(),
  update: vi.fn(() => Promise.resolve()),
  ready: Promise.resolve(),
}));

// The real island delivers its scene asynchronously (after the Leaflet
// chunk); the mock keeps that timing so late-arrival behavior stays covered.
vi.mock('../../ui/components/MapIsland.js', async () => {
  const { useEffect } = await import('react');
  return {
    MapIsland: ({ onScene }: { onScene: (scene: Scene) => void }) => {
      useEffect(() => {
        const t = setTimeout(() => onScene(fakeScene), 0);
        return () => clearTimeout(t);
      }, [onScene]);
      return <div data-testid="map-island" />;
    },
  };
});

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
  tileBase: '/tiles',
  bbox: { minLat: 46.6, maxLat: 46.612, minLon: 14.26, maxLon: 14.262 },
};

const SETTINGS: RenderConfig = { ...DEFAULT_CONFIG };

const rafQueue: Array<(now: number) => void> = [];
let rafNow = 0;

function flushRaf(): void {
  for (const cb of rafQueue.splice(0)) {
    rafNow += 100;
    cb(rafNow);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
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
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const warmup = screen.getByRole('button', { name: 'Warming tiles…' }) as HTMLButtonElement;
    expect(warmup.disabled).toBe(true);
    await waitFor(() => {
      const play = screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement;
      expect(play.disabled).toBe(false);
    });
  });

  it('renders the video and the swap control', () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Swap view' })).toBeTruthy();
    const video = document.querySelector('video');
    expect(video?.getAttribute('src')).toBe('/video');
  });

  it('applies the frame the driver already reached when the scene arrives', async () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    await waitFor(() => expect(fakeScene.setFrame).toHaveBeenCalledWith(0));
  });

  it('seeks the video to i / fps and repaints the scene when scrubbing', async () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
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
    await waitFor(() => expect(fakeScene.setFrame).toHaveBeenCalledWith(30));
  });

  it('swaps the picture-in-picture layout', () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const mapPane = screen.getByTestId('map-island').parentElement as HTMLElement;
    expect(mapPane.className).toContain('pane-pip');
    fireEvent.click(screen.getByRole('button', { name: 'Swap view' }));
    expect(mapPane.className).toContain('pane-main');
  });

  it('opens the settings panel from the cog button', () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });

  it('pins only the picture-in-picture pane to a sized box', () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const mapPane = screen.getByTestId('map-island').parentElement as HTMLElement;
    const videoPane = (document.querySelector('video') as HTMLElement).parentElement as HTMLElement;

    // Map in the pip box (pipStyle-sized); the video pane must fill the stage.
    expect(mapPane.className).toContain('pane-pip');
    expect(mapPane.style.width).toBe('30%');
    expect(mapPane.style.aspectRatio).toBe('16 / 9');
    expect(videoPane.className).toContain('pane-main');
    expect(videoPane.style.width).toBe('');

    // Video in the pip box (aspect-sized, height-bound for portrait);
    // the map becomes the main pane and must fill the stage, never a pip box.
    fireEvent.click(screen.getByRole('button', { name: 'Swap view' }));
    expect(mapPane.className).toContain('pane-main');
    expect(mapPane.style.width).toBe('');
    expect(mapPane.style.aspectRatio).toBe('');
    expect(videoPane.style.width).toBe('auto');
    expect(videoPane.style.aspectRatio).toBe('1512 / 2688');
  });

  it('keeps the map pip above the footage in video view', () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const mapPane = screen.getByTestId('map-island').parentElement as HTMLElement;
    const videoPane = (document.querySelector('video') as HTMLElement).parentElement as HTMLElement;
    expect(mapPane.className).toContain('pane-pip');
    expect(mapPane.style.zIndex).toBe('2');
    expect(videoPane.className).toContain('pane-main');
    expect(videoPane.style.zIndex).toBe('');
  });

  it('keeps the drone footage pip above the map in map view', () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Swap view' }));
    const videoPane = (document.querySelector('video') as HTMLElement).parentElement as HTMLElement;
    const mapPane = screen.getByTestId('map-island').parentElement as HTMLElement;
    expect(videoPane.className).toContain('pane-pip');
    expect(videoPane.style.zIndex).toBe('2');
    expect(mapPane.className).toContain('pane-main');
    expect(mapPane.style.zIndex).toBe('');
  });
});
