import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageVideo } from '../../src/appsession.js';
import {
  createFrameDriver,
  engagedLoop,
  formatTime,
  frameFromMediaTime,
  framesForSeconds,
} from '../../ui/lib/framedriver.js';

const META: PageVideo = { src: '/video', fps: 30, frames: 300, width: 1920, height: 1080 };

describe('frameFromMediaTime', () => {
  it.for([
    { name: 'exact frame', mediaTime: 0.5, fps: 30, frames: 300, want: 15 },
    { name: 'half frame floors', mediaTime: 0.05, fps: 30, frames: 300, want: 1 },
    { name: 'just below a frame floors', mediaTime: 0.0332, fps: 30, frames: 300, want: 0 },
    { name: 'clamps below zero', mediaTime: -5, fps: 30, frames: 300, want: 0 },
    { name: 'clamps past the end', mediaTime: 100, fps: 30, frames: 300, want: 299 },
    { name: 'single frame stays zero', mediaTime: 3, fps: 30, frames: 1, want: 0 },
  ])('$name', ({ mediaTime, fps, frames, want }) => {
    expect(frameFromMediaTime(mediaTime, fps, frames)).toBe(want);
  });
});

describe('formatTime', () => {
  it.for([
    { sec: 0, want: '0:00' },
    { sec: 65, want: '1:05' },
    { sec: 125.4, want: '2:05' },
    { sec: -5, want: '0:00' },
  ])('formats $sec as $want', ({ sec, want }) => {
    expect(formatTime(sec)).toBe(want);
  });
});

describe('framesForSeconds', () => {
  it.for([
    { name: 'exact rate', fps: 30, seconds: 1, want: 30 },
    { name: '29.97 rounds up', fps: 29.97, seconds: 1, want: 30 },
    { name: '23.976 rounds to 24', fps: 23.976, seconds: 1, want: 24 },
    { name: '50 fps', fps: 50, seconds: 1, want: 50 },
    { name: 'negative jumps keep the sign', fps: 30, seconds: -1, want: -30 },
    { name: 'negative fractional rate', fps: 29.97, seconds: -1, want: -30 },
  ])('$name', ({ fps, seconds, want }) => {
    expect(framesForSeconds(fps, seconds)).toBe(want);
  });
});

interface FakeVideo {
  currentTime: number;
  paused: boolean;
  ended: boolean;
  play: ReturnType<typeof vi.fn>;
  requestVideoFrameCallback?: (cb: FrameCallback) => number;
  cancelVideoFrameCallback?: (id: number) => void;
}

type FrameCallback = (now: number, meta: { mediaTime: number }) => void;

const rafQueue: Array<(now: number) => void> = [];
let rafNow = 0;

function flushRaf(): void {
  for (const cb of rafQueue.splice(0)) {
    rafNow += 100;
    cb(rafNow);
  }
}

function fakeVideo(): FakeVideo {
  const video: FakeVideo = {
    currentTime: 0,
    paused: true,
    ended: false,
    play: vi.fn(() => {
      video.paused = false;
      video.ended = false;
      return Promise.resolve();
    }),
  };
  return video;
}

// A fake that drives the requestVideoFrameCallback path, the one Electron
// actually runs: tests present frames explicitly instead of relying on time.
function fakeVideoRvfc(): {
  video: FakeVideo;
  present: (mediaTime: number) => void;
  pendingFrames: () => number;
} {
  let nextId = 1;
  const callbacks = new Map<number, FrameCallback>();
  const video: FakeVideo = {
    ...fakeVideo(),
    requestVideoFrameCallback: (cb: FrameCallback): number => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    },
    cancelVideoFrameCallback: (id: number): void => {
      callbacks.delete(id);
    },
  };
  return {
    video,
    present: (mediaTime: number): void => {
      const first = callbacks.entries().next();
      if (first.done) return;
      const [id, cb] = first.value;
      callbacks.delete(id);
      cb(0, { mediaTime });
    },
    pendingFrames: (): number => callbacks.size,
  };
}

