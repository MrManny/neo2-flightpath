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
  stats: {
    source: 'cammeta',
    method: 'ffprobe',
    headingMode: 'yaw',
    fixes: 1234,
    noLock: 8,
    trackDistanceM: 123,
    durationSec: 3,
  },
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

  it('does not swap views when the map pane is clicked', () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const mapPane = screen.getByTestId('map-island').parentElement as HTMLElement;
    fireEvent.click(mapPane);
    expect(mapPane.className).toContain('pane-pip');
    fireEvent.click(screen.getByRole('button', { name: 'Swap view' }));
    fireEvent.click(mapPane);
    expect(mapPane.className).toContain('pane-main');
  });
});

interface FakePlayback {
  state: { paused: boolean; ended: boolean; currentTime: number; playbackRate: number };
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

// jsdom's media element ignores playback; this models play/pause/seek state
// so keyboard behavior stays observable.
function stubPlayback(): FakePlayback {
  const video = document.querySelector('video') as HTMLVideoElement;
  const state = { paused: true, ended: false, currentTime: 0, playbackRate: 1 };
  const play = vi.fn(() => {
    state.paused = false;
    state.ended = false;
    return Promise.resolve();
  });
  const pause = vi.fn(() => {
    state.paused = true;
  });
  vi.spyOn(video, 'play').mockImplementation(play);
  vi.spyOn(video, 'pause').mockImplementation(pause);
  Object.defineProperty(video, 'paused', { get: () => state.paused, configurable: true });
  Object.defineProperty(video, 'ended', { get: () => state.ended, configurable: true });
  Object.defineProperty(video, 'currentTime', {
    get: () => state.currentTime,
    set: (v: number) => {
      state.currentTime = v;
    },
    configurable: true,
  });
  Object.defineProperty(video, 'playbackRate', {
    get: () => state.playbackRate,
    set: (v: number) => {
      state.playbackRate = v;
    },
    configurable: true,
  });
  return { state, play, pause };
}

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.repeat) Object.defineProperty(event, 'repeat', { value: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

async function renderPlayer(onOpen: () => void = () => {}): Promise<FakePlayback> {
  render(
    <PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={onOpen} />,
  );
  await waitFor(() => {
    expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(false);
  });
  return stubPlayback();
}

function setLoopRegion(from: number, to: number): void {
  const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
  fireEvent.change(scrub, { target: { value: String(from) } });
  key(window, { key: 'i' });
  fireEvent.change(scrub, { target: { value: String(to) } });
  key(window, { key: 'o' });
  act(() => flushRaf());
}

describe('PlayerChrome keyboard shortcuts', () => {
  it('toggles playback with Space and claims the key', async () => {
    const fake = await renderPlayer();
    const event = key(window, { key: ' ' });
    expect(fake.play).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    key(window, { key: ' ' });
    expect(fake.pause).toHaveBeenCalledTimes(1);
  });

  it('does not toggle playback while Space auto-repeats', async () => {
    const fake = await renderPlayer();
    key(window, { key: ' ', repeat: true });
    expect(fake.play).not.toHaveBeenCalled();
  });

  it('gates keyboard play on tile warm-up', () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    const fake = stubPlayback();
    key(window, { key: ' ' });
    expect(fake.play).not.toHaveBeenCalled();
  });

  it('sets playback speed from the number keys and the speed buttons', async () => {
    const fake = await renderPlayer();
    key(window, { key: '3' });
    expect(fake.state.playbackRate).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: '2×' }));
    expect(fake.state.playbackRate).toBe(2);
    expect(screen.getByRole('button', { name: '2×' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '3×' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('steps a frame and parks playback with the arrows', async () => {
    const fake = await renderPlayer();
    key(window, { key: ' ' });
    key(window, { key: 'ArrowRight' });
    expect(fake.pause).toHaveBeenCalledTimes(1);
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(1 / 30);
    key(window, { key: 'ArrowLeft' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(0);
  });

  it('stacks rapid steps onto the head frame', async () => {
    const fake = await renderPlayer();
    key(window, { key: 'ArrowRight' });
    key(window, { key: 'ArrowRight' });
    key(window, { key: 'ArrowRight' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(3 / 30);
  });

  it('clamps stepping at the frame range', async () => {
    const fake = await renderPlayer();
    key(window, { key: 'ArrowLeft' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBe(0);
    key(window, { key: 'End' });
    key(window, { key: 'ArrowRight' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(89 / 30);
  });

  it('jumps one second with shift+arrows, frame-quantized', async () => {
    const fake = await renderPlayer();
    key(window, { key: 'ArrowRight', shiftKey: true });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(1);
    key(window, { key: 'ArrowLeft', shiftKey: true });
    key(window, { key: 'ArrowLeft', shiftKey: true });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBe(0);
  });

  it('jumps to start and end with Home and End', async () => {
    const fake = await renderPlayer();
    key(window, { key: 'End' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(89 / 30);
    key(window, { key: 'Home' });
    act(() => flushRaf());
    expect(fake.state.currentTime).toBe(0);
  });

  it('leaves native arrow stepping to the focused scrubber', async () => {
    const fake = await renderPlayer();
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    const event = key(scrub, { key: 'ArrowRight' });
    expect(event.defaultPrevented).toBe(false);
    expect(fake.state.currentTime).toBe(0);
  });

  it('leaves unclaimed keys to their default behavior', async () => {
    await renderPlayer();
    const event = key(window, { key: 'x' });
    expect(event.defaultPrevented).toBe(false);
  });

  it('opens the recording dialog with Ctrl+O and leaves O to the loop', async () => {
    const onOpen = vi.fn();
    await renderPlayer(onOpen);
    key(window, { key: 'o', ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
    key(window, { key: 'o' });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText('loop ?–0:00')).toBeTruthy();
    // Ctrl+O still fires while the scrubber has focus.
    const scrub = document.querySelector('input[type="range"]') as HTMLInputElement;
    key(scrub, { key: 'o', ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

describe('PlayerChrome loop region', () => {
  it('sets the loop with I and O, shows the region, and wraps playback into it', async () => {
    const fake = await renderPlayer();
    setLoopRegion(30, 60);
    expect(screen.getByText('loop 0:01–0:02')).toBeTruthy();
    const band = document.querySelector('.loop-band') as HTMLElement;
    expect(parseFloat(band.style.left)).toBeCloseTo((30 / 89) * 100);
    expect(parseFloat(band.style.width)).toBeCloseTo((30 / 89) * 100);
    fake.state.paused = false;
    fake.state.currentTime = 70 / 30;
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(1);
    await waitFor(() => expect(fakeScene.setFrame).toHaveBeenCalledWith(30));
  });

  it('clears the loop with Esc and closes an open modal first', async () => {
    await renderPlayer();
    setLoopRegion(30, 60);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    key(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(screen.getByText('loop 0:01–0:02')).toBeTruthy();
    key(window, { key: 'Escape' });
    expect(screen.queryByText('loop 0:01–0:02')).toBeNull();
    expect((screen.getByRole('button', { name: 'Clear loop' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('clears the loop from the Clear button', async () => {
    await renderPlayer();
    setLoopRegion(30, 60);
    fireEvent.click(screen.getByRole('button', { name: 'Clear loop' }));
    expect(screen.queryByText('loop 0:01–0:02')).toBeNull();
  });

  it('shows no region for an out-of-order loop', async () => {
    await renderPlayer();
    setLoopRegion(60, 30);
    expect(document.querySelector('.loop-band')).toBeNull();
    expect(screen.getByText('loop 0:02–0:01')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Clear loop' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('resumes an end-of-file loop at the loop start, not the file start', async () => {
    const fake = await renderPlayer();
    setLoopRegion(30, 60);
    fake.state.ended = true;
    fake.state.paused = true;
    key(window, { key: ' ' });
    expect(fake.play).toHaveBeenCalledTimes(1);
    act(() => flushRaf());
    expect(fake.state.currentTime).toBeCloseTo(1);
  });
});

describe('PlayerChrome shortcut guard rails', () => {
  it('keeps player keys inert while the settings modal is open', async () => {
    const onOpen = vi.fn();
    const fake = await renderPlayer(onOpen);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    key(window, { key: ' ' });
    key(window, { key: '2' });
    key(window, { key: 'ArrowRight' });
    key(window, { key: 'o', ctrlKey: true });
    expect(fake.play).not.toHaveBeenCalled();
    expect(fake.state.playbackRate).toBe(1);
    expect(fake.state.currentTime).toBe(0);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('keeps player keys inert while typing in a settings field', async () => {
    const onOpen = vi.fn();
    const fake = await renderPlayer(onOpen);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const field = document.querySelector('input[type="number"]') as HTMLInputElement;
    key(field, { key: '3' });
    key(field, { key: ' ' });
    key(field, { key: 'o', ctrlKey: true });
    expect(fake.state.playbackRate).toBe(1);
    expect(fake.play).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('leaves Esc on an open select dropdown to the select', async () => {
    await renderPlayer();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const select = document.querySelector('select') as HTMLSelectElement;
    key(select, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    key(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });
});

describe('PlayerChrome flight stats strip', () => {
  it('shows the CLI summary values as chips', () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    for (const chip of [
      'Duration 0:03',
      'Track 123 m',
      'cammeta (ffprobe)',
      '1234 fixes',
      '8 no-lock cues',
      'heading: yaw',
    ]) {
      expect(screen.getByText(chip)).toBeTruthy();
    }
  });

  it('omits the no-lock chip when the CLI summary would print none', () => {
    render(
      <PlayerChrome
        session={{ ...SESSION, stats: { ...SESSION.stats, noLock: 0 } }}
        settings={SETTINGS}
        onSettingsChange={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText('1234 fixes')).toBeTruthy();
    expect(screen.queryByText(/no-lock/)).toBeNull();
  });

  it('shows the same duration in the readout and the stats strip', () => {
    render(<PlayerChrome session={SESSION} settings={SETTINGS} onSettingsChange={() => {}} onOpen={() => {}} />);
    expect(screen.getByText('Duration 0:03')).toBeTruthy();
    expect(screen.getByText('0:00 / 0:03')).toBeTruthy();
  });
});
