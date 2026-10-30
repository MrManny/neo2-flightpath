// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PickResult, UiSession } from '../../src/appsession.js';
import { DEFAULT_CONFIG } from '../../src/config.js';
import type { Scene } from '../../src/renderer/scene.js';
import Page from '../../ui/app/page.js';

const fakeScene = vi.hoisted((): Scene => ({
  setFrame: vi.fn(() => Promise.resolve()),
  relayout: vi.fn(),
  update: vi.fn(() => Promise.resolve()),
  ready: Promise.resolve(),
}));

// The real island loads Leaflet after mount; the stub keeps that timing.
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

// The bridge stands in for the shell: the test decides when the native picker
// returns, and when the shell reports that a valid file is being prepared.
function installBridge() {
  const pending: Array<(result: PickResult) => void> = [];
  const listeners: { preparing?: () => void } = {};
  const bridge = {
    getSettings: vi.fn(async () => DEFAULT_CONFIG),
    getSession: vi.fn(async () => SESSION),
    pickRecording: vi.fn(
      () =>
        new Promise<PickResult>((resolve) => {
          pending.push(resolve);
        }),
    ),
    onPreparing: vi.fn((cb: () => void) => {
      listeners.preparing = cb;
      return () => {
        listeners.preparing = undefined;
      };
    }),
  };
  (window as { neo2flightpath?: unknown }).neo2flightpath = bridge;
  return {
    bridge,
    prepare: () => {
      act(() => {
        listeners.preparing?.();
      });
    },
    settle: async (result: PickResult) => {
      const resolve = pending.shift();
      if (!resolve) throw new Error('no pick is waiting for a reply');
      await act(async () => {
        resolve(result);
      });
    },
  };
}

async function openLanding() {
  render(<Page />);
  return screen.findByRole('button', { name: 'Open…' });
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  delete (window as { neo2flightpath?: unknown }).neo2flightpath;
});

describe('Open flow on the landing', () => {
  it('shows no busy status while the native picker is open', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    expect(harness.bridge.pickRecording).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Open…' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Preparing/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows Preparing only after the shell reports a valid file', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    expect(screen.queryByText(/Preparing/)).toBeNull();
    harness.prepare();
    expect(screen.getByText('Preparing the recording (telemetry and map tiles)…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Preparing…' }) as HTMLButtonElement).disabled).toBe(true);
    await harness.settle({ ok: true });
  });

  it('opens the player once the picked recording loads', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    harness.prepare();
    await harness.settle({ ok: true });
    await waitFor(() => expect(document.querySelector('.controls')).not.toBeNull());
  });

  it('ignores a second Open while the first pick is still running', async () => {
    const harness = installBridge();
    const open = await openLanding();
    fireEvent.click(open);
    fireEvent.click(open);
    expect(harness.bridge.pickRecording).toHaveBeenCalledTimes(1);
    await harness.settle({ canceled: true });
  });
});

describe.each([
  {
    outcome: 'the picker is canceled',
    result: { canceled: true },
    text: 'No recording picked.',
    role: 'status',
  },
  {
    outcome: 'the file is not a readable .mp4',
    result: { ok: false, error: 'not a readable .mp4 file: C:\\Windows\\win.ini' },
    text: 'Could not open the recording: "win.ini" is not a readable .mp4 recording.',
    role: 'alert',
  },
  {
    outcome: 'the backend reports an unknown failure',
    result: { ok: false, error: 'disk on fire' },
    text: 'Could not open the recording: disk on fire',
    role: 'alert',
  },
])('when $outcome', ({ result, text, role }) => {
  it('shows that outcome and never a busy status', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    await harness.settle(result as PickResult);
    expect(screen.getByRole(role).textContent).toContain(text);
    expect(screen.queryByText(/Preparing/)).toBeNull();
  });
});

describe('Open flow over the player', () => {
  it('keeps the recording and offers a dismissible notice when Open fails', async () => {
    const harness = installBridge();
    fireEvent.click(await openLanding());
    harness.prepare();
    await harness.settle({ ok: true });
    await waitFor(() => expect(document.querySelector('.controls')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Open…' }));
    await harness.settle({ ok: false, error: 'not a readable .mp4 file: C:\\Windows\\win.ini' });
    expect(screen.getByRole('alert').textContent).toContain('"win.ini" is not a readable .mp4 recording.');
    expect(document.querySelector('.controls')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.controls')).not.toBeNull();
  });
});