function build(video: FakeVideo): {
  applyFrame: ReturnType<typeof vi.fn>;
  onIndex: ReturnType<typeof vi.fn>;
  onFps: ReturnType<typeof vi.fn>;
  driver: ReturnType<typeof createFrameDriver>;
} {
  const applyFrame = vi.fn();
  const onIndex = vi.fn();
  const onFps = vi.fn();
  const driver = createFrameDriver({
    video: video as unknown as HTMLVideoElement,
    meta: META,
    applyFrame,
    onIndex,
    onFps,
  });
  return { applyFrame, onIndex, onFps, driver };
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
});

describe('createFrameDriver', () => {
  it('coalesces scrub input into one seek per tick', () => {
    const video = fakeVideo();
    const { applyFrame, onIndex, driver } = build(video);
    driver.start();
    driver.scrub(10);
    driver.scrub(20);
    flushRaf();
    expect(video.currentTime).toBeCloseTo(20 / 30);
    expect(applyFrame).toHaveBeenCalledTimes(1);
    expect(applyFrame).toHaveBeenCalledWith(20);
    expect(onIndex).toHaveBeenCalledWith(20);
  });

  it('clamps scrub targets to the frame range', () => {
    const video = fakeVideo();
    const { driver } = build(video);
    driver.start();
    driver.scrub(-5);
    flushRaf();
    expect(video.currentTime).toBe(0);
    driver.scrub(10000);
    flushRaf();
    expect(video.currentTime).toBeCloseTo(299 / 30);
  });

  it('derives frames from the fallback clock only while playing', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.start();
    video.currentTime = 1;
    flushRaf();
    expect(applyFrame).not.toHaveBeenCalled();
    video.paused = false;
    flushRaf();
    expect(applyFrame).toHaveBeenCalledWith(30);
  });

  it('never re-derives the same frame twice', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.start();
    video.paused = false;
    video.currentTime = 1;
    flushRaf();
    flushRaf();
    expect(applyFrame).toHaveBeenCalledTimes(1);
  });

  it('reports fps after sustained sampling', () => {
    const video = fakeVideo();
    const { onFps, driver } = build(video);
    driver.start();
    for (let i = 0; i < 25; i++) flushRaf();
    expect(onFps).toHaveBeenCalled();
  });

  it('stops applying frames after stop()', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.start();
    driver.stop();
    video.paused = false;
    video.currentTime = 1;
    flushRaf();
    expect(applyFrame).not.toHaveBeenCalled();
  });
});

