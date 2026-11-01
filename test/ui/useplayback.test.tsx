// @vitest-environment jsdom
import type { ReactElement } from 'react';

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageVideo } from '../../src/appsession.js';
import type { Scene } from '../../src/renderer/scene.js';
import type { Playback } from '../../ui/hooks/usePlayback.js';
import { usePlayback } from '../../ui/hooks/usePlayback.js';

const VIDEO: PageVideo = { src: '/video', fps: 30, frames: 90, width: 1512, height: 2688 };

const fakeScene: Scene = {
  setFrame: vi.fn(() => Promise.resolve()),
  relayout: vi.fn(),
  update: vi.fn(() => Promise.resolve()),
  ready: Promise.resolve(),
};

let api: Playback;

function Harness(): ReactElement {
  api = usePlayback(VIDEO, 3);
  return (
    <>
      <video ref={api.videoRef} />
      <input type="range" ref={api.scrubRef} />
      <span ref={api.timeRef} />
    </>
  );
}

const rafQueue: Array<(now: number) => void> = [];
let rafNow = 0;

function flushRaf(): void {
  for (const cb of rafQueue.splice(0)) {
    rafNow += 100;
    cb(rafNow);
  }
}

// Marks run in their own commits, like separate key presses: the mark reads
// the head frame at press time.
function scrubAndMark(i: number, which: 'in' | 'out'): void {
  act(() => {
    api.scrubTo(i);
  });
  act(() => {
    api.setLoopPoint(which);
  });
}

interface FakePlayback {
  state: { paused: boolean; ended: boolean; currentTime: number; playbackRate: number };
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

// jsdom's media element ignores playback; this models play/pause/seek state
// so the wiring stays observable.
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

describe('usePlayback', () => {
  it('seeks the video to i / fps and rewrites the scrubber and time text', () => {
    render(<Harness />);
    const media = stubPlayback();
    act(() => {
      api.scrubTo(30);
    });
    act(() => flushRaf());
    expect(media.state.currentTime).toBeCloseTo(1);
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('30');
    expect(document.querySelector('span')?.textContent).toBe('0:01 / 0:03');
  });

  it('applies the frame the driver already reached when the scene arrives', () => {
    render(<Harness />);
    stubPlayback();
    act(() => {
      api.scrubTo(30);
    });
    act(() => flushRaf());
    api.handleScene(fakeScene);
    expect(fakeScene.setFrame).toHaveBeenCalledWith(30);
  });

  it('gates toggling on the ready flag, then plays and pauses the media', async () => {
    render(<Harness />);
    const media = stubPlayback();
    api.togglePlay();
    expect(media.play).not.toHaveBeenCalled();
    api.handleScene(fakeScene);
    await waitFor(() => expect(api.ready).toBe(true));
    api.togglePlay();
    expect(media.play).toHaveBeenCalledTimes(1);
    api.togglePlay();
    expect(media.pause).toHaveBeenCalledTimes(1);
  });

  it('parks playback before stepping a frame', () => {
    render(<Harness />);
    const media = stubPlayback();
    media.state.paused = false;
    act(() => {
      api.stepBy(1);
    });
    expect(media.pause).toHaveBeenCalledTimes(1);
  });

  it('stacks rapid steps onto the head frame', () => {
    render(<Harness />);
    const media = stubPlayback();
    act(() => {
      api.stepBy(1);
      api.stepBy(1);
      api.stepBy(1);
    });
    act(() => flushRaf());
    expect(media.state.currentTime).toBeCloseTo(3 / 30);
  });

  it('clamps stepping at the frame range', () => {
    render(<Harness />);
    const media = stubPlayback();
    act(() => {
      api.stepBy(-1);
    });
    act(() => flushRaf());
    expect(media.state.currentTime).toBe(0);
    act(() => {
      api.scrubTo(89);
      api.stepBy(1);
    });
    act(() => flushRaf());
    expect(media.state.currentTime).toBeCloseTo(89 / 30);
  });

  it('marks loop points at the head frame and clears them', () => {
    render(<Harness />);
    stubPlayback();
    scrubAndMark(30, 'in');
    scrubAndMark(60, 'out');
    expect(api.loop).toEqual({ in: 30, out: 60 });
    act(() => {
      api.clearLoop();
    });
    expect(api.loop).toEqual({ in: null, out: null });
  });

  it('resumes an ended loop at the loop start, not the file start', async () => {
    render(<Harness />);
    const media = stubPlayback();
    api.handleScene(fakeScene);
    await waitFor(() => expect(api.ready).toBe(true));
    scrubAndMark(30, 'in');
    scrubAndMark(60, 'out');
    media.state.ended = true;
    media.state.paused = true;
    act(() => {
      api.togglePlay();
    });
    act(() => flushRaf());
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(media.state.currentTime).toBeCloseTo(1);
  });

  it('applies the playback rate to the media element', () => {
    render(<Harness />);
    const media = stubPlayback();
    act(() => {
      api.setSpeed(3);
    });
    expect(media.state.playbackRate).toBe(3);
    expect(api.speed).toBe(3);
  });
});