describe('createFrameDriver loop wrap', () => {
  it('wraps played frames past the out point back to the loop start', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.start();
    video.paused = false;
    video.currentTime = 21 / 30;
    flushRaf();
    expect(video.currentTime).toBeCloseTo(10 / 30);
    expect(applyFrame).toHaveBeenCalledWith(10);
    expect(applyFrame).not.toHaveBeenCalledWith(21);
  });

  it('plays the region through its out point before wrapping', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.start();
    video.paused = false;
    video.currentTime = 20 / 30;
    flushRaf();
    expect(applyFrame).toHaveBeenCalledWith(20);
    expect(video.currentTime).toBeCloseTo(20 / 30);
  });

  it('wraps played frames on the presented-frame path without flashing the next frame', () => {
    const { video, present } = fakeVideoRvfc();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.start();
    video.paused = false;
    present(20.5 / 30);
    expect(applyFrame).toHaveBeenCalledWith(20);
    present(21 / 30);
    expect(video.currentTime).toBeCloseTo(10 / 30);
    expect(applyFrame).toHaveBeenCalledWith(10);
    expect(applyFrame).not.toHaveBeenCalledWith(21);
  });

  it('honors paused seek frames outside the region verbatim', () => {
    const { video, present } = fakeVideoRvfc();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.start();
    driver.scrub(25);
    flushRaf();
    // Chromium presents the seeked frame even while paused; the loop must
    // not yank an explicit target back into the region.
    present(25 / 30);
    expect(video.currentTime).toBeCloseTo(25 / 30);
    expect(applyFrame).toHaveBeenCalledWith(25);
    expect(applyFrame).not.toHaveBeenCalledWith(10);
  });

  it('honors explicit scrub targets outside the region verbatim', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.start();
    driver.scrub(25);
    flushRaf();
    expect(video.currentTime).toBeCloseTo(25 / 30);
    expect(applyFrame).toHaveBeenCalledWith(25);
    flushRaf();
    expect(applyFrame).toHaveBeenCalledTimes(1);
  });

  it('ignores an inverted region until it is ordered', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 20, out: 10 });
    driver.start();
    video.paused = false;
    video.currentTime = 25 / 30;
    flushRaf();
    expect(video.currentTime).toBeCloseTo(25 / 30);
    expect(applyFrame).toHaveBeenCalledWith(25);
  });

  it('ignores a degenerate single-frame region', () => {
    const video = fakeVideo();
    const { driver } = build(video);
    driver.setLoop({ in: 15, out: 15 });
    driver.start();
    video.paused = false;
    video.currentTime = 25 / 30;
    flushRaf();
    expect(video.currentTime).toBeCloseTo(25 / 30);
  });

  it('restores plain playback when the loop is cleared', () => {
    const video = fakeVideo();
    const { applyFrame, driver } = build(video);
    driver.setLoop({ in: 10, out: 20 });
    driver.setLoop(null);
    driver.start();
    video.paused = false;
    video.currentTime = 25 / 30;
    flushRaf();
    expect(video.currentTime).toBeCloseTo(25 / 30);
    expect(applyFrame).toHaveBeenCalledWith(25);
  });

  it('wraps from the end of the file and resumes playback', () => {
    const video = fakeVideo();
    const { driver } = build(video);
    driver.setLoop({ in: 5, out: 299 });
    driver.start();
    video.currentTime = 299 / 30;
    video.ended = true;
    flushRaf();
    expect(video.currentTime).toBeCloseTo(5 / 30);
    expect(video.play).toHaveBeenCalled();
    expect(video.ended).toBe(false);
  });

  it('does not wrap when paused at the end without a loop', () => {
    const video = fakeVideo();
    const { driver } = build(video);
    driver.start();
    video.ended = true;
    flushRaf();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(0);
  });
});

describe('createFrameDriver presented-frame chain', () => {
  it('tears the chain down on stop()', () => {
    const { video, present, pendingFrames } = fakeVideoRvfc();
    const { applyFrame, driver } = build(video);
    driver.start();
    present(1 / 30);
    expect(applyFrame).toHaveBeenCalledWith(1);
    driver.stop();
    expect(pendingFrames()).toBe(0);
    present(2 / 30);
    expect(applyFrame).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(0);
  });

  it('re-hooks the chain on restart', () => {
    const { video, present } = fakeVideoRvfc();
    const { applyFrame, driver } = build(video);
    driver.start();
    driver.stop();
    driver.start();
    present(5 / 30);
    expect(applyFrame).toHaveBeenCalledWith(5);
  });

  it('ignores a presented frame that was already in flight when stop() ran', () => {
    const callbacks: FrameCallback[] = [];
    const video: FakeVideo = {
      ...fakeVideo(),
      requestVideoFrameCallback: (cb: FrameCallback): number => {
        callbacks.push(cb);
        return callbacks.length;
      },
      cancelVideoFrameCallback: (): void => {},
    };
    const { applyFrame, driver } = build(video);
    driver.start();
    const inFlight = callbacks[0];
    driver.stop();
    inFlight(0, { mediaTime: 3 / 30 });
    expect(applyFrame).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(0);
  });
});

describe('engagedLoop', () => {
  it.for([
    {
      name: 'both points set and ordered engages',
      state: { in: 10, out: 20 },
      want: { in: 10, out: 20 },
    },
    { name: 'missing in point stays dormant', state: { in: null, out: 20 }, want: null },
    { name: 'missing out point stays dormant', state: { in: 10, out: null }, want: null },
    { name: 'inverted points stay dormant', state: { in: 20, out: 10 }, want: null },
    { name: 'equal points stay dormant', state: { in: 15, out: 15 }, want: null },
    { name: 'no points at all stays dormant', state: { in: null, out: null }, want: null },
  ])('$name', ({ state, want }) => {
    expect(engagedLoop(state)).toEqual(want);
  });
});
